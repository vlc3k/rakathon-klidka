import { describe, expect, test } from "vitest";
import { parseInformationValue } from "@/db/values";

describe("tvar hodnoty informace", () => {
  test("laboratorní výsledek s čísly mezí projde", () => {
    expect(parseInformationValue("hemoglobin", { value: 98, unit: "g/l", refLow: 135, refHigh: 175, flag: "L" })).toEqual({
      success: true,
      value: { value: 98, unit: "g/l", refLow: 135, refHigh: 175, flag: "L" },
    });
  });

  test("laboratorní výsledek bez čísla neprojde", () => {
    expect(parseInformationValue("hemoglobin", { value: "98", unit: "g/l" }).success).toBe(false);
  });

  test("„nemám žádné“ u seznamových typů projde", () => {
    expect(parseInformationValue("allergy", { none: true }).success).toBe(true);
  });

  test("diagnóza potřebuje text", () => {
    expect(parseInformationValue("diagnosis", { text: "Karcinom rekta", icd10: "C20" }).success).toBe(true);
    expect(parseInformationValue("diagnosis", { icd10: "C20" }).success).toBe(false);
  });

  test("neznámý typ neprojde", () => {
    expect(parseInformationValue("blood_type", { value: "A+" }).success).toBe(false);
  });

  test("navíc pole neprojdou", () => {
    expect(parseInformationValue("weight", { value: 82, unit: "kg", note: "<script>" }).success).toBe(false);
  });
});

describe("hodnocení dýchacích cest", () => {
  test("třída a známé nálezy projdou", () => {
    expect(parseInformationValue("airway_assessment", { mallampati: 3, findings: ["dentition", "beard"], note: "protéza nahoře" }).success).toBe(true);
  });

  test("„z fotek nelze hodnotit“ (null) projde", () => {
    expect(parseInformationValue("airway_assessment", { mallampati: null, findings: [] }).success).toBe(true);
  });

  test("třída mimo I až IV neprojde", () => {
    expect(parseInformationValue("airway_assessment", { mallampati: 5, findings: [] }).success).toBe(false);
  });

  test("neznámý nález neprojde", () => {
    expect(parseInformationValue("airway_assessment", { mallampati: 2, findings: ["tetovani"] }).success).toBe(false);
  });
});
