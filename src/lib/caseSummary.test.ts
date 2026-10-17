import { test } from "node:test";
import assert from "node:assert/strict";
import { caseSummary, isAntithrombotic, type SummaryInput } from "@/lib/caseSummary";
import { CONSENT_SIGNING } from "@/lib/features";
import type { HospitalItem } from "@/lib/fhir/snapshot";

const empty: SummaryInput = {
  readiness: null,
  hb: { status: "missing", reason: "none", value: null, observedDate: null },
  anamnesis: { items: [], verified: null },
  meds: { items: [], verified: null },
  hbLabs: [],
  allergies: { items: [], verified: null },
  allergiesNone: false,
  airway: { photos: 0, assessment: null },
  consentSigned: false,
  documents: { total: 0, failed: 0, unassigned: 0, list: [] },
  hospital: null,
};
const item = (group: HospitalItem["group"], label: string, extra: Partial<HospitalItem> = {}): HospitalItem => ({
  id: label,
  group,
  key: label,
  label,
  value: "",
  date: null,
  relevant: true,
  ...extra,
});
const row = (input: SummaryInput, key: string) => caseSummary(input).find((r) => r.key === key)!;

test("souhrn: pořadí podle předoperačního vyšetření (souhlas jen se zapnutým podpisem, lib/features.ts)", () =>
  assert.deepEqual(
    caseSummary(empty).map((r) => r.key),
    ["hb", "conditions", "meds", "allergies", "airway", ...(CONSENT_SIGNING ? ["consent"] : []), "documents"],
  ));

test("Hb chybí, ale nemocnice má starší hodnotu → ukáže ji, platnost nenahradí", () => {
  const hb = row({ ...empty, hospital: [item("lab", "Hemoglobin", { key: "hemoglobin", value: "132,4 g/L", date: "2023-06-05" })] }, "hb");
  assert.equal(hb.tone, "attention");
  assert.match(hb.text, /Chybí aktuální Hb/);
  assert.match(hb.more ?? "", /V nemocnici 132,4 g\/L \(5\. 6\. 2023\)/);
  assert.deepEqual(hb.sources, ["dokumenty", "nemocnice"]);
});

test("Hb pod prahem → pozornost s PBM", () => {
  const hb = row({ ...empty, hb: { status: "alert", reason: "low", value: 104, observedDate: "2026-10-10" } }, "hb");
  assert.equal(hb.tone, "attention");
  assert.match(hb.text, /104 g\/l/);
});

test("onemocnění: dokumenty a nemocnice dohromady, bez duplicit", () => {
  const r = row({ ...empty, anamnesis: { items: [{ id: "i1", text: "Hypertension", documentId: "d1" }], verified: null }, hospital: [item("diagnosis", "hypertension"), item("diagnosis", "Obesity")] }, "conditions");
  assert.equal(r.text, "Hypertension, Obesity");
  assert.equal(r.unverified, true);
});

test("léky: protisrážlivé svítí, i z nemocnice", () => {
  const r = row({ ...empty, meds: { items: [{ id: "m1", text: "Prestarium", documentId: "d1", name: "Prestarium", dose: "5 mg" }], verified: {} }, hospital: [item("medication", "Eliquis 5 mg")] }, "meds");
  assert.equal(r.tone, "attention");
  assert.match(r.text, /Eliquis/);
  assert.match(r.more ?? "", /Prestarium 5 mg/);
  assert.equal(r.unverified, false);
});

test("protisrážlivé: české názvy i bez diakritiky", () => {
  assert.ok(isAntithrombotic("Kyselina acetylsalicylová 100 mg"));
  assert.ok(isAntithrombotic("XARELTO 20MG"));
  assert.ok(!isAntithrombotic("Hydrochlorothiazide 12.5 MG"));
});

test("alergie: neuvedeno → zeptat se; „bez alergií“ ze zprávy → v pořádku", () => {
  assert.equal(row(empty, "allergies").tone, "missing");
  assert.equal(row({ ...empty, allergiesNone: true }, "allergies").tone, "ok");
  assert.equal(row({ ...empty, hospital: [item("allergy", "Penicillin")] }, "allergies").tone, "attention");
});

test("dýchací cesty: fotky bez hodnocení čekají, Mallampati III svítí", () => {
  assert.match(row({ ...empty, airway: { photos: 1, assessment: null } }, "airway").text, /čekají/);
  const r = row({ ...empty, airway: { photos: 1, assessment: { mallampati: 3 } } }, "airway");
  assert.equal(r.tone, "attention");
  assert.equal(r.text, "Mallampati III");
});

test("podklady: nepřečtené a nepřiřazené dokumenty svítí", () => {
  const r = row({ ...empty, documents: { total: 3, failed: 1, unassigned: 2, list: [] } }, "documents");
  assert.equal(r.tone, "attention");
  assert.equal(r.text, "3 dokumenty, 1 nepřečtený, 2 nelze přiřadit pacientovi");
});

test("rozbalení: položka ze zprávy jde ukázat ve zprávě, z nemocnice má datum", () => {
  const r = row(
    { ...empty, anamnesis: { items: [{ id: "i1", text: "Diabetes", documentId: "d1" }], verified: null }, hospital: [item("diagnosis", "Hypertension", { date: "1989-11-27" })] },
    "conditions",
  );
  assert.deepEqual(
    r.items.map((i) => [i.text, i.source, i.informationId ?? null, i.date]),
    [
      ["Diabetes", "dokumenty", "i1", null],
      ["Hypertension", "nemocnice", null, "27. 11. 1989"],
    ],
  );
});

test("rozbalení: protisrážlivý lék je označený", () => {
  const r = row({ ...empty, hospital: [item("medication", "Warfarin 5 MG"), item("medication", "Metformin 500 MG")] }, "meds");
  assert.deepEqual(r.items.map((i) => !!i.warn), [true, false]);
});

test("termín: nestihne se → první řádek a pozornost", () => {
  const rows = caseSummary({ ...empty, readiness: { status: "late", text: "Nestihne se do termínu", sentence: "Připraven mezi 25. 10. a 3. 11." } });
  assert.equal(rows[0].key, "readiness");
  assert.equal(rows[0].tone, "attention");
});

test("podklady: jiný papír, než ambulance chtěla, svítí a říká, že papír dál chybí", () => {
  const r = row({ ...empty, documents: { total: 2, failed: 0, unassigned: 0, mismatched: 1, list: [] } }, "documents");
  assert.equal(r.tone, "attention");
  assert.match(r.text, /1× jiný papír, než jsme chtěli/);
  assert.match(r.more ?? "", /papír chybí dál/);
});

test("alergie: „neguje“ ze zprávy je bez alergií, ne pozor", () => {
  const r = row({ ...empty, allergies: { items: [{ id: "a1", text: "Neguje", documentId: "d1" }], verified: null } }, "allergies");
  assert.equal(r.tone, "ok");
  assert.equal(r.text, "Bez alergií podle zprávy");
});
