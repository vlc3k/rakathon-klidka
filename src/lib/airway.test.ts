import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, evaluateView, motionBetween, pitchOf, TILT_MIN_DEG, toVisible } from "@/lib/airway";

// Umělé body obličeje: jen ty, které kontroly používají (čelo 10, brada 152, tváře 234/454, nos 1).
function face({ noseX = 0.5, cheekL = 0.3, cheekR = 0.7, foreheadZ = 0, chinZ = 0 } = {}) {
  const lm = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  lm[10] = { x: 0.5, y: 0.2, z: foreheadZ, visibility: 1 };
  lm[152] = { x: 0.5, y: 0.75, z: chinZ, visibility: 1 };
  lm[234] = { x: cheekL, y: 0.5, z: 0, visibility: 1 };
  lm[454] = { x: cheekR, y: 0.5, z: 0, visibility: 1 };
  lm[1] = { x: noseX, y: 0.5, z: 0, visibility: 1 };
  return lm;
}
const frame = (landmarks: ReturnType<typeof face> | undefined) => ({ landmarks, jawOpen: 0, mouthLuma: null, motion: 0 });

test("profil: čelem ke kameře → otočte hlavu bokem", () => assert.equal(evaluateView("profile", frame(face()), null, null), "turnSide"));
test("profil: nos u kraje obličeje → v pořádku", () => assert.equal(evaluateView("profile", frame(face({ noseX: 0.32 })), null, null), "ok"));
test("profil: bez obličeje", () => assert.equal(evaluateView("profile", frame(undefined), null, null), "noFace"));
test("zaklonění: stejný sklon jako u první fotky → zakloňte", () => {
  const lm = face();
  const p = pitchOf(lm, 1000, 1000);
  assert.equal(evaluateView("extension", frame(lm), p, p), "tiltBack");
});
test("zaklonění: změna sklonu nad práh → v pořádku", () => {
  const base = pitchOf(face(), 1000, 1000);
  const lm = face({ foreheadZ: 0.15, chinZ: -0.15 });
  const p = pitchOf(lm, 1000, 1000);
  assert.ok(Math.abs(p - base) >= TILT_MIN_DEG);
  assert.equal(evaluateView("extension", frame(lm), p, base), "ok");
});
test("zaklonění: hlava otočená bokem → dívejte se rovně", () => assert.equal(evaluateView("extension", frame(face({ noseX: 0.32 })), 30, 0), "turned"));

// Notebook: kamera 16:9, náhled 3:4 ukazuje jen střed. Obličej přes 19 % šířky snímku je v náhledu skoro polovina.
test("rámování ve výřezu: obličej v oválu na širokoúhlé kameře není daleko", () => {
  const lm = face({ cheekL: 0.405, cheekR: 0.595 });
  assert.equal(evaluateView("front", frame(lm), null, null), "far");
  assert.notEqual(evaluateView("front", frame(toVisible(lm, 1280, 720)), null, null), "far");
});
test("rámování ve výřezu: kamera na výšku 3:4 se nemění", () => {
  const lm = face();
  assert.deepEqual(toVisible(lm, 960, 1280), lm);
});
test("pohyb: posun o pixel u velkého i malého obličeje je stejně malý vůči obličeji", () => {
  const a = face();
  const b = a.map((p) => ({ ...p, x: p.x + 0.002 }));
  assert.ok(motionBetween(a, b) < 0.01);
});

// Ústa: vnější okraje rtů (0, 17) a vnitřní (13, 14). S vyplazeným jazykem je vnitřní mezera malá.
function mouthFace(outerGap: number, innerGap: number) {
  const lm = face();
  lm[0] = { x: 0.5, y: 0.55, z: 0, visibility: 1 };
  lm[17] = { x: 0.5, y: 0.55 + outerGap, z: 0, visibility: 1 };
  lm[13] = { x: 0.5, y: 0.57, z: 0, visibility: 1 };
  lm[14] = { x: 0.5, y: 0.57 + innerGap, z: 0, visibility: 1 };
  return lm;
}
test("ústa: vyplazený jazyk (malá vnitřní mezera, velká vnější) → projde", () =>
  assert.notEqual(evaluate({ landmarks: mouthFace(0.15, 0.03), jawOpen: 0.35, mouthLuma: null, motion: 0 }), "mouth"));
test("ústa: zavřená → otevřete pusu", () =>
  assert.equal(evaluate({ landmarks: mouthFace(0.05, 0), jawOpen: 0.05, mouthLuma: null, motion: 0 }), "mouth"));
