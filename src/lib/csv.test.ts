import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("csvCell", () => {
  it("quotes plain text and doubles quotes", () => {
    expect(csvCell('성탄 "간식", 2개')).toBe('"성탄 ""간식"", 2개"');
  });
  it("leaves empty values empty", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
  it.each(["=SUM(A1)", "+1", "-2", "@cmd", "\t=1", "  =HYPERLINK(x)"])("neutralizes formula %j", (v) => {
    expect(csvCell(v).startsWith(`"'`)).toBe(true);
  });
  it("turns line breaks into spaces", () => {
    expect(csvCell("a\n=1")).toBe('"a =1"');
    expect(csvCell("a\r\nb")).toBe('"a b"');
  });
  it("keeps negative-looking money only as text when it starts with minus", () => {
    expect(csvCell("12.50")).toBe('"12.50"');
  });
});
