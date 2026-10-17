import { describe, expect, test } from "vitest";
import { sniffMimeType } from "@/lib/server/files";

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);
const text = (value: string) => new TextEncoder().encode(value);

describe("typ souboru podle obsahu", () => {
  test("pozná JPEG, PNG a PDF", () => {
    expect(sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMimeType(text("%PDF-1.7\n"))).toBe("application/pdf");
  });

  test("pozná WebM a MP4 z hlasové zprávy", () => {
    expect(sniffMimeType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe("audio/webm");
    expect(sniffMimeType(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32))).toBe("audio/mp4");
  });

  test("HTML, SVG ani neznámý obsah nepustí, i kdyby se tvářil jako obrázek", () => {
    expect(sniffMimeType(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffMimeType(text("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffMimeType(bytes(1, 2, 3))).toBeNull();
  });
});
