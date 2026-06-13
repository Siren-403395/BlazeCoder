/**
 * Web tools — WebSearch + WebFetch — behind an injected WebClient port so
 * agent-core stays host-agnostic (the CLI provides the concrete HTTP adapter).
 * Off by default (zephyrcode runs against DeepSeek, not a server-side search), so
 * the runtime only registers these when a WebClient is configured.
 *
 * The descriptions carry the reference clone's load-bearing rules verbatim
 * (scrubbed): WebSearch MUST cite Sources as markdown hyperlinks; WebFetch should
 * prefer the gh CLI for GitHub and upgrades http→https.
 */

import type { Tool, ToolResult } from "../registry";
import { TOOL_NAMES } from "../toolNames";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebClient {
  search(query: string): Promise<WebSearchResult[]>;
  fetch(url: string, prompt: string): Promise<string>;
}

function currentMonth(now: Date): string {
  return `${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()}`;
}

export function makeWebSearchTool(client: WebClient, now: Date = new Date()): Tool {
  return {
    name: "WebSearch",
    readOnly: true,
    description: `Search the web and use the results to inform your response. Useful for current events and information past your knowledge cutoff.

- Account for the current date when interpreting recency — the current month is ${currentMonth(now)}; use the correct year in date-sensitive queries.
- CRITICAL REQUIREMENT: when you use search results in your answer you MUST include a "Sources:" section listing each source as a markdown hyperlink [Title](URL). This is MANDATORY, not optional.`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query." } },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input): Promise<ToolResult> {
      const query = typeof input.query === "string" ? input.query : "";
      if (!query.trim()) return { content: "WebSearch requires a 'query'.", isError: true };
      const results = await client.search(query);
      if (results.length === 0) return { content: `No web results for "${query}".` };
      const body = results
        .map((r, i) => `${i + 1}. [${r.title}](${r.url})${r.snippet ? `\n   ${r.snippet}` : ""}`)
        .join("\n");
      return { content: `${body}\n\nREMINDER: You MUST cite the sources you use above as markdown hyperlinks in a "Sources:" section.` };
    },
  };
}

export function makeWebFetchTool(client: WebClient): Tool {
  return {
    name: "WebFetch",
    readOnly: true,
    description: `Fetch a URL and extract information from it according to a prompt. Read-only.

- For GitHub URLs, prefer the gh CLI via ${TOOL_NAMES.bash} (e.g. \`gh issue view\`) — it's faster and more reliable than scraping.
- http:// URLs are upgraded to https://. Redirects to a different host are surfaced rather than followed silently.`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The absolute URL to fetch." },
        prompt: { type: "string", description: "What to extract from the page." },
      },
      required: ["url", "prompt"],
      additionalProperties: false,
    },
    async execute(input): Promise<ToolResult> {
      const url = typeof input.url === "string" ? input.url : "";
      const prompt = typeof input.prompt === "string" ? input.prompt : "";
      if (!url.trim() || !prompt.trim()) return { content: "WebFetch requires 'url' and 'prompt'.", isError: true };
      return { content: await client.fetch(url.replace(/^http:\/\//i, "https://"), prompt) };
    },
  };
}

/** Both web tools, for the runtime to append when a WebClient is configured. */
export function webTools(client: WebClient, now?: Date): Tool[] {
  return [makeWebSearchTool(client, now), makeWebFetchTool(client)];
}
