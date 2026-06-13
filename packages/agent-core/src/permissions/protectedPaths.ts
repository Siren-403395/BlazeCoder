/**
 * Protected paths — checked BEFORE any allow rule and never auto-approved
 * (except under an explicit bypass mode). Mirrors Claude Code's hardcoded set:
 * VCS internals, secrets, credentials, shell rc files, tool config.
 */

const PROTECTED_SUBSTRINGS = [
  ".git/",
  ".env",
  ".ssh/",
  "id_rsa",
  "id_ed25519",
  ".aws/",
  ".gcloud/",
  ".kube/",
  ".npmrc",
  ".mcp.json",
  ".claude/",
  "credentials",
  ".pgpass",
  ".netrc",
];

export function isProtectedPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return PROTECTED_SUBSTRINGS.some((seg) => normalized.includes(seg));
}
