import { test } from "node:test";
import assert from "node:assert/strict";
import { cornersToArray, edgeSupport, isConvexQuad, orderCorners, pickBestQuad, plausibleQuad, type GrayImage } from "@/lib/scanner/geometry";
import { insetCorners, outputSize } from "@/lib/scanner/scan";
import type { Point } from "@/lib/scanner/types";

const P = (x: number, y: number): Point => ({ x, y });

// Umělý snímek: stůl s daným jasem, na něm světlý papír (čtyřúhelník) a volitelně „text“ uvnitř.
function scene(paper: Point[], { table = 60, sheet = 235, text = false, w = 400, h = 500 } = {}): GrayImage {
  const data = new Uint8Array(w * h).fill(table);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = paper[i], b = paper[(i + 1) % 4];
      const s = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
      if (s && sign && s !== sign) return false;
      if (s) sign = s;
    }
    return true;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      // řádky „textu“ s okraji jako na dopise: tmavé čárky, mezi nimi papír
      const dark = text && x > 110 && x < 285 && y > 100 && y < 395 && y % 14 < 4 && (x * 7 + y) % 23 < 15;
      data[y * w + x] = dark ? 40 : sheet;
    }
  }
  return { data, width: w, height: h };
}

const paper = [P(80, 60), P(330, 80), P(310, 440), P(60, 420)];

test("rohy: zamíchané body → TL, TR, BR, BL", () => {
  const c = orderCorners([paper[2], paper[0], paper[3], paper[1]]);
  assert.deepEqual(cornersToArray(c), paper);
});

test("rohy: papír natočený o 45° má každý roh jednou a v pořadí po obvodu", () => {
  const c = orderCorners([P(200, 350), P(50, 200), P(350, 200), P(200, 50)]);
  const all = cornersToArray(c).map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(all).size, 4);
  assert.deepEqual(cornersToArray(c), [P(200, 50), P(350, 200), P(200, 350), P(50, 200)]);
});

test("tvar: překřížený čtyřúhelník není konvexní", () => {
  assert.equal(isConvexQuad([P(0, 0), P(10, 10), P(10, 0), P(0, 10)]), false);
  assert.equal(isConvexQuad(paper), true);
});

test("tvar: hodně zúžený klín neprojde jako papír", () => {
  assert.equal(plausibleQuad([P(0, 0), P(300, 0), P(160, 300), P(140, 300)]), false);
  assert.equal(plausibleQuad(paper), true);
});

test("hrany: skutečný papír má vysokou podporu, posunutý čtyřúhelník nízkou", () => {
  const g = scene(paper, { text: true });
  assert.ok(edgeSupport(g, paper) > 0.9);
  const shifted = paper.map((p) => P(p.x + 60, p.y + 50));
  assert.ok(edgeSupport(g, shifted) < 0.5);
});

test("hrany: bílý papír na světlém stole (rozdíl 8 úrovní) se pořád najde", () => {
  const g = scene(paper, { table: 225, sheet: 233 });
  assert.ok(edgeSupport(g, paper) > 0.9);
});

test("výběr: papír vyhraje nad blokem textu uvnitř", () => {
  const g = scene(paper, { text: true });
  const textBlock = [P(110, 100), P(300, 115), P(285, 400), P(95, 385)];
  const best = pickBestQuad(g, [{ pts: textBlock }, { pts: paper }], 1000);
  assert.deepEqual(best?.pts, paper);
});

test("výběr: bez věrohodného kandidáta null (uživatel ořízne ručně)", () => {
  const g = scene(paper);
  const nowhere = [P(5, 5), P(60, 5), P(60, 50), P(5, 50)];
  assert.equal(pickBestQuad(g, [{ pts: nowhere }], 100), null);
});

test("výstup: malý papír ve fotce se nezvětšuje na 2000 px", () => {
  const small = orderCorners([P(100, 100), P(453, 100), P(453, 600), P(100, 600)]);
  const { width, height } = outputSize(small);
  assert.equal(height, 1400); // spodní hranice čitelnosti
  assert.equal(width, Math.round(1400 / Math.SQRT2));
  const big = orderCorners([P(0, 0), P(1600, 0), P(1600, 2260), P(0, 2260)]);
  assert.equal(outputSize(big).height, 2000);
});

test("ořez: rohy se posunou kousek dovnitř", () => {
  const c = orderCorners(paper);
  const inset = insetCorners(c, 0.01);
  assert.ok(inset.topLeftCorner.x > c.topLeftCorner.x && inset.topLeftCorner.y > c.topLeftCorner.y);
  assert.ok(inset.bottomRightCorner.x < c.bottomRightCorner.x && inset.bottomRightCorner.y < c.bottomRightCorner.y);
});
