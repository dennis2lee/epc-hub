import { describe, expect, it } from "vitest";
import { sniffReceiptType } from "./file-type";

const pad = (head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)]);
const text = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(new Array(16).fill(0)));

describe("sniffReceiptType", () => {
  it("recognizes receipt formats", () => {
    expect(sniffReceiptType(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffReceiptType(pad([0x89, 0x50, 0x4e, 0x47]))?.mime).toBe("image/png");
    expect(sniffReceiptType(text("%PDF-1.7"))?.mime).toBe("application/pdf");
    expect(sniffReceiptType(text("RIFF\0\0\0\0WEBP"))?.mime).toBe("image/webp");
    expect(sniffReceiptType(text("\0\0\0\x18ftypheic"))?.mime).toBe("image/heic");
  });

  it("rejects HTML and SVG", () => {
    expect(sniffReceiptType(text("<html><script>"))).toBeNull();
    expect(sniffReceiptType(text("<svg xmlns="))).toBeNull();
  });
});
