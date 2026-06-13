/**
 * Safety primitives shared across the agent: path-traversal detection, the
 * secret-file deny-list, and a content secret-scanner.
 *
 * Pure string-level checks only (no Node APIs). The CLI wires `isSecretPath` into
 * the file tools (Read/Write/Edit) and recognized Bash readers so secrets are
 * never read or written, `isUnsafeRelativePath` backs the memory-tool sandbox,
 * and `looksLikeSecret` guards file writes against committing credentials.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** Files whose contents are secret and must never be read, written, or printed. */
const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]+)?$/i, // .env, .env.local, .env.production ...
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.gcloud\//i,
  /(^|\/)\.kube\//i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)credentials(\.[^/]+)?$/i,
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

/** True if a path points at a known secret/credential file. */
export function isSecretPath(path: string): boolean {
  return SECRET_PATH_PATTERNS.some((re) => re.test(path));
}

/** True if file content appears to embed a secret (API key, private key, token). */
export function looksLikeSecret(content: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(content));
}
