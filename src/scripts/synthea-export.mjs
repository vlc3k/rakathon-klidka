// Vytáhne z FHIR serveru (IRIS) údaje o 6 pacientech, které do kitu dala InterSystems (Synthea):
// demografii, aktivní diagnózy, léky, alergie a poslední laboratoř. Uloží je do scripts/data/synthea.json,
// ze kterého scripts/demo-data.mjs dělá pacienty aplikace a jejich dokumenty. Nic na serveru nemění.
//
//   node scripts/synthea-export.mjs
import { writeFileSync } from "node:fs";

const BASE = (process.env.FHIR_BASE_URL ?? "http://localhost:52773/fhir/r4").replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${process.env.FHIR_USER ?? "SuperUser"}:${process.env.FHIR_PASSWORD ?? "SYS"}`).toString("base64");
const IDS = ["33", "32", "736", "1350", "1805", "2329"];

async function get(path) {
  const res = await fetch(`${BASE}/${path}`, { headers: { Accept: "application/fhir+json", Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${path}: FHIR ${res.status}`);
  return res.json();
}
async function all(path) {
  const out = [];
  for (let page = await get(path); page; ) {
    out.push(...(page.entry ?? []).map((e) => e.resource));
    const next = page.link?.find((l) => l.relation === "next")?.url;
    page = next ? await get(next.slice(BASE.length + 1)) : null;
  }
  return out;
}
const text = (c) => c?.text ?? c?.coding?.find((x) => x.display)?.display ?? c?.coding?.[0]?.code ?? null;

const patients = [];
for (const id of IDS) {
  const p = await get(`Patient/${id}`);
  const [conditions, meds, allergies, observations] = await Promise.all([
    all(`Condition?patient=Patient/${id}&_count=200`),
    all(`MedicationRequest?patient=Patient/${id}&_count=200`),
    all(`AllergyIntolerance?patient=Patient/${id}&_count=200`),
    all(`Observation?patient=Patient/${id}&_count=500`),
  ]);
  // poslední hodnota každého LOINC kódu
  const latest = {};
  for (const o of observations) {
    const code = o.code?.coding?.find((c) => c.system === "http://loinc.org")?.code;
    const date = o.effectiveDateTime ?? o.effectivePeriod?.start;
    if (!code || !o.valueQuantity || !date) continue;
    if (!latest[code] || latest[code].date < date) latest[code] = { label: text(o.code), value: o.valueQuantity.value, unit: o.valueQuantity.unit ?? o.valueQuantity.code, date: date.slice(0, 10) };
  }
  const n = p.name?.find((x) => x.use === "official") ?? p.name?.[0];
  patients.push({
    fhirId: id,
    given: n?.given?.[0],
    family: n?.family,
    birthDate: p.birthDate,
    gender: p.gender,
    deceased: !!(p.deceasedDateTime || p.deceasedBoolean),
    identifiers: p.identifier?.map((i) => ({ system: i.system, value: i.value })) ?? [],
    conditions: conditions.map((c) => ({ text: text(c.code), snomed: c.code?.coding?.[0]?.code, status: c.clinicalStatus?.coding?.[0]?.code, onset: (c.onsetDateTime ?? c.recordedDate)?.slice(0, 10) })),
    medications: meds.map((m) => ({ text: text(m.medicationCodeableConcept) ?? m.medicationReference?.display, status: m.status, date: m.authoredOn?.slice(0, 10) })),
    allergies: allergies.map((a) => text(a.code)),
    latest,
  });
}
writeFileSync(new URL("./data/synthea.json", import.meta.url), JSON.stringify({ _info: `Export ze ${BASE}, ${new Date().toISOString()}. Pacienti od InterSystems (Synthea).`, patients }, null, 2) + "\n");
for (const p of patients) {
  const active = p.conditions.filter((c) => c.status === "active").map((c) => c.text);
  const meds = [...new Set(p.medications.filter((m) => m.status === "active").map((m) => m.text))];
  console.log(`\n${p.fhirId} ${p.given} ${p.family} (${p.birthDate}, ${p.gender}${p.deceased ? ", zemřel" : ""})`);
  console.log(`  diagnózy aktivní: ${active.join(" | ") || "–"}`);
  console.log(`  léky aktivní: ${meds.join(" | ") || "–"}`);
  console.log(`  alergie: ${p.allergies.join(" | ") || "–"}`);
  console.log(`  laboratoř: ${Object.entries(p.latest).filter(([k]) => ["718-7", "777-3", "6690-2", "2160-0", "38483-4", "2339-0", "4548-4", "29463-7", "8302-2", "39156-5", "8480-6", "8462-4"].includes(k)).map(([, v]) => `${v.label} ${v.value} ${v.unit} (${v.date})`).join(" | ")}`);
}
