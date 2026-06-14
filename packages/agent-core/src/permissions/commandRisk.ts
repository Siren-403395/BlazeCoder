/**
 * Command risk classification — makes the highest-stakes decision point (approving a
 * shell command) explainable, and adds a narrow safety net for the handful of commands
 * that are irreversibly catastrophic.
 *
 * TWO outputs, deliberately separate:
 *  - `risk`/`category`/`reason`: ADVISORY. Surfaced on the permission prompt so the human
 *    knows what they're approving (a read vs a network call vs a destructive delete). It
 *    never changes the decision on its own.
 *  - `catastrophic`: a TRIPWIRE. True only for the small, unambiguous set of commands that
 *    destroy the machine/data with no undo (rm -rf of a root/home/glob target, a fork
 *    bomb, dd/mkfs/redirect to a block device, chmod/chown -R on / or ~). The engine uses
 *    this to FORCE a human confirmation even under a broad "always allow" rule — because a
 *    user who allowed `Bash(git:*)` did not thereby consent to `rm -rf ~`. It is
 *    deliberately conservative: `rm -rf node_modules` is destructive but NOT catastrophic.
 *
 * Heuristic by design (it does not run a real shell parser); it errs toward warning.
 */

import { normalizeCommand, splitCommand } from "./bashRuleMatch";

export type CommandRisk = "read" | "write" | "network" | "destructive";

export type CommandCategory =
  | "git"
  | "test"
  | "install"
  | "publish"
  | "filesystem"
  | "network"
  | "process"
  | "unknown";

export interface CommandClassification {
  category: CommandCategory;
  risk: CommandRisk;
  /** Short human explanation for the permission prompt. */
  reason: string;
  /** Irreversibly destructive — the engine force-confirms these even under an allow rule. */
  catastrophic: boolean;
}

const RISK_ORDER: Record<CommandRisk, number> = { read: 0, write: 1, network: 2, destructive: 3 };

/** Read-only inspection commands. */
const READ_CMDS = new Set([
  "ls", "cat", "pwd", "echo", "head", "tail", "wc", "less", "more", "stat", "file", "which",
  "whoami", "date", "env", "printenv", "tree", "du", "df", "ps", "top", "id", "uname", "hostname",
  "grep", "rg", "find", "fd", "awk", "sed", "diff", "sort", "uniq", "cut", "jq", "basename", "dirname",
]);
/** Commands that create/move/modify files but are reversible-ish. */
const WRITE_CMDS = new Set(["cp", "mv", "mkdir", "touch", "ln", "tar", "unzip", "zip", "patch", "tee"]);
/** Commands that reach the network. */
const NETWORK_CMDS = new Set(["curl", "wget", "ssh", "scp", "rsync", "nc", "ncat", "ftp", "telnet"]);
/** Test runners — run code but conventionally don't mutate sources. */
const TEST_CMDS = new Set(["vitest", "jest", "mocha", "pytest", "phpunit", "rspec", "go", "cargo"]);
/** Package managers (subcommand decides install vs publish vs run). */
const PKG_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "brew", "apt", "apt-get", "gem", "cargo", "go"]);

function tokens(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean);
}

/** Does this rm/chmod/chown segment target a root, home, or glob path? */
function hasDangerousFsTarget(args: string[]): boolean {
  return args.some((a) => {
    if (/^-/.test(a)) return false; // a flag, not a target
    return (
      a === "/" ||
      a === "/*" ||
      a === "*" ||
      a === "." ||
      a === "./" ||
      a === "~" ||
      a === "~/" ||
      a === "~/*" ||
      a === "$HOME" ||
      a === "${HOME}" ||
      /^\$\{?HOME\}?\/?\*?$/.test(a) ||
      /^\/[^/]*\/?\*?$/.test(a) // a single top-level dir: /usr, /etc, /var/, /System/*
    );
  });
}

function hasRecursiveForce(args: string[]): boolean {
  const flags = args.filter((a) => /^-[^-]/.test(a)).join("");
  const hasR = /r/i.test(flags) || args.includes("--recursive");
  const hasF = /f/.test(flags) || args.includes("--force");
  return hasR && hasF;
}

/** Catastrophic signatures detected on the WHOLE command (operators are part of them). */
function isCatastrophicWhole(raw: string): boolean {
  const c = raw.replace(/\s+/g, " ");
  if (/:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;?\s*:/.test(c)) return true; // fork bomb :(){ :|:& };:
  if (/:\|:\s*&/.test(c.replace(/\s+/g, ""))) return true; // compact fork bomb :|:&
  if (/(^|[\s|;&])(>|>>)\s*\/dev\/(sd|disk|nvme|hd|mmcblk|vd)/.test(c)) return true; // redirect to a block device
  return false;
}

