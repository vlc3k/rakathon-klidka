import { describe, expect, test } from "vitest";
import { SYSTEMS } from "@/lib/fhir/bundle";
import { alreadyInHospital, toHospitalResource, type VerifiedInfo } from "@/lib/fhir/writeBack";
import type { CaseFact } from "@/lib/fhir/types";

const info = (type: string, value: unknown, extra: Partial<VerifiedInfo> = {}): VerifiedInfo => ({
  id: "11111111-1111-4111-8111-111111111111",
  type,
  value,
  observedDate: "2026-10-08",
  verifiedAt: "2026-10-17T09:00:00.000Z",
  verifierName: "MUDr. Testová",
  document: { type: "lab_report", issuedDate: "2026-10-08" },
  ...extra,
});

describe("ověřené údaje do nemocnice (FHIR)", () => {
  test("hemoglobin jako laboratorní Observation s LOINC, UCUM, mezemi a příznakem", () => {
    const r = toHospitalResource(info("hemoglobin", { value: 108, unit: "g/l", refLow: 120, refHigh: 160, flag: "L" }), "Patient/31")!;
    expect(r.resourceType).toBe("Observation");
    expect(r.code.coding[0]).toMatchObject({ system: "http://loinc.org", code: "718-7" });
    expect(r.valueQuantity).toEqual({ value: 108, unit: "g/l", system: "http://unitsofmeasure.org", code: "g/L" });
    expect(r.referenceRange[0].low.value).toBe(120);
    expect(r.interpretation[0].coding[0].code).toBe("L");
    expect(r.subject.reference).toBe("Patient/31");
    expect(r.effectiveDateTime).toBe("2026-10-08");
  });

  test("nese naše id a štítek ověření, aby se nezdvojil a import ho poznal", () => {
    const r = toHospitalResource(info("ferritin", { value: 11, unit: "µg/l" }), "Patient/31")!;
    expect(r.identifier).toEqual([{ system: SYSTEMS.factId, value: "11111111-1111-4111-8111-111111111111" }]);
    expect(r.meta.tag[0]).toMatchObject({ system: SYSTEMS.verification, code: "clinician_verified" });
    expect(r.note[0].text).toContain("Z dokumentu od pacienta (Laboratorní výsledky, vystaven 8. 10. 2026)");
    expect(r.note[0].text).toContain("Ověřeno: MUDr. Testová, 17. 10. 2026");
  });

  test("lék, alergie a onemocnění jako MedicationStatement, AllergyIntolerance a Condition", () => {
    const med = toHospitalResource(info("medication", { name: "Clexane", strength: "0,4 ml", dose: "0-0-1 s.c." }), "Patient/31")!;
    expect(med).toMatchObject({ resourceType: "MedicationStatement", status: "active", medicationCodeableConcept: { text: "Clexane 0,4 ml" }, dosage: [{ text: "0-0-1 s.c." }] });
    const allergy = toHospitalResource(info("allergy", { substance: "penicilin", reaction: "vyrážka" }), "Patient/31")!;
    expect(allergy).toMatchObject({ resourceType: "AllergyIntolerance", code: { text: "penicilin" }, patient: { reference: "Patient/31" } });
    const condition = toHospitalResource(info("condition", { text: "Esenciální hypertenze", icd10: "I10" }), "Patient/31")!;
    expect(condition.code).toEqual({ coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "I10" }], text: "Esenciální hypertenze" });
  });

  test("„nemám žádné“ a typy, které nemocnici nic neřeknou, se neposílají", () => {
    expect(toHospitalResource(info("allergy", { none: true }), "Patient/31")).toBeNull();
    expect(toHospitalResource(info("note", { text: "volá odpoledne" }), "Patient/31")).toBeNull();
  });

  test("údaj zadaný v ambulanci (bez dokumentu)", () => {
    const r = toHospitalResource(info("weight", { value: 82, unit: "kg" }, { document: null }), "Patient/31")!;
    expect(r.category[0].coding[0].code).toBe("vital-signs");
    expect(r.note[0].text).toMatch(/^Zadáno v anesteziologické ambulanci\./);
  });
});

describe("co nemocnice už vede, se neposílá znovu", () => {
  const fact = (f: Partial<CaseFact>): CaseFact => ({
    id: "x", kind: "lab", key: "k", label: "l", value: null, verification: "source_system",
    source: { author: "system", recordedAt: "2026-10-01T00:00:00Z" }, ...f,
  }) as CaseFact;

  test("stejný hemoglobin ze stejného dne", () => {
    const hb = info("hemoglobin", { value: 108, unit: "g/l" });
    expect(alreadyInHospital(hb, [fact({ code: { system: "http://loinc.org", code: "718-7" }, date: "2026-10-08", value: 108 })])).toBe(true);
    expect(alreadyInHospital(hb, [fact({ code: { system: "http://loinc.org", code: "718-7" }, date: "2025-07-03", value: 108 })])).toBe(false);
  });

  test("diagnóza podle MKN-10 nebo názvu, lék podle látky", () => {
    expect(alreadyInHospital(info("condition", { text: "Esenciální hypertenze", icd10: "I10" }), [fact({ kind: "diagnosis", value: "Hypertenze", code: { system: "x", code: "I10" } })])).toBe(true);
    expect(alreadyInHospital(info("medication", { name: "Paralen paracetamol" }), [fact({ kind: "medication", value: "Paracetamol 500 mg", active: true })])).toBe(true);
    expect(alreadyInHospital(info("medication", { name: "Clexane" }), [fact({ kind: "medication", value: "Paracetamol 500 mg", active: true })])).toBe(false);
  });

  test("náš vlastní dřívější zápis se nepočítá (to hlídá podmíněné vytvoření)", () => {
    expect(alreadyInHospital(info("hemoglobin", { value: 108, unit: "g/l" }), [fact({ code: { system: "http://loinc.org", code: "718-7" }, date: "2026-10-08", value: 108, verification: "clinician_verified" })])).toBe(false);
  });
});
