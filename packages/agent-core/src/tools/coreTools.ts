/**
 * The core tool allowlist — the tools that are always loaded directly into the
 * model's tool list. Scaffolding for a future deferred-tool mechanism: once the
 * registry grows large (e.g. many MCP tools), non-core tools could be discovered
 * via a search tool and invoked indirectly, keeping the prompt small and the cache
 * stable. NOT YET ACTIVE — every registered tool is still loaded directly.
 */

import { TOOL_NAMES } from "./toolNames";

export const CORE_TOOLS = new Set<string>([
  TOOL_NAMES.read,
  TOOL_NAMES.write,
  TOOL_NAMES.edit,
  TOOL_NAMES.glob,
  TOOL_NAMES.grep,
  TOOL_NAMES.bash,
  TOOL_NAMES.memory,
  TOOL_NAMES.todo,
  TOOL_NAMES.task,
]);