/** Classify one already-normalized segment. */
function classifySegment(segment: string): CommandClassification {
  let t = tokens(segment);
  // Strip a leading privilege escalator (sudo/doas) + its options, so we judge the REAL
  // command — `sudo rm -rf /` is rm's risk, only worse.
  while (t[0] === "sudo" || t[0] === "doas") {
    t = t.slice(1);
    while (t.length > 1 && /^-/.test(t[0]!)) t = /^-[ugpC]$/.test(t[0]!) ? t.slice(2) : t.slice(1);
  }
  const head = t[0] ?? "";
  const args = t.slice(1);

  // ── Catastrophic, irreversible ──
  if (head === "rm" && hasRecursiveForce(args) && hasDangerousFsTarget(args)) {
    return { category: "filesystem", risk: "destructive", reason: "recursive force-delete of a root/home/glob path", catastrophic: true };
  }
  if (head === "dd" && args.some((a) => /^of=\/dev\//.test(a))) {
    return { category: "filesystem", risk: "destructive", reason: "dd writing directly to a device", catastrophic: true };
  }
  if (/^mkfs(\.|$)/.test(head)) {
    return { category: "filesystem", risk: "destructive", reason: "formatting a filesystem", catastrophic: true };
  }
  if (
    (head === "chmod" || head === "chown") &&
    (args.some((a) => /^-[^-]*R/.test(a)) || args.includes("--recursive")) &&
    hasDangerousFsTarget(args)
  ) {
    return { category: "filesystem", risk: "destructive", reason: `recursive ${head} on a root/home path`, catastrophic: true };
  }

  // ── Destructive but not catastrophic (reversible-ish or scoped) ──
  if (head === "rm" && (hasRecursiveForce(args) || args.some((a) => /^-[^-]*r/i.test(a)))) {
    return { category: "filesystem", risk: "destructive", reason: "recursive delete", catastrophic: false };
  }
  if (head === "shred" || head === "truncate") {
    return { category: "filesystem", risk: "destructive", reason: "destroys file contents", catastrophic: false };
  }
  if (head === "git") {
    const sub = args.find((a) => !/^-/.test(a)) ?? "";
    const force = args.includes("--force") || args.includes("-f") || args.some((a) => /^--force/.test(a));
    if (sub === "push" && force) return { category: "git", risk: "destructive", reason: "force-push rewrites remote history", catastrophic: false };
    if (sub === "reset" && args.includes("--hard")) return { category: "git", risk: "destructive", reason: "git reset --hard discards changes", catastrophic: false };
    if (sub === "clean" && args.some((a) => /^-[^-]*f/.test(a))) return { category: "git", risk: "destructive", reason: "git clean deletes untracked files", catastrophic: false };
    if (["push", "pull", "fetch", "clone", "remote"].includes(sub)) return { category: "git", risk: "network", reason: `git ${sub} reaches the network`, catastrophic: false };
    if (["commit", "add", "checkout", "switch", "merge", "rebase", "stash", "tag"].includes(sub)) return { category: "git", risk: "write", reason: `git ${sub} modifies the repo`, catastrophic: false };
    return { category: "git", risk: "read", reason: `git ${sub || "command"}`, catastrophic: false };
  }

  // ── Package managers ──
  if (PKG_MANAGERS.has(head)) {
    const sub = args.find((a) => !/^-/.test(a)) ?? "";
    if (sub === "publish") return { category: "publish", risk: "network", reason: `${head} publish releases a package`, catastrophic: false };
    if (["install", "add", "i", "ci", "update", "upgrade", "get"].includes(sub)) return { category: "install", risk: "network", reason: `${head} ${sub} downloads dependencies`, catastrophic: false };
    if (["test", "t"].includes(sub) || (head === "go" && sub === "test")) return { category: "test", risk: "read", reason: `${head} ${sub}`, catastrophic: false };
    if (["run", "exec", "build", "start", "dev"].includes(sub)) return { category: "process", risk: "write", reason: `${head} ${sub}`, catastrophic: false };
    return { category: "install", risk: "write", reason: `${head} ${sub || "command"}`, catastrophic: false };
  }

  // ── Network / test / write / read by leading command ──
  if (NETWORK_CMDS.has(head)) return { category: "network", risk: "network", reason: `${head} reaches the network`, catastrophic: false };
  if (TEST_CMDS.has(head)) return { category: "test", risk: "read", reason: `${head} test run`, catastrophic: false };
  if (READ_CMDS.has(head)) {
    if (head === "find" && args.some((a) => a === "-delete" || a === "-exec")) {
      return { category: "filesystem", risk: "destructive", reason: "find -delete/-exec mutates files", catastrophic: false };
    }
    if ((head === "sed" || head === "awk") && args.some((a) => /^-i/.test(a))) {
      return { category: "filesystem", risk: "write", reason: `${head} -i edits files in place`, catastrophic: false };
    }
    return { category: "process", risk: "read", reason: `${head} (read-only)`, catastrophic: false };
  }
  if (WRITE_CMDS.has(head)) return { category: "filesystem", risk: "write", reason: `${head} writes files`, catastrophic: false };

  // ── Unknown: assume it can write (advisory, conservative). ──
  return { category: "unknown", risk: "write", reason: head ? `unrecognized command "${head}"` : "command", catastrophic: false };
}

/**
 * Classify a (possibly compound) shell command. Aggregates across sub-commands: the
 * overall risk is the riskiest segment, catastrophic if ANY segment is, and the reason
 * describes that worst segment. Output redirects to a block device are caught on the
 * whole command (operators are part of the signature).
 */
export function classifyCommand(command: string): CommandClassification {
  const raw = command.trim();
  if (!raw) return { category: "unknown", risk: "read", reason: "empty command", catastrophic: false };

  if (isCatastrophicWhole(raw)) {
    return { category: "filesystem", risk: "destructive", reason: "irreversible system/device operation", catastrophic: true };
  }

  const segments = splitCommand(normalizeCommand(raw, true));
  if (segments.length === 0) return { category: "unknown", risk: "read", reason: "command", catastrophic: false };

  let worst = classifySegment(segments[0]!);
  for (const seg of segments.slice(1)) {
    const c = classifySegment(seg);
    if (c.catastrophic && !worst.catastrophic) worst = c;
    else if (!worst.catastrophic && RISK_ORDER[c.risk] > RISK_ORDER[worst.risk]) worst = c;
  }
  return worst;
}
