// Time helpers. The database stores timestamptz; every "which day is it"
// decision uses the church's local time zone, never the server's (UTC on Vercel).

export const CHURCH_TIME_ZONE = process.env.NEXT_PUBLIC_CHURCH_TIME_ZONE ?? "America/Los_Angeles";

/** Return the church-local calendar date (YYYY-MM-DD) for an instant. */
export function churchDate(instant: Date = new Date(), timeZone: string = CHURCH_TIME_ZONE): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Format an instant for display, e.g. "11/19 7:05 AM", in church-local time. */
export function formatChurchDateTime(iso: string | Date, timeZone: string = CHURCH_TIME_ZONE): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Format a calendar date (YYYY-MM-DD) as "11/18 (수)"; with English, "11/18 (Wed)". */
export function formatDay(ymd: string | null | undefined, lang: "ko" | "en" = "ko"): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  // Noon UTC keeps the weekday stable in every US time zone.
  const d = new Date(`${ymd}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { weekday: "short", timeZone: "UTC" }).format(d);
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))} (${weekday})`;
}
