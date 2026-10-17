import { describe, expect, test } from "vitest";
import { evaluateHemoglobin, type HbObservation } from "@/lib/server/rules/hemoglobin";

const TODAY = "2026-10-17";

let n = 0;
const hb = (o: Partial<HbObservation>): HbObservation => ({
  informationId: `info-${++n}`,
  value: 135,
  unit: "g/l",
  refLow: 120,
  refHigh: 160,
  flag: null,
  observedDate: "2026-10-10",
  isObservedDateEstimated: false,
  status: "verified",
  confidence: 0.95,
  documentMatch: "match",
  documentIssuedDate: "2026-10-10",
  createdAt: new Date("2026-10-11T08:00:00Z"),
  ...o,
});

describe("stav hemoglobinu", () => {
  test("bez hodnoty chybí", () => {
    expect(evaluateHemoglobin([], TODAY)).toMatchObject({ status: "missing", reason: "none", value: null });
  });

  test("čerstvá hodnota v normě je v pořádku", () => {
    expect(evaluateHemoglobin([hb({ value: 135 })], TODAY)).toMatchObject({ status: "ok", value: 135, observedDate: "2026-10-10" });
  });

  test("hodnota pod 120 g/l je upozornění", () => {
    expect(evaluateHemoglobin([hb({ value: 98, flag: "L" })], TODAY)).toMatchObject({ status: "alert", reason: "low", value: 98 });
  });

  test("hodnota starší než 14 dní je neaktuální a je potřeba doplnit", () => {
    expect(evaluateHemoglobin([hb({ observedDate: "2026-09-20" })], TODAY)).toMatchObject({ status: "missing", reason: "stale", value: 135 });
  });

  test("anémie bez data odběru je upozornění, normální hodnota bez data je nejistá", () => {
    expect(evaluateHemoglobin([hb({ value: 83, observedDate: null, refLow: null, refHigh: null })], TODAY)).toMatchObject({ status: "alert", reason: "no_date" });
    expect(evaluateHemoglobin([hb({ value: 135, observedDate: null })], TODAY)).toMatchObject({ status: "uncertain", reason: "no_date" });
  });

  test("hodnota jen s datem zprávy (bez data odběru) je nejistá", () => {
    const fromReportDate = hb({ value: 135, observedDate: "2026-10-14", isObservedDateEstimated: true });

    expect(evaluateHemoglobin([fromReportDate], TODAY)).toMatchObject({ status: "uncertain", reason: "no_date" });
  });

  test("anémie jen s datem zprávy zůstává upozorněním bez data odběru", () => {
    const fromReportDate = hb({ value: 98, observedDate: "2026-10-14", isObservedDateEstimated: true });

    expect(evaluateHemoglobin([fromReportDate], TODAY)).toMatchObject({ status: "alert", reason: "no_date", value: 98 });
  });

  test("hodnota v normě je v pořádku i bez ověření, ale nese, že ji nikdo neověřil", () => {
    expect(evaluateHemoglobin([hb({ status: "ai_extracted" })], TODAY)).toMatchObject({ status: "ok", verified: false });
    expect(evaluateHemoglobin([hb({ status: "verified" })], TODAY)).toMatchObject({ status: "ok", verified: true });
  });

  test("dokument s nejistou identitou pacienta dá nejistý stav", () => {
    expect(evaluateHemoglobin([hb({ value: 98, documentMatch: "uncertain" })], TODAY)).toMatchObject({ status: "uncertain", reason: "identity" });
  });

  test("dokument jiného pacienta se nepoužije vůbec", () => {
    expect(evaluateHemoglobin([hb({ value: 98, documentMatch: "mismatch" })], TODAY)).toMatchObject({ status: "missing", reason: "none" });
  });

  test("zamítnutá hodnota se nepoužije", () => {
    expect(evaluateHemoglobin([hb({ value: 98, status: "rejected" })], TODAY)).toMatchObject({ status: "missing" });
  });

  test("neověřené čtení, které neprojde kontrolou, je nejisté", () => {
    const shiftedRow = hb({ status: "ai_extracted", value: 135, refLow: 0.4, refHigh: 0.5 });

    expect(evaluateHemoglobin([shiftedRow], TODAY)).toMatchObject({ status: "uncertain", reason: "checks" });
  });

  test("hodnotu ověřenou člověkem kontroly čtení neblokují", () => {
    const verified = hb({ status: "verified", value: 135, refLow: 0.4, refHigh: 0.5 });

    expect(evaluateHemoglobin([verified], TODAY)).toMatchObject({ status: "ok" });
  });

  test("hodnota v g/dl se převede na g/l", () => {
    expect(evaluateHemoglobin([hb({ value: 13.5, unit: "g/dl", refLow: 12, refHigh: 16 })], TODAY)).toMatchObject({ status: "ok", value: 135 });
  });

  test("jednotku, kterou neumíme převést, nechá jako nejistou i po ověření", () => {
    expect(evaluateHemoglobin([hb({ value: 8.4, unit: "mmol/l" })], TODAY)).toMatchObject({ status: "uncertain", reason: "unit" });
  });

  test("nemožnou hodnotu v g/l nepustí ani po ověření (nejspíš g/dl bez jednotky)", () => {
    expect(evaluateHemoglobin([hb({ value: 13.5, unit: null })], TODAY)).toMatchObject({ status: "uncertain", reason: "unit" });
  });

  test("rozhoduje nejnovější odběr", () => {
    const older = hb({ value: 98, observedDate: "2026-10-05" });
    const newer = hb({ value: 131, observedDate: "2026-10-12" });

    expect(evaluateHemoglobin([older, newer], TODAY)).toMatchObject({ status: "ok", value: 131, informationId: newer.informationId });
  });
});
