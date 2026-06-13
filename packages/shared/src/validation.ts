/**
 * Validation primitives — salvaged from V1's projectValidation.ts and generalized.
 *
 * Pure string-level checks only (no Node APIs) so this module is safe to import
 * from both the browser and the server. The backend wires `validateProjectFile`
 * into a built-in PreToolUse hook so write/edit are gated *regardless* of model
 * output, and reuses `isUnsafeRelativePath` for the memory-tool sandbox.
 */

import type { ProjectFile } from "./projectSchema";
import { REQUIRED_FILES } from "./projectSchema";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /token\s*[:=]\s*['"][^'"]+['"]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** True if a path attempts traversal or other obviously-unsafe shapes. */
export function isUnsafeRelativePath(path: string): boolean {
  const lowered = path.toLowerCase();
  return (
    path.includes("../") ||
    path.includes("..\\") ||
    lowered.includes("%2e%2e%2f") ||
    lowered.includes("%2e%2e/") ||
    path.includes("\0")
  );
}

/** Validate a single file about to be written into the project graph. */
export function validateProjectFile(file: Pick<ProjectFile, "path" | "content">): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!file.path.startsWith("/")) {
    errors.push(`File path must start with "/": ${file.path}`);
  }
  if (isUnsafeRelativePath(file.path)) {
    errors.push(`Unsafe path traversal is not allowed: ${file.path}`);
  }
  if (file.path.toLowerCase().includes(".env")) {
    errors.push(`Environment files are not allowed in generated projects: ${file.path}`);
  }
  if (!file.content.trim()) {
    errors.push(`File content cannot be empty: ${file.path}`);
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(file.content)) {
      errors.push(`Possible secret detected in file: ${file.path}`);
      break;
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Validate the whole project graph (used before preview / export). */
export function validateProject(files: ProjectFile[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const paths = new Set(files.map((f) => f.path));

  for (const required of REQUIRED_FILES) {
    if (!paths.has(required)) errors.push(`Missing required file: ${required}`);
  }
  for (const file of files) {
    const single = validateProjectFile(file);
    errors.push(...single.errors);
    warnings.push(...single.warnings);
  }

  const appFile = files.find((f) => f.path === "/src/App.tsx");
  if (appFile && !appFile.content.includes("export default")) {
    warnings.push("/src/App.tsx should export a default React component.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
