// Sanitize the "next" redirect target to prevent open redirects: only allow
// same-origin relative paths such as "/claims/123". URL parsers silently drop
// tabs and newlines and treat "\" like "/", so any control character or
// backslash is rejected and the result is re-serialized from a parsed URL.

const BASE = "http://same-origin.invalid";

export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (parsed.origin !== BASE) return fallback;
  // Dot segments are resolved by the parser ("/.//evil.com" -> "//evil.com"),
  // so the normalized output must be checked again.
  const out = parsed.pathname + parsed.search + parsed.hash;
  if (!out.startsWith("/") || out.startsWith("//")) return fallback;
  return out;
}
