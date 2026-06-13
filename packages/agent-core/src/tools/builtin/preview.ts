/**
 * build_preview — the "verify" half of the agent loop. Bundles the current
 * workspace via the injected PreviewBuilder (esbuild) and streams the resulting
 * self-contained iframe HTML to the frontend as a `preview` event. The model
 * only sees a concise success/error string, so a failed build feeds straight
 * back into a self-correcting edit loop.
 */

import { validateProject } from "@coding-agent/shared";
import type { Tool, ToolContext, ToolResult } from "../registry";

export const buildPreviewTool: Tool = {
  name: "build_preview",
  readOnly: true,
  description:
    "Bundle the current project and render a live preview for the user. Call this after creating or changing files to verify the app compiles and runs. If it fails, the error tells you exactly what to fix. Requires /src/App.tsx (a default-exported React component) plus the standard Vite files.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute(_input, ctx: ToolContext): Promise<ToolResult> {
    const project = ctx.workspace.snapshot();

    const validation = validateProject(project.files);
    if (!validation.ok) {
      const error = validation.errors.join("; ");
      ctx.emit({ type: "preview", ok: false, error });
      return { content: `Preview blocked by validation: ${error}`, isError: true };
    }

    const result = await ctx.previewBuilder.build(project);
    if (!result.ok || !result.previewHtml) {
      const error = result.error ?? "Unknown build error.";
      ctx.emit({ type: "preview", ok: false, error });
      return { content: `Preview build failed: ${error}`, isError: true };
    }

    ctx.emit({ type: "preview", ok: true, previewHtml: result.previewHtml });
    const warnings = validation.warnings.length ? ` Warnings: ${validation.warnings.join("; ")}` : "";
    return { content: `Preview built successfully and is now shown to the user.${warnings}` };
  },
};
