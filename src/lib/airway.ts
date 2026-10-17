import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Kontrola fotky úst pro anesteziologa. Jen kvalita snímku (rámování, otevřená pusa, světlo, klid),
// žádné hodnocení dýchacích cest. Třídu podle Mallampatiho určuje anesteziolog z fotky.

// Body z MediaPipe Face Mesh (468 bodů).
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const UPPER_LIP_OUTER = 0;
const LOWER_LIP_OUTER = 17;
const FOREHEAD = 10;
const CHIN = 152;
const CHEEK_L = 234;
const CHEEK_R = 454;
const NOSE = 1;

// S vyplazeným jazykem detektor kreslí vnitřní hranu spodního rtu na jazyk a jawOpen podhodnocuje,
// proto se otevření měří vnějšími okraji rtů (pod jazykem zůstávají) a jawOpen jen jako pojistka.
export const JAW_OPEN_MIN = 0.25;
export const MOUTH_OUTER_MIN = 0.2;
export const LUMA_MIN = 70;
// Pohyb mezi snímky jako podíl výšky obličeje (vyhlazený). Absolutní práh byl přísnější než šum detektoru.
export const MOTION_MAX = 0.02;
export const HOLD_MS = 900;

export type Check = "noFace" | "far" | "close" | "offCenter" | "turned" | "mouth" | "dark" | "moving" | "turnSide" | "tiltBack" | "ok";

export const HINTS: Record<Check, string> = {
  noFace: "Dejte obličej do oválu",
  far: "Přibližte telefon",
  close: "Trochu dál",
  offCenter: "Posuňte se doprostřed",
  turned: "Dívejte se přímo do kamery",
  mouth: "Otevřete pusu naplno, vyplázněte jazyk a nemluvte",
  dark: "Víc světla do pusy, otočte se k lampě nebo oknu",
  moving: "Nehýbejte se",
  turnSide: "Otočte hlavu bokem, ať je vidět profil",
  tiltBack: "Zakloňte hlavu, bradu nahoru",
  ok: "Vydržte…",
};

export type Frame = {
  landmarks: NormalizedLandmark[] | undefined;
  jawOpen: number;
  mouthLuma: number | null;
  motion: number;
};

export type AirwayMetrics = { jawOpen: number; mouthRatio: number; luma: number };

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);

export function mouthRatio(lm: NormalizedLandmark[]) {
  return dist(lm[UPPER_LIP], lm[LOWER_LIP]) / dist(lm[FOREHEAD], lm[CHIN]);
}

// Výška úst mezi vnějšími okraji rtů vůči výšce obličeje. Zavřená ústa kolem 0,1.
export function mouthOuterRatio(lm: NormalizedLandmark[]) {
  return dist(lm[UPPER_LIP_OUTER], lm[LOWER_LIP_OUTER]) / dist(lm[FOREHEAD], lm[CHIN]);
}

export function mouthCenter(lm: NormalizedLandmark[]) {
  const u = lm[UPPER_LIP];
  const l = lm[LOWER_LIP];
  return { x: (u.x + l.x) / 2, y: (u.y + l.y) / 2, r: dist(u, l) / 3 };
}

// Pohyb mezi snímky: průměrný posun několika stabilních bodů vůči výšce obličeje, takže nezáleží
// na vzdálenosti od kamery. Rozmazání se tak pozná dřív než z ostrosti.
export function motionBetween(a: NormalizedLandmark[] | undefined, b: NormalizedLandmark[] | undefined) {
  if (!a || !b) return 1;
  const ids = [NOSE, FOREHEAD, CHIN, CHEEK_L, CHEEK_R];
  const faceHeight = Math.max(dist(b[FOREHEAD], b[CHIN]), 0.01);
  return ids.reduce((sum, i) => sum + dist(a[i], b[i]), 0) / ids.length / faceHeight;
}

// Náhled je výřez (object-cover) s poměrem stran `aspect`. Webkamera v notebooku točí na šířku,
// takže pacient vidí jen střed snímku. Rámování proto měříme v tom, co vidí, ne v celém snímku.
export function toVisible(lm: NormalizedLandmark[], videoW: number, videoH: number, aspect = 3 / 4): NormalizedLandmark[] {
  if (!videoW || !videoH) return lm;
  const ratio = videoW / videoH;
  const sx = ratio > aspect ? aspect / ratio : 1;
  const sy = ratio > aspect ? 1 : ratio / aspect;
  return lm.map((p) => ({ ...p, x: (p.x - (1 - sx) / 2) / sx, y: (p.y - (1 - sy) / 2) / sy }));
}

