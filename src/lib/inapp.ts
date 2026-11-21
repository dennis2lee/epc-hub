// Detect in-app browsers (KakaoTalk etc.) where some features break, and build
// "open in external browser" links. See doc/design.html §7.

export type InAppKind = "kakaotalk" | "naver" | "instagram" | "facebook" | "line" | null;

export function detectInApp(userAgent: string): InAppKind {
  const ua = userAgent.toLowerCase();
  if (ua.includes("kakaotalk")) return "kakaotalk";
  if (ua.includes("naver(inapp")) return "naver";
  if (ua.includes("instagram")) return "instagram";
  if (ua.includes("fban") || ua.includes("fbav")) return "facebook";
  if (ua.includes(" line/")) return "line";
  return null;
}

export function isAndroid(userAgent: string): boolean {
  return /android/i.test(userAgent);
}

/** Link that asks KakaoTalk (or Android) to open the URL in the default browser. */
export function externalBrowserUrl(url: string, userAgent: string): string | null {
  const kind = detectInApp(userAgent);
  if (kind === "kakaotalk") {
    return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  }
  if (kind && isAndroid(userAgent)) {
    const u = new URL(url);
    // No fixed package: Android shows the default browser, with a web fallback.
    return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(":", "")};S.browser_fallback_url=${encodeURIComponent(url)};end`;
  }
  return null;
}
