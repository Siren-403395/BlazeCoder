/**
 * File-path rule matching for Read/Write/Edit. Patterns are gitignore-style globs
 * (`*`, `?`, `**`) rooted by the rule's source (ported from the reference):
 *   - `//Users/me/proj/**` → fs-absolute glob
 *   - `~/notes/**`         → relative to the home directory
 *   - `/src/**`            → relative to the source settings dir (sourceRootDir)
 *   - `src/**` or `./src/**`→ match anywhere in the path (no anchored root)
 */

import { homedir } from "node:os";
import { join } from "node:path";

const toPosix = (p: string): string => p.split("\\").join("/");

/** Translate a glob to a RegExp (mirrors the workspace search matcher). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
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
  return new RegExp(`^${re}$`);
}

export function pathMatchesRule(ruleContent: string, filePath: string, sourceRootDir?: string): boolean {
  if (!filePath || !ruleContent) return false;
  const path = toPosix(filePath);

  if (ruleContent.startsWith("//")) {
    return globToRegExp(ruleContent.slice(1)).test(path); // fs-absolute
  }
  if (ruleContent.startsWith("~/")) {
    return globToRegExp(toPosix(join(homedir(), ruleContent.slice(2)))).test(path);
  }
  if (ruleContent.startsWith("/")) {
    const rooted = sourceRootDir ? toPosix(join(sourceRootDir, ruleContent.slice(1))) : ruleContent;
    return globToRegExp(rooted).test(path);
  }
  // bare / ./ → match anywhere in the path.
  const bare = ruleContent.startsWith("./") ? ruleContent.slice(2) : ruleContent;
  return globToRegExp(bare).test(path) || globToRegExp(`**/${bare}`).test(path);
}
