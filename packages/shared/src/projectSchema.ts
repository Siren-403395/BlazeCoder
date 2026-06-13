/**
 * GeneratedProject — the file-graph contract shared between frontend and backend.
 *
 * This is the substrate the agent's filesystem tools (list_files / read_file /
 * write_file / edit_file) operate over, and what the preview builder and the
 * client-side exporter consume. Salvaged from V1 and kept deliberately small:
 * a project is just a flat list of files plus light metadata.
 */

export type FileLanguage =
  | "json"
  | "tsx"
  | "ts"
  | "jsx"
  | "js"
  | "css"
  | "md"
  | "html"
  | "txt";

export interface ProjectFile {
  /** Absolute project path, always starts with "/", e.g. "/src/App.tsx". */
  path: string;
  language: FileLanguage;
  content: string;
}

export interface GeneratedProject {
  projectName: string;
  summary: string;
  features: string[];
  files: ProjectFile[];
  runInstructions: string;
}

/** A React + Vite project must contain these for the preview/export to work. */
export const REQUIRED_FILES = [
  "/package.json",
  "/index.html",
  "/src/main.tsx",
  "/src/App.tsx",
  "/src/index.css",
] as const;

/** The single entry the preview bundler resolves from. */
export const PREVIEW_ENTRY = "/src/App.tsx";

export function inferLanguage(path: string): FileLanguage {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md")) return "md";
  if (path.endsWith(".json")) return "json";
  return "txt";
}

export function emptyProject(projectName = "untitled-project"): GeneratedProject {
  return {
    projectName,
    summary: "",
    features: [],
    files: [],
    runInstructions: "Run npm install, then npm run dev.",
  };
}
