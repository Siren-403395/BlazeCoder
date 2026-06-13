import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentEvent } from "@coding-agent/shared";

vi.mock("@/lib/api", () => ({ postPermission: vi.fn(async () => {}) }));

vi.mock("@/lib/eventStream", () => ({
  runAgent: vi.fn(async (_body: unknown, onEvent: (e: AgentEvent) => void) => {
    const events: AgentEvent[] = [
      { type: "system", subtype: "init", sessionId: "s", model: "deepseek-chat", tools: ["run_command"], maxTurns: 24, contextTokens: 65536 },
      { type: "assistant", text: "I need to install dependencies first.", toolCalls: [] },
      { type: "permission_request", requestId: "req-1", toolName: "run_command", input: { command: "npm install" }, reason: "This will install dependencies." },
    ];
    for (const e of events) onEvent(e);
  }),
}));

import { App } from "@/App";
import { postPermission } from "@/lib/api";

describe("App — permission flow", () => {
  it("surfaces a permission request and relays the decision", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByPlaceholderText(/Describe the app/i), "set it up");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Permission needed")).toBeInTheDocument();
    expect(screen.getByText("run_command")).toBeInTheDocument();
    expect(screen.getByText("This will install dependencies.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Allow" }));
    expect(postPermission).toHaveBeenCalledWith({ requestId: "req-1", behavior: "allow" });
  });
});
