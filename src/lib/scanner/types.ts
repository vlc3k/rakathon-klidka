export interface Point {
  x: number;
  y: number;
}

/** Čtyři rohy papíru v souřadnicích zpracovávaného obrázku. */
export interface Corners {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomLeftCorner: Point;
  bottomRightCorner: Point;
}

/** Filtry jako v Google Disku: Žádný, Auto, Barevný, Stupně šedi. */
export type FilterId = "none" | "auto" | "color" | "grayscale";
export type Rotation = 0 | 90 | 180 | 270;

/** Jedna naskenovaná stránka po ořezu a narovnání. */
export interface ScannedPage {
  blob: Blob;
  width: number;
  height: number;
  /** true = stránka byla oříznuta podle rohů (nalezených nebo ručně upravených); false = originál beze změny */
  corrected: boolean;
  previewUrl: string;
}
