/**
 * Concrete WebClient — real HTTP for WebFetch (GET + a crude HTML→text reduction),
 * and a DuckDuckGo HTML scrape for WebSearch (no API key). Best-effort: network
 * failures return a short error string the model can react to, never throw.
 */

import type { WebClient, WebSearchResult } from "@zephyrcode/core";

const UA = "Mozilla/5.0 (compatible; zephyrcode/0.1; +https://example.invalid)";
const MAX_FETCH_CHARS = 100_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export class HttpWebClient implements WebClient {
  async search(query: string): Promise<WebSearchResult[]> {
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA } });
      const html = await res.text();
      const results: WebSearchResult[] = [];
      const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && results.length < 10) {
        results.push({ url: decodeURIComponent(m[1]!.replace(/^.*?uddg=/, "").replace(/&.*$/, "")) || m[1]!, title: stripHtml(m[2]!) });
      }
      return results;
    } catch {
      return [];
    }
  }

  async fetch(url: string, prompt: string): Promise<string> {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
      if (!res.ok) return `Fetch failed: HTTP ${res.status} for ${url}.`;
      const finalUrl = res.url;
      const note = new URL(finalUrl).host !== new URL(url).host ? `[redirected to ${finalUrl}]\n` : "";
      const text = stripHtml(await res.text()).slice(0, MAX_FETCH_CHARS);
      return `${note}Extract for: ${prompt}\n\n${text}`;
    } catch (err) {
      return `Fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}.`;
    }
  }
}
