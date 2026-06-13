/**
 * Search tools — grep (content regex) and glob (path matching) over the virtual
 * workspace. These enforce just-in-time retrieval: the model finds the few
 * relevant locations instead of pulling whole files into context.
 */

import type { Tool, ToolContext, ToolResult } from "../registry";

const MAX_MATCHES = 200;

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
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

export const grepTool: Tool = {
  name: "grep",
  readOnly: true,
  description:
    "Search file contents across the workspace with a regular expression. Returns matching lines as 'path:line: text'. Optionally restrict to files whose path matches a glob (path_glob), and set ignore_case.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "JavaScript regular expression." },
      path_glob: { type: "string", description: "Only search files whose path matches this glob (e.g. /src/**/*.tsx)." },
      ignore_case: { type: "boolean", description: "Case-insensitive search (default false)." },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    if (!pattern) return { content: "grep requires a 'pattern' string.", isError: true };
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, input.ignore_case === true ? "i" : undefined);
    } catch (e) {
      return { content: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
    const pathGlob = typeof input.path_glob === "string" ? globToRegExp(input.path_glob) : undefined;

    const matches: string[] = [];
    for (const file of ctx.workspace.list()) {
      if (pathGlob && !pathGlob.test(file.path)) continue;
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          matches.push(`${file.path}:${i + 1}: ${lines[i]!.trim()}`);
          if (matches.length >= MAX_MATCHES) break;
        }
      }
      if (matches.length >= MAX_MATCHES) break;
    }
    if (matches.length === 0) return { content: `No matches for /${pattern}/.` };
    const capped = matches.length >= MAX_MATCHES ? `\n…[capped at ${MAX_MATCHES} matches]` : "";
    return { content: `${matches.length} match(es):\n${matches.join("\n")}${capped}` };
  },
};

export const globTool: Tool = {
  name: "glob",
  readOnly: true,
  description:
    "Find workspace file paths matching a glob pattern (supports * and **). Example: /src/**/*.tsx. Returns matching absolute paths.",
  inputSchema: {
    type: "object",
    properties: { pattern: { type: "string", description: "Glob pattern, e.g. /src/**/*.ts" } },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    if (!pattern) return { content: "glob requires a 'pattern' string.", isError: true };
    const regex = globToRegExp(pattern);
    const hits = ctx.workspace
      .list()
      .map((f) => f.path)
      .filter((p) => regex.test(p))
      .sort();
    return { content: hits.length ? hits.join("\n") : `No files match ${pattern}.` };
  },
};
