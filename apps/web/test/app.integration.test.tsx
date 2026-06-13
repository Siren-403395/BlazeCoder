import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentEvent } from "@coding-agent/shared";

// Drive the whole UI with a scripted run instead of a real backend.
vi.mock("@/lib/eventStream", () => ({
  runAgent: vi.fn(async (_body: unknown, onEvent: (e: AgentEvent) => void) => {
    const events: AgentEvent[] = [
      { type: "system", subtype: "init", sessionId: "sess-abc12345", model: "deepseek-chat", tools: ["write_file", "build_preview"], maxTurns: 24, contextTokens: 65536 },
      { type: "assistant", text: "I built a counter app.", toolCalls: [{ id: "t1", name: "write_file", input: { path: "/src/App.tsx" } }] },
      { type: "file_change", op: "write", path: "/src/App.tsx", language: "tsx", content: "export default function App() { return <div>Counter</div>; }" },
      { type: "tool_result", toolUseId: "t1", name: "write_file", content: "Wrote /src/App.tsx", isError: false, durationMs: 12 },
      { type: "file_change", op: "write", path: "/src/index.css", language: "css", content: "body { margin: 0; }" },
      { type: "assistant", text: "Building the preview.", toolCalls: [{ id: "t2", name: "build_preview", input: {} }] },
      { type: "tool_result", toolUseId: "t2", name: "build_preview", content: "Preview built", isError: false, durationMs: 340 },
      { type: "preview", ok: true, previewHtml: "<html><body>Counter</body></html>" },
      { type: "budget", totalTokens: 65536, usedTokens: 12000, remainingTokens: 53536 },
      { type: "result", subtype: "success", numTurns: 2, sessionId: "sess-abc12345", stopReason: "end_turn", totalCostUsd: 0.012, usage: { inputTokens: 1000, outputTokens: 500 }, summary: "Built a counter app." },
    ];
    for (const e of events) onEvent(e);
  }),
}));

import { App } from "@/App";

describe("App — full run", () => {
  it("streams a run into the conversation, files, and status", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText(/Describe the app/i), "make a counter");
    await user.click(screen.getByRole("button", { name: "Send" }));

    // Conversation: prompt, assistant prose, and tool activity rows.
    expect(await screen.findByText("make a counter")).toBeInTheDocument();
    expect(await screen.findByText("I built a counter app.")).toBeInTheDocument();
    expect(await screen.findByText("Write")).toBeInTheDocument();

    // Header + status bar reflect model and terminal status.
    expect(screen.getAllByText("deepseek-chat").length).toBeGreaterThan(0);
    expect(await screen.findByText("Done")).toBeInTheDocument();

    // The workspace can switch to the file tree, which holds the written files.
    await user.click(screen.getByRole("button", { name: /Files/ }));
    expect(await screen.findByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("index.css")).toBeInTheDocument();
  });
});
