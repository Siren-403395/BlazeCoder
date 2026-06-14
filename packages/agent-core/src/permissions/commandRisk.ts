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
 *    destroy the machine/data with no undo (rm -rf of a root/home/system-dir target, a
 *    fork bomb, dd/mkfs/redirect to a block device, recursive chmod/chown on / or ~,
 *    `find <root> -delete`). The engine uses it to FORCE a confirmation even under a broad
 *    "always allow" rule — a user who allowed `Bash(git:*)` did not consent to `rm -rf ~`.
 *    Deliberately conservative: `rm -rf node_modules` / `rm -rf /tmp/*` are destructive but
 *    NOT catastrophic.
 *
 * BEST-EFFORT, NOT A SANDBOX. This is a heuristic pattern matcher, not a shell. It unwraps
 * sudo / path-qualified binaries (`/bin/rm`) / alias-bypass (`\rm`) / xargs|busybox / a
 * single `sh -c`/`eval` layer, but a sufficiently obfuscated command (deep indirection,
 * `$(...)` substitution, runtime-computed paths) can still slip the catastrophic flag. It
 * is defense-in-depth on top of the normal permission prompt, and it errs toward warning.
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
/** Leading commands that just run another command — strip so we judge the REAL one. */
const COMMAND_WRAPPERS = new Set(["sudo", "doas", "xargs", "busybox"]);
/** Catastrophic system roots (deleting any of these wipes the OS). Curated FHS + macOS dirs —
 *  deliberately NOT including scratch mounts (/tmp, /mnt, /media, /Volumes, /data). */
const SYSTEM_DIR = /^\/(bin|boot|dev|etc|lib|lib32|lib64|proc|root|run|sbin|srv|sys|usr|var|opt|home|System|Library|Applications|Users|private)(\/\*?)?$/;

function tokens(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean);
}

/** Resolve a command head to its bare name: drop a leading alias-bypass backslash and any
 *  directory prefix, so `\rm`, `/bin/rm`, and `./rm` all judge as `rm`. */
function realHead(token: string): string {
  return token.replace(/^\\/, "").replace(/^.*\//, "");
}

/** Strip one layer of matching surrounding quotes so `"$HOME"` compares as `$HOME`. */
function unquote(s: string): string {
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s;
}

/** A root / home / system-dir target — the genuinely irreversible deletion targets. */
function isRootHomeOrSystem(a: string): boolean {
  return (
    a === "/" ||
    a === "/*" ||
    a === "~" ||
    a === "~/" ||
    a === "~/*" ||
    /^\$\{?HOME\}?\/?\*?$/.test(a) || // $HOME, ${HOME}, $HOME/, $HOME/*
    SYSTEM_DIR.test(a)
  );
}

/**
 * Does this segment target a catastrophic path? `includeCwdGlob` also counts the blunt
 * cwd/glob targets (`*`, `.`, `./`) — true for rm/chmod (a bare `rm -rf *` is dangerous
 * enough to confirm), false for `find` (`find . -delete` is a common scoped cleanup).
 */
function hasDangerousFsTarget(rawArgs: string[], includeCwdGlob = true): boolean {
  return rawArgs.map(unquote).some((a) => {
    if (/^-/.test(a)) return false; // a flag, not a target (also skips the `--` end-of-options marker)
    return isRootHomeOrSystem(a) || (includeCwdGlob && (a === "*" || a === "." || a === "./"));
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
  // Redirect to a raw block device (any context — `echo x>/dev/sda` has no space before `>`).
  if (/(>|>>)\s*\/dev\/(sd|disk|nvme|hd|mmcblk|vd)/.test(c)) return true;
  return false;
}

/**
 * If the command is a single `sh -c '...'` / `eval ...` wrapper (optionally behind sudo),
 * return the inner command so the caller can classify what ACTUALLY runs. Returns null when
 * it isn't such a wrapper.
 */
function unwrapShellCommand(raw: string): string | null {
  const s = raw.replace(/^(?:sudo|doas)\s+(?:-\S+\s+)*/, "");
  const shc = s.match(/^\\?(?:\/\S+\/)?(?:bash|sh|zsh|dash|ash|ksh)\s+(?:-[A-Za-z]+\s+)*-c\s+(.+)$/);
  if (shc) return stripWrappingQuotes(shc[1]!.trim());
  const ev = s.match(/^eval\s+(.+)$/);
  if (ev) return stripWrappingQuotes(ev[1]!.trim());
  return null;
}

function stripWrappingQuotes(s: string): string {
  const m = s.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2]! : s;
}

/** Classify one already-normalized segment. */
function classifySegment(segment: string): CommandClassification {
  let t = tokens(segment);
  // Strip leading wrappers (sudo/doas/xargs/busybox) + their options, so we judge the REAL
  // command — `sudo rm -rf /` and `busybox rm -rf /` are rm's risk, only worse.
  while (t.length > 0 && COMMAND_WRAPPERS.has(realHead(t[0]!))) {
    t = t.slice(1);
    while (t.length > 1 && /^-/.test(t[0]!)) t = /^-[a-zA-Z]$/.test(t[0]!) ? t.slice(2) : t.slice(1);
  }
  const head = realHead(t[0] ?? "");
  const args = t.slice(1);

  // ── Catastrophic, irreversible ──
  if (head === "rm" && hasRecursiveForce(args) && hasDangerousFsTarget(args)) {
    return { category: "filesystem", risk: "destructive", reason: "recursive force-delete of a root/home path", catastrophic: true };
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
  if (head === "find" && args.some((a) => a === "-delete" || a === "-exec") && hasDangerousFsTarget(args, false)) {
    return { category: "filesystem", risk: "destructive", reason: "find -delete/-exec on a root/home path", catastrophic: true };
  }

  // ── Destructive but not catastrophic (reversible-ish or scoped) ──
  if (head === "rm" && (hasRecursiveForce(args) || args.some((a) => /^-[^-]*r/i.test(a)))) {
    return { category: "filesystem", risk: "destructive", reason: "recursive delete", catastrophic: false };
  }
  if (head === "shred" || head === "truncate") {
    return { category: "filesystem", risk: "destructive", reason: "destroys file contents", catastrophic: false };
  }
  if (head === "chmod" || head === "chown") {
    return { category: "filesystem", risk: "write", reason: `${head} changes file ${head === "chmod" ? "permissions" : "ownership"}`, catastrophic: false };
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
 * describes that worst segment. A leading `sh -c`/`eval` wrapper is peeled (bounded
 * recursion) so the inner command is judged; device redirects are caught on the whole
 * command (operators are part of the signature).
 */
export function classifyCommand(command: string, depth = 0): CommandClassification {
  const raw = command.trim();
  if (!raw) return { category: "unknown", risk: "read", reason: "empty command", catastrophic: false };

  // Peel a `sh -c '...'` / `eval ...` wrapper and judge what actually runs.
  if (depth < 3) {
    const inner = unwrapShellCommand(raw);
    if (inner && inner !== raw) return classifyCommand(inner, depth + 1);
  }

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
