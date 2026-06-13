import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { renderMarkdown } from "../src/tui/markdown";
import { ItemView } from "../src/tui/view";

describe("renderMarkdown (third-party marked + marked-terminal)", () => {
  it("strips markdown syntax and keeps the prose", () => {
    const out = renderMarkdown("# Title\n\nSome **bold** and `code` here.", 80);
    expect(out).toContain("Title");
    expect(out).toContain("bold");
    expect(out).toContain("code");
    expect(out).not.toContain("**"); // bold markers gone
    expect(out).not.toContain("# Title"); // heading marker gone (showSectionPrefix: false)
  });

  it("renders list items as bullets, not raw dashes", () => {
    const out = renderMarkdown("- alpha\n- beta", 80);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).not.toMatch(/^- alpha/m);
  });

  it("never throws on malformed input", () => {
    expect(() => renderMarkdown("```\nunclosed fence", 80)).not.toThrow();
    expect(renderMarkdown("", 80)).toBe("");
  });
});

describe("AssistantView markdown integration", () => {
  it("renders FINALIZED assistant prose as markdown (syntax stripped)", () => {
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "assistant", id: "a", text: "## Plan\n\nDo the **thing**.", streaming: false }} reasoning="hidden" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Plan");
    expect(frame).toContain("thing");
    expect(frame).not.toContain("**");
    expect(frame).not.toContain("## Plan");
    unmount();
  });

  it("leaves STREAMING assistant text raw (no half-parsed reflow mid-stream)", () => {
    const { lastFrame, unmount } = render(
      <ItemView item={{ kind: "assistant", id: "a", text: "Do the **thing**.", streaming: true }} reasoning="hidden" />,
    );
    expect(lastFrame() ?? "").toContain("**thing**"); // raw while streaming
    unmount();
  });
});
