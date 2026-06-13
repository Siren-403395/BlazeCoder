/**
 * A small but faithful .gitignore matcher. Supports the common subset that
 * matters for an agent walking a repo: comments (#), blank lines, negation (!),
 * directory-only rules (trailing /), root-anchored rules (leading /), and the
 * `*` / `?` / `**` globs. Patterns without a slash match at any depth (git's
 * basename rule); patterns with a slash are anchored to the ignore file's dir.
 *
 * It is deliberately self-contained (no dependency) so search stays hermetic and
 * cross-platform. Paths passed in are POSIX-style, relative to the repo root.
 */

export interface IgnoreRule {
  negated: boolean;
  dirOnly: boolean;
  /** Matches the path itself OR anything beneath it (so a dir rule ignores its contents). */
  re: RegExp;
  /** Matches ONLY the path itself (used to distinguish "the dir" from "files under it"). */
  bareRe: RegExp;
}

/** Build the regex source that matches a path against a single glob (no descendant suffix). */
function bareSource(pattern: string): string {
  const anchored = pattern.includes("/");
  const body = anchored && pattern.startsWith("/") ? pattern.slice(1) : pattern;

  let re = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "*") {
      if (body[i + 1] === "*") {
        i++;
        if (body[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }

  const prefix = anchored ? "^" : "^(?:.*/)?";
  return `${prefix}${re}`;
}

export function compileIgnore(lines: string[]): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of lines) {
    let line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    // Unescape leading `\#` / `\!`.
    line = line.replace(/^\\([#!])/, "$1");
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    try {
      const base = bareSource(line);
      rules.push({ negated, dirOnly, re: new RegExp(`${base}(?:/.*)?$`), bareRe: new RegExp(`${base}$`) });
    } catch {
      // Skip a pattern we cannot compile rather than failing the whole walk.
    }
  }
  return rules;
}

/** Apply rules in order; the last matching rule wins (git semantics). */
export function isIgnored(relPath: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (!rule.re.test(relPath)) continue;
    // A directory-only rule never matches a *file* whose whole path equals the
    // pattern; but it still ignores files BENEATH a matching directory.
    if (rule.dirOnly && !isDir && rule.bareRe.test(relPath)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}
