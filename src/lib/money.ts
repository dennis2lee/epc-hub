// Money helpers. All amounts are stored as integer cents (USD) to avoid
// floating-point rounding. Parsing is strict so that "12.345" or "1,2.3" fail
// loudly instead of being silently rounded.

const MONEY_RE = /^\$?\s*(\d{1,3}(,\d{3})*|\d+)(\.(\d{1,2}))?$/;

/** Parse user input such as "128.4", "$1,280.00" or "15" into cents. Returns null if invalid. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  const m = MONEY_RE.exec(trimmed);
  if (!m) return null;
  const whole = Number(m[1].replace(/,/g, ""));
  const fraction = m[4] ? Number(m[4].padEnd(2, "0")) : 0;
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** Format integer cents as "$1,234.56". */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("cents must be an integer");
  return formatter.format(cents / 100);
}

/** Format cents for CSV export without currency symbol or grouping: "1234.56". */
export function centsToPlain(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
