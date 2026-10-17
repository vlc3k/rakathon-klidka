// Kde na fotce hodnota je: z OCR slov najde číslo, nejlépe na stejném řádku za názvem vyšetření.
// Souřadnice vrací poměrově (0–1), takže sedí na fotku v jakékoli velikosti.

export type Word = { text: string; x: number; y: number; w: number; h: number; conf: number };
// quad: u narovnané stránky čtyřúhelník (4 rohy 0–1), který kopíruje natočení a zkosení textu na fotce.
export type Box = { x: number; y: number; w: number; h: number; quad?: [number, number][] };

const LABELS: Record<string, RegExp> = {
  hb: /^(hgb|hb|hemoglobin|hemogl)/i,
  plt: /^(plt|tro|trombocyt|trombo)/i,
  wbc: /^(wbc|leu|leukocyt|leuko)/i,
  ferritin: /^ferrit/i,
};

const clean = (t: string) => t.replace(/[^0-9.,]/g, "").replace(/[.,]+$/, "").replace(",", ".");

function sameNumber(token: string, value: number) {
  const n = Number(clean(token));
  return Number.isFinite(n) && n !== 0 && Math.abs(n - value) <= Math.max(0.011, Math.abs(value) * 0.002);
}

// Nejlepší kandidát: shoda čísla, bonus za název vyšetření vlevo na stejném řádku.
export function ground(words: Word[], code: string, value: number, size: { w: number; h: number }): Box | null {
  const label = LABELS[code];
  const hits = words.filter((w) => sameNumber(w.text, value));
  if (!hits.length) return null;
  const score = (hit: Word) => {
    const lineH = Math.max(hit.h, 10) * 1.2;
    const near = label ? words.filter((w) => label.test(w.text) && Math.abs(w.y - hit.y) < lineH && w.x < hit.x) : [];
    const dist = near.length ? Math.min(...near.map((w) => hit.x - w.x)) : Infinity;
    return (near.length ? 1000 - Math.min(dist, 999) / 10 : 0) + hit.conf / 10;
  };
  const best = hits.reduce((a, b) => (score(b) > score(a) ? b : a));
  const padX = 0.006;
  const padY = 0.002;
  return {
    x: Math.max(0, best.x / size.w - padX),
    y: Math.max(0, best.y / size.h - padY),
    w: best.w / size.w + padX * 2,
    h: best.h / size.h + padY * 2,
  };
}
