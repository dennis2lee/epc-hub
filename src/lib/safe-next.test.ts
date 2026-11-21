import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/claims/abc?x=1")).toBe("/claims/abc?x=1");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null])(
    "rejects %s",
    (raw) => {
      expect(safeNextPath(raw as string | null)).toBe("/");
    },
  );
});
