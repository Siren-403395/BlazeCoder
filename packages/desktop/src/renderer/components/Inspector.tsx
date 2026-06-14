import { Check, ListChecks, SquareDashed } from "lucide-react";
import type { TodoItem } from "@blazecoder/shared";
import type { ToolItem } from "../app/types";
import { DiffViewer } from "./DiffViewer";
import { stringifyInput } from "../app/format";

const MAX_OUTPUT = 4000;

export function Inspector({
  diffTool,
  inspectTool,
  todos,
}: {
  diffTool?: ToolItem;
  inspectTool?: ToolItem;
  todos: TodoItem[];
}) {
  return (
    <aside className="inspector">
      <section className="panel panel--grow">
        <div className="panel__head">
          <span className="panel__title">
            <SquareDashed size={14} strokeWidth={1.75} />
            {diffTool ? "Diff" : "Inspector"}
          </span>
        </div>
        <div className="inspector__body">
          {diffTool?.diff ? (
            <DiffViewer diff={diffTool.diff} path={diffTool.filePath} />
          ) : inspectTool ? (
            <ToolInspector tool={inspectTool} />
          ) : (
            <p className="empty empty--center">Select a tool to inspect its input, output, and diff.</p>
          )}
          {diffTool && inspectTool && diffTool !== inspectTool ? <ToolInspector tool={inspectTool} /> : null}
        </div>
      </section>

      {todos.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <span className="panel__title">
              <ListChecks size={14} strokeWidth={1.75} />
              Plan
            </span>
            <span className="panel__stat">
              {todos.filter((t) => t.status === "completed").length}/{todos.length}
            </span>
          </div>
          <ul className="todos">
            {todos.map((t, i) => (
              <li key={i} className={`todos__item is-${t.status}`}>
                <span className="todos__mark" aria-hidden>
                  {t.status === "completed" ? <Check size={13} strokeWidth={2.25} /> : t.status === "in_progress" ? "▸" : "○"}
                </span>
                <span>{t.status === "in_progress" ? t.activeForm : t.content}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}

function ToolInspector({ tool }: { tool: ToolItem }) {
  const output = tool.output ?? "";
  const clipped = output.length > MAX_OUTPUT;
  return (
    <div className="toolinspect">
      <div className="toolinspect__meta">
        <span className="toolinspect__name">{tool.name}</span>
        <span className="toolinspect__time">{tool.durationMs !== undefined ? `${tool.durationMs}ms` : "pending"}</span>
      </div>
      <label className="toolinspect__label">Input</label>
      <pre className="code">{stringifyInput(tool.input)}</pre>
      {tool.output !== undefined ? (
        <>
          <label className="toolinspect__label">Output</label>
          <pre className={`code ${tool.isError ? "code--error" : ""}`}>
            {clipped ? `${output.slice(0, MAX_OUTPUT)}\n… (${output.length - MAX_OUTPUT} more chars)` : output || " "}
          </pre>
        </>
      ) : null}
    </div>
  );
}
