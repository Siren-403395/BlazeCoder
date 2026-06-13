/**
 * Search tools — Glob (find files by name pattern) and Grep (search file contents
 * by regex), both over the real Workspace via its bounded walk(). Glob ignores
 * VCS/dependency dirs; Grep additionally honors .gitignore and skips binary files.
 * Pure-Node (no ripgrep dependency) so behavior is hermetic and cross-platform.
 */

import { relative, sep } from "node:path";
import { isSecretPath } from "@coding-agent/shared";
import { WorkspaceBoundaryError } from "../../workspace/boundary";
import type { Tool, ToolContext, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";

const GLOB_CAP = 100;
const GREP_FILE_CAP = 2000;
const GREP_MATCH_CAP = 200;
const GREP_COUNT_CAP = 100;

/** Translate a path glob (supporting *, ?, and ** across directories) to a RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = "^";
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
  return new RegExp(`${re}$`);
}

function posixRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

export const globTool: Tool = {
  name: TOOL_NAMES.glob,
  readOnly: true,
  description: `Find files by name with a glob pattern (supports *, ?, and ** across directories), e.g. **/*.ts or src/**/*.tsx. Returns up to 100 absolute paths, most-recently-modified first. Skips .git and node_modules.

- To scope to a subdirectory, pass an absolute \`path\`. IMPORTANT: to search from the workspace root, OMIT \`path\` entirely — do NOT pass the strings "undefined" or "null".
- For an open-ended, multi-round search where you'll iterate on the results, use the ${TOOL_NAMES.task} tool instead.`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern, e.g. **/*.ts" },
      path: { type: "string", description: "Directory to search within (absolute; defaults to the workspace root)." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    if (!pattern) return { content: "Glob requires a 'pattern' string.", isError: true };
    let scope: string | undefined;
    if (typeof input.path === "string" && input.path) {
      try {
        scope = ctx.workspace.resolve(input.path);
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) return { content: err.message, isError: true };
        throw err;
      }
    }

    const re = globToRegExp(pattern);
    const anchored = pattern.startsWith("/");
    const root = ctx.workspace.root;
    const all = await ctx.workspace.walk({ respectGitignore: false });
    const hits = all.filter((abs) => {
      if (isSecretPath(abs)) return false; // never surface secret/credential file paths
      if (scope && !(abs === scope || abs.startsWith(scope + sep) || abs.startsWith(scope + "/"))) return false;
      return re.test(anchored ? abs : posixRel(root, abs));
    });

    // Most-recently-modified first.
    const stamped = await Promise.all(hits.map(async (abs) => ({ abs, mtimeMs: (await ctx.workspace.stat(abs))?.mtimeMs ?? 0 })));
    stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const top = stamped.slice(0, GLOB_CAP).map((s) => s.abs);

    if (top.length === 0) return { content: `No files match ${pattern}.` };
    const capped = stamped.length > GLOB_CAP ? `\n…[${stamped.length - GLOB_CAP} more; narrow the pattern]` : "";
    return { content: `${top.join("\n")}${capped}` };
  },
};

export const grepTool: Tool = {
  name: TOOL_NAMES.grep,
  readOnly: true,
  description: `Search file contents with a regular expression. ALWAYS use this tool to search code; NEVER invoke \`grep\` or \`rg\` through ${TOOL_NAMES.bash}.

- output_mode: 'files_with_matches' (default) lists matching files; 'content' shows matching lines as 'path:line: text'; 'count' shows per-file match counts.
- The pattern is a regular expression — escape regex metacharacters (e.g. \\. \\( \\{ ) when you mean them literally.
- Optionally restrict with a path \`glob\` (e.g. **/*.ts) and \`ignore_case\`. Honors .gitignore and skips binary files.`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      glob: { type: "string", description: "Only search files whose path matches this glob (e.g. **/*.ts)." },
      path: { type: "string", description: "Directory to search within (absolute; defaults to the workspace root)." },
      output_mode: { type: "string", enum: ["files_with_matches", "content", "count"] },
      ignore_case: { type: "boolean", description: "Case-insensitive search (default false)." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    if (!pattern) return { content: "Grep requires a 'pattern' string.", isError: true };
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, input.ignore_case === true ? "i" : undefined);
    } catch (e) {
      return { content: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
    const mode = typeof input.output_mode === "string" ? input.output_mode : "files_with_matches";
    const globRe = typeof input.glob === "string" && input.glob ? globToRegExp(input.glob) : undefined;
    const globAnchored = typeof input.glob === "string" && input.glob.startsWith("/");
    let scope: string | undefined;
    if (typeof input.path === "string" && input.path) {
      try {
        scope = ctx.workspace.resolve(input.path);
      } catch (err) {
        if (err instanceof WorkspaceBoundaryError) return { content: err.message, isError: true };
        throw err;
      }
    }

    const root = ctx.workspace.root;
    const all = (await ctx.workspace.walk({ respectGitignore: true })).slice(0, GREP_FILE_CAP);
    const fileMatches: string[] = [];
    const counts: Record<string, number> = {};
    const lines: string[] = [];
    let totalMatches = 0;

    for (const abs of all) {
      if (isSecretPath(abs)) continue; // never read or surface secret/credential file contents
      if (scope && !(abs === scope || abs.startsWith(scope + sep) || abs.startsWith(scope + "/"))) continue;
      if (globRe && !globRe.test(globAnchored ? abs : posixRel(root, abs))) continue;
      const file = await ctx.workspace.read(abs);
      if (!file || file.content.includes("\u0000")) continue;
      const fileLines = file.content.split("\n");
      let fileCount = 0;
      for (let i = 0; i < fileLines.length; i++) {
        if (regex.test(fileLines[i]!)) {
          fileCount++;
          totalMatches++;
          if (mode === "content" && lines.length < GREP_MATCH_CAP) {
            lines.push(`${abs}:${i + 1}: ${fileLines[i]!.trim()}`);
          }
        }
      }
      if (fileCount > 0) {
        fileMatches.push(abs);
        counts[abs] = fileCount;
      }
    }

    if (totalMatches === 0) return { content: `No matches for /${pattern}/.` };
    if (mode === "count") {
      const top = fileMatches.slice(0, GREP_COUNT_CAP);
      const capped = fileMatches.length > GREP_COUNT_CAP ? `\n…[${fileMatches.length - GREP_COUNT_CAP} more file(s)]` : "";
      return { content: `${top.map((f) => `${f}: ${counts[f]}`).join("\n")}${capped}` };
    }
    if (mode === "content") {
      const capped = totalMatches > lines.length ? `\n…[${totalMatches - lines.length} more match(es)]` : "";
      return { content: `${lines.join("\n")}${capped}` };
    }
    return { content: `${fileMatches.length} file(s) with matches:\n${fileMatches.join("\n")}` };
  },
};