// První nesplněná podmínka, v pořadí, ve kterém je má člověk opravit.
export function evaluate(f: Frame): Check {
  const lm = f.landmarks;
  if (!lm) return "noFace";
  const width = lm[CHEEK_R].x - lm[CHEEK_L].x;
  const cx = (lm[CHEEK_L].x + lm[CHEEK_R].x) / 2;
  const cy = (lm[FOREHEAD].y + lm[CHIN].y) / 2;
  if (Math.abs(width) < 0.3) return "far";
  if (Math.abs(width) > 0.85) return "close";
  if (Math.abs(cx - 0.5) > 0.12 || Math.abs(cy - 0.5) > 0.15) return "offCenter";
  const yaw = (lm[NOSE].x - lm[CHEEK_L].x) / width;
  if (yaw < 0.38 || yaw > 0.62) return "turned";
  if (f.jawOpen < JAW_OPEN_MIN || mouthOuterRatio(lm) < MOUTH_OUTER_MIN) return "mouth";
  if (f.mouthLuma !== null && f.mouthLuma < LUMA_MIN) return "dark";
  if (f.motion > MOTION_MAX) return "moving";
  return "ok";
}

// Výřez obličeje pro uložení: od čela po bradu s okrajem, čtverec.
export function faceCrop(lm: NormalizedLandmark[], w: number, h: number, view: View = "front") {
  const top = lm[FOREHEAD].y * h;
  const bottom = lm[CHIN].y * h;
  const size = Math.min((bottom - top) * 1.5, w, h);
  const cx = ((lm[CHEEK_L].x + lm[CHEEK_R].x) / 2) * w;
  // U zakloněné hlavy chceme vidět i krk pod bradou.
  const cy = (top + bottom) / 2 + (view === "extension" ? (bottom - top) * 0.3 : 0);
  const x = Math.max(0, Math.min(w - size, cx - size / 2));
  const y = Math.max(0, Math.min(h - size, cy - size / 2));
  return { x, y, size };
}

// Tři polohy podle výzkumných protokolů (Cuendet, Hayasaka): ústa, profil, zakloněná hlava.
// Kamera jen hlídá polohu a kvalitu; třídu a obtížnost dýchacích cest posuzuje anesteziolog.
export type View = "front" | "profile" | "extension";
export const VIEWS: { id: View; title: string }[] = [
  { id: "front", title: "Otevřená ústa" },
  { id: "profile", title: "Z boku" },
  { id: "extension", title: "Hlava zakloněná" },
];

// Sklon hlavy (stupně) z vektoru brada → čelo včetně hloubky. Porovnává se jen s první fotkou,
// takže nezáleží na znaménku ani na tom, jak pacient drží telefon.
export function pitchOf(lm: NormalizedLandmark[], w: number, h: number) {
  const f = lm[FOREHEAD];
  const c = lm[CHIN];
  return (Math.atan2((f.z - c.z) * w, -(f.y - c.y) * h) * 180) / Math.PI;
}

export const TILT_MIN_DEG = 15;

export function evaluateView(view: View, f: Frame, pitch: number | null, baselinePitch: number | null): Check {
  if (view === "front") return evaluate(f);
  const lm = f.landmarks;
  if (!lm) return "noFace";
  const height = lm[CHIN].y - lm[FOREHEAD].y;
  if (height < 0.3) return "far";
  if (height > 0.9) return "close";
  const width = lm[CHEEK_R].x - lm[CHEEK_L].x;
  const yaw = Math.abs(width) < 0.02 ? 0 : (lm[NOSE].x - lm[CHEEK_L].x) / width;
  if (view === "profile") {
    if (yaw > 0.25 && yaw < 0.75) return "turnSide";
  } else {
    if (yaw < 0.35 || yaw > 0.65) return "turned";
    if (pitch === null || baselinePitch === null || Math.abs(pitch - baselinePitch) < TILT_MIN_DEG) return "tiltBack";
  }
  if (f.motion > MOTION_MAX) return "moving";
  return "ok";
}
