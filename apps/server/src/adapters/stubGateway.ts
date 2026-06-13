/**
 * Deterministic, network-free ModelGateway used for end-to-end tests and offline
 * demos (enable with AGENT_FAKE_MODEL=1). It drives the real loop, real tools,
 * and the real esbuild preview builder through a fixed three-step plan:
 *   1) write a small counter app, 2) build_preview, 3) finish.
 * It is stateless: the step is derived from how many tool-result messages the
 * request already contains.
 */

import type { ToolCall } from "@coding-agent/shared";
import type { ModelGateway, ModelRequest, ModelResponse } from "@coding-agent/core";

const COUNTER_APP: Record<string, string> = {
  "/package.json": JSON.stringify({ name: "counter", private: true, version: "0.0.0" }, null, 2) + "\n",
  "/index.html": '<!doctype html><html><body><div id="root"></div></body></html>\n',
  "/vite.config.ts": "export default {};\n",
  "/src/main.tsx":
    'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  "/src/App.tsx":
    'import { useState } from "react";\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main className="app">\n      <h1>Counter</h1>\n      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>\n    </main>\n  );\n}\n',
  "/src/index.css":
    ".app { font-family: system-ui; text-align: center; padding: 48px; }\nbutton { font-size: 18px; padding: 8px 16px; cursor: pointer; }\n",
};

export class StubGateway implements ModelGateway {
  readonly model = "stub-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const toolTurns = request.messages.filter((m) => m.role === "tool").length;
    const usage = { inputTokens: 100 + toolTurns * 50, outputTokens: 40 };
    const costUsd = 0.0001;

    if (toolTurns === 0) {
      const toolCalls: ToolCall[] = Object.entries(COUNTER_APP).map(([path, content], i) => ({
        id: `w${i}`,
        name: "write_file",
        input: { path, content },
      }));
      return { text: "Scaffolding a counter app.", toolCalls, stopReason: "end_turn", usage, costUsd };
    }
    if (toolTurns === 1) {
      return {
        text: "Verifying the build.",
        toolCalls: [{ id: "preview", name: "build_preview", input: {} }],
        stopReason: "end_turn",
        usage,
        costUsd,
      };
    }
    return {
      text: "Built a counter app: click the button to increment the count.",
      toolCalls: [],
      stopReason: "end_turn",
      usage,
      costUsd,
    };
  }
}
