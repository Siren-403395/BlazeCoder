/**
 * Built-in tool set. To add a capability: write a Tool here (or in its own file)
 * and include it — nothing else in the loop changes. This is the primary
 * "new tool" extension point.
 */

import type { Tool } from "../registry";
import { deleteFileTool, editFileTool, listFilesTool, readFileTool, writeFileTool } from "./filesystem";
import { globTool, grepTool } from "./search";
import { runCommandTool } from "./shell";
import { memoryTool } from "../../memory/memoryTool";

export function builtinTools(): Tool[] {
  return [
    listFilesTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    deleteFileTool,
    grepTool,
    globTool,
    runCommandTool,
    memoryTool,
  ];
}

export {
  listFilesTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  grepTool,
  globTool,
  runCommandTool,
  memoryTool,
};
