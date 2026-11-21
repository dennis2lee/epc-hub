import { describe, expect, it } from "vitest";
import { centsToPlain, formatCents, parseDollarsToCents } from "./money";
import { churchDate, daysBetween } from "./time";

describe("parseDollarsToCents", () => {
  it.each([
    ["128.4", 12840],
    ["$1,280.00", 128000],
    ["15", 1500],
    ["0.05", 5],
    [" $7.5 ", 750],
  ])("parses %s", (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "12.345", "1,2.3", "-5", "12.", "$"])("rejects %s", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats cents as USD", () => {
    expect(formatCents(128040)).toBe("$1,280.40");
    expect(centsToPlain(128040)).toBe("1280.40");
    expect(centsToPlain(-5)).toBe("-0.05");
  });
});

describe("church time zone", () => {
  it("uses the church-local date, not UTC", () => {
    // 2026-12-31 22:00 in Los Angeles is already 2027-01-01 in UTC.
    const instant = new Date("2027-01-01T06:00:00Z");
    expect(churchDate(instant, "America/Los_Angeles")).toBe("2026-12-31");
    expect(churchDate(instant, "UTC")).toBe("2027-01-01");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-01", "2026-11-30")).toBe(60);
  });
});
