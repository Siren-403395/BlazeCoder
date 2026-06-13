/**
 * Built-in tool set, at Claude-Code parity: Read, Write, Edit (file tools with the
 * read-before-edit invariant), Glob + Grep (search), Bash (everything else, and
 * verification), and memory (durable cross-session notes). Listing and deletion
 * are handled through Glob/Bash rather than dedicated tools, keeping the surface
 * small and orthogonal.
 */

import type { Tool } from "../registry";
import { editFileTool, readFileTool, writeFileTool } from "./filesystem";
import { globTool, grepTool } from "./search";
import { runCommandTool } from "./shell";
import { todoWriteTool } from "./todo";
import { memoryTool } from "../../memory/memoryTool";

export function builtinTools(): Tool[] {
  return [readFileTool, writeFileTool, editFileTool, globTool, grepTool, runCommandTool, todoWriteTool, memoryTool];
}

export { readFileTool, writeFileTool, editFileTool, globTool, grepTool, runCommandTool, todoWriteTool, memoryTool };
export { makeTaskTool } from "./task";
export * from "../toolNames";
