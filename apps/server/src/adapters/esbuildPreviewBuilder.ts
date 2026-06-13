/**
 * PreviewBuilder backed by standalone esbuild. Bundles the in-memory project
 * (virtual-file plugin, no disk writes) into a single ESM module, keeps React
 * external, and emits a self-contained HTML document that pulls React from a CDN
 * via an import map. This is the salvaged V1 "it runs" loop, de-coupled from
 * Vite's dep-optimizer paths so it works in the standalone backend.
 */

import { build } from "esbuild";
import type { Loader, Plugin } from "esbuild";
import type { GeneratedProject } from "@coding-agent/shared";
import type { PreviewBuilder, PreviewBuildResult } from "@coding-agent/core";

const REACT_VERSION = "18.3.1";
const IMPORT_MAP = {
  imports: {
    react: `https://esm.sh/react@${REACT_VERSION}`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-dev-runtime`,
    "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}?deps=react@${REACT_VERSION}`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client?deps=react@${REACT_VERSION}`,
  },
};

const EXTERNAL = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"];

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

function loaderFor(path: string): Loader {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  return "text";
}

function virtualPlugin(files: Map<string, string>): Plugin {
  const resolve = (spec: string, importer: string): string | undefined => {
    const base = spec.startsWith("/") ? normalize(spec) : normalize(`${dirname(importer)}/${spec}`);
    const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`];
    return candidates.find((c) => files.has(c));
  };

  return {
    name: "virtual-project",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (!args.path.startsWith("/") && !args.path.startsWith(".")) {
          return { path: args.path, external: true };
        }
        const resolved = resolve(args.path, args.importer || "/");
        if (resolved) return { path: resolved, namespace: "virtual" };
        return { errors: [{ text: `Cannot resolve "${args.path}" from "${args.importer || "entry"}"` }] };
      });
      builder.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => ({
        contents: files.get(args.path) ?? "",
        loader: loaderFor(args.path),
        resolveDir: "/",
      }));
    },
  };
}

function htmlDocument(js: string, css: string, title: string): string {
  const errorOverlay = `window.addEventListener('error',function(e){var el=document.getElementById('root');if(el&&!el.__err){el.__err=1;el.innerHTML='<pre style="margin:0;padding:16px;color:#b91c1c;background:#fff1f2;white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace">'+((e.error&&e.error.stack)||e.message)+'</pre>';}});`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/[<>&"]/g, "")}</title>
    <style>html,body,#root{min-height:100%}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}\n${css}</style>
    <script type="importmap">${JSON.stringify(IMPORT_MAP)}</script>
    <script>${errorOverlay}</script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>`;
}

export class EsbuildPreviewBuilder implements PreviewBuilder {
  async build(project: GeneratedProject): Promise<PreviewBuildResult> {
    const files = new Map(project.files.map((f) => [f.path, f.content]));
    if (!files.has("/src/main.tsx")) {
      return { ok: false, error: "Missing entry /src/main.tsx." };
    }
    try {
      const result = await build({
        stdin: { contents: 'import "/src/main.tsx";', resolveDir: "/", sourcefile: "preview-entry.js", loader: "js" },
        bundle: true,
        write: false,
        // An outdir is required so esbuild can assign output paths to the JS and
        // the CSS chunk (CSS imported from JS); nothing is written (write:false).
        outdir: "preview",
        format: "esm",
        jsx: "automatic",
        target: "es2020",
        platform: "browser",
        logLevel: "silent",
        external: EXTERNAL,
        plugins: [virtualPlugin(files)],
      });
      const js = result.outputFiles.filter((f) => f.path.endsWith(".js")).map((f) => f.text).join("\n");
      const css = result.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
      return { ok: true, previewHtml: htmlDocument(js, css, project.projectName || "Preview") };
    } catch (error) {
      const message =
        error && typeof error === "object" && "errors" in error
          ? JSON.stringify((error as { errors: { text: string }[] }).errors.map((e) => e.text))
          : error instanceof Error
            ? error.message
            : String(error);
      return { ok: false, error: message };
    }
  }
}
