import { describe, expect, it } from "vitest";
import { makeWebFetchTool, makeWebSearchTool } from "../src/index";
import type { WebClient } from "../src/index";
import { makeCtx } from "./fakes";

const fakeClient: WebClient = {
  async search(query) {
    return [
      { title: "First", url: "https://a.example/x", snippet: `about ${query}` },
      { title: "Second", url: "https://b.example/y" },
    ];
  },
  async fetch(url, prompt) {
    return `FETCHED ${url} :: ${prompt}`;
  },
};

describe("WebSearch tool", () => {
  it("lists results as markdown links and appends the mandatory Sources reminder", async () => {
    const { ctx } = makeCtx();
    const res = await makeWebSearchTool(fakeClient).execute({ query: "deepseek v4" }, ctx);
    expect(res.content).toContain("[First](https://a.example/x)");
    expect(res.content).toMatch(/REMINDER: You MUST cite the sources/);
  });

  it("description carries the mandatory-Sources rule and a dated recency hint", () => {
    const tool = makeWebSearchTool(fakeClient, new Date("2026-03-15T00:00:00Z"));
    expect(tool.description).toMatch(/MANDATORY/);
    expect(tool.description).toContain("Sources:");
    expect(tool.description).toMatch(/March 2026/);
  });
});

describe("WebFetch tool", () => {
  it("passes url + prompt through (and upgrades http→https)", async () => {
    const { ctx } = makeCtx();
    const res = await makeWebFetchTool(fakeClient).execute({ url: "http://x.example/p", prompt: "summarize" }, ctx);
    expect(res.content).toBe("FETCHED https://x.example/p :: summarize");
  });

  it("description prefers the gh CLI for GitHub", () => {
    expect(makeWebFetchTool(fakeClient).description).toMatch(/gh CLI/);
  });
});
