import { describe, expect, test } from "vitest";
import { boxToQuad, pageToPhoto, type Quad } from "@/lib/server/transcripts/homography";

const close = (a: number[], b: number[]) => a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 6));

describe("perspektiva stránky", () => {
  test("rohy narovnané stránky padnou na rohy papíru ve fotce", () => {
    const quad: Quad = [[0.1, 0.05], [0.9, 0.1], [0.85, 0.95], [0.05, 0.9]];
    const map = pageToPhoto(quad);
    close(map([0, 0]), quad[0]);
    close(map([1, 0]), quad[1]);
    close(map([1, 1]), quad[2]);
    close(map([0, 1]), quad[3]);
  });

  test("rovná stránka přes celou fotku nic nemění", () => {
    const quad = boxToQuad([100, 200, 600, 250], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    close(quad.flat(), [0.1, 0.2, 0.6, 0.2, 0.6, 0.25, 0.1, 0.25]);
  });

  test("řádek na natočené stránce je natočený stejně", () => {
    // Stránka otočená o 5° kolem středu fotky.
    const a = (5 * Math.PI) / 180;
    const rot = ([x, y]: [number, number]): [number, number] => [
      0.5 + (x - 0.5) * Math.cos(a) - (y - 0.5) * Math.sin(a),
      0.5 + (x - 0.5) * Math.sin(a) + (y - 0.5) * Math.cos(a),
    ];
    const quad = ([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]] as [number, number][]).map(rot) as Quad;
    const [tl, tr] = boxToQuad([0, 500, 1000, 520], quad);
    expect(Math.atan2(tr[1] - tl[1], tr[0] - tl[0])).toBeCloseTo(a, 6);
  });
});
