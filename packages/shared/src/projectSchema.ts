/**
 * File language tagging + the ProjectFile shape the agent's file tools and the
 * file_change event pass around. A "project" is no longer a self-contained graph
 * we copy into memory; the agent edits the real working directory. ProjectFile is
 * just {path, language, content} for a single file in flight.
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
  | "py"
  | "rs"
  | "go"
  | "sh"
  | "yaml"
  | "toml"
  | "txt";

export interface ProjectFile {
  /** Absolute path (real filesystem path, or a virtual "/..." path in tests). */
  path: string;
  language: FileLanguage;
  content: string;
}

export function inferLanguage(path: string): FileLanguage {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".py")) return "py";
  if (lower.endsWith(".rs")) return "rs";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "sh";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".toml")) return "toml";
  return "txt";
}
