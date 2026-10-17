// Typ souboru podle prvních bajtů, ne podle hlavičky od klienta. Projde jen to, co umíme bezpečně zobrazit:
// HTML, SVG a skripty se nedostanou do úložiště, ani kdyby se tvářily jako obrázek.

export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf", "audio/webm", "audio/mp4"] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function sniffMimeType(data: Uint8Array): AllowedMimeType | null {
  const starts = (signature: number[], offset = 0) => signature.every((byte, i) => data[offset + i] === byte);
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm"; // EBML
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) return "audio/mp4"; // ftyp
  return null;
}
