/**
 * Mask sensitive tokens, credentials, and secrets in free-text output.
 * Safe to apply to error messages, command output, diagnostic text, and URLs.
 */
export function maskSensitiveText(value: string): string {
  if (typeof value !== "string") return String(value ?? "");

  return (
    value
      // Bearer tokens
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
      // OpenAI keys
      .replace(/\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
      .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "sk-***")
      // GitHub PATs
      .replace(/\bghp_[A-Za-z0-9]{36,}\b/g, "ghp_***")
      .replace(/\bgithub_pat_[A-Za-z0-9]{22,}\b/g, "github_pat_***")
      // GitLab PATs
      .replace(/\bglpat-[A-Za-z0-9_-]{10,}\b/g, "glpat-***")
      // JWT-like tokens (three base64url segments)
      .replace(/\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g, "***")
      // OAuth / access / refresh / session / id tokens as key=value or key: value
      .replace(/((?:oauth|access|refresh|session|id)[_-]?token\s*[:=]\s*)[^\s"';,]+/gi, "$1***")
      // OMK session/run/goal identifiers
      .replace(/\b(OMK_[A-Z_][A-Za-z0-9_]*)\s*[:=]\s*[^\s"';,]+/g, "$1=***")
      // CLI flags like --api-key=...
      .replace(/(--(?:api[-_]?key|api[-_]?token|token|key|secret|password|client[-_]?secret|x[-_]?auth[-_]?token)(?:=|\s+))[^"'`\s;]+/gi, "$1***")
      // Env var assignments with secret-like names
      .replace(/([A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DSN|PAT|URI|JWT|BEARER|OAUTH)[A-Za-z0-9_]*\s*=\s*)[^"'`\s;]+/gi, "$1***")
      // URL query parameters with secrets
      .replace(/([?&](?:token|api[-_]?key|key|secret|password|auth|credential|session|bearer|access[-_]?token|refresh[-_]?token|client[-_]?secret|x[-_]?auth[-_]?token|signature|sig|jwt|private[-_]?key|pat|dsn)=)[^&#"'`\s]+/gi, "$1***")
      // URL fragments after hash
      .replace(/(https?:\/\/[^#\s"'`]+)#[^ \t\r\n"'`]+/gi, "$1#***")
      // URL credentials user:pass@
      .replace(/[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, "***@")
      // Authorization / Proxy-Authorization headers
      .replace(/\b(authorization|proxy-authorization)\s*([:=])\s*(?:Bearer\s+)?[^\s"',;]+/gi, "$1$2 Bearer ***")
      // Cookie / Set-Cookie headers
      .replace(/\b(cookie|set-cookie)\s*([:=])\s*[^"'\n]+/gi, "$1$2 ***")
      // x-api-key, x-auth-token, and similar inline secrets
      .replace(/((?:x-api-key|x-auth-token|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password|client[_-]?secret|private[-_]?key)\s*[:=]\s*)[^\s"',;]+/gi, "$1***")
  );
}
