// Nemocnice „pošle“ nový laboratorní výsledek: zapíše Observation přímo do FHIR serveru (IRIS), mimo naši aplikaci.
// Slouží k důkazu, že „Aktualizovat z nemocnice“ tahá data živě: po zápisu se hodnota v aplikaci objeví jako „Nové“.
//
//   npm run fhir:vysledek -- case-08 hb 98          Hb 98 g/l s dnešním datem odběru u pacienta case-08
//   npm run fhir:vysledek -- case-08 plt 95 2026-10-15
//   npm run fhir:vysledek -- --smazat              smaže všechny výsledky zapsané tímhle skriptem
//
// Pacienta hledá podle rodného čísla stejně jako aplikace (demo.json nebo fixtures.json). FHIR_BASE_URL, FHIR_USER,
// FHIR_PASSWORD z prostředí, výchozí = lokální IRIS z hackathon kitu.
import { readFileSync } from "node:fs";

const BASE = (process.env.FHIR_BASE_URL ?? "http://localhost:52773/fhir/r4").replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${process.env.FHIR_USER ?? "SuperUser"}:${process.env.FHIR_PASSWORD ?? "SYS"}`).toString("base64");
const headers = { "Content-Type": "application/fhir+json", Accept: "application/fhir+json", Authorization: AUTH };
const RC_SYSTEM = "https://ncez.mzcr.cz/fhir/sid/rcis";
const TAG = { system: "urn:smart-onco-aa:demo", code: "fhir-vysledek" };
const LAB = {
  hb: { code: "718-7", display: "Hemoglobin [Mass/volume] in Blood", label: "Hemoglobin", unit: "g/L" },
  plt: { code: "777-3", display: "Platelets [#/volume] in Blood", label: "Trombocyty", unit: "10*9/L" },
  wbc: { code: "6690-2", display: "Leukocytes [#/volume] in Blood", label: "Leukocyty", unit: "10*9/L" },
  ferritin: { code: "2276-4", display: "Ferritin [Mass/volume] in Serum or Plasma", label: "Ferritin", unit: "ug/L" },
};

async function fhir(method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}/${path}`, { method, headers, ...(body && { body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: FHIR ${res.status} ${JSON.stringify(json?.issue ?? json).slice(0, 300)}`);
  // IRIS po vytvoření vrací jen hlavičku Location (…/Observation/<id>/_history/1), bez těla
  const id = res.headers.get("location")?.match(/\/([^/]+)\/_history/)?.[1];
  return json ?? { id };
}

const args = process.argv.slice(2);
if (args[0] === "--smazat") {
  const found = await fhir("GET", `Observation?_tag=${TAG.system}|${TAG.code}&_count=500&_elements=id`);
  for (const e of found.entry ?? []) await fhir("DELETE", `Observation/${e.resource.id}`);
  console.log(`Smazáno výsledků: ${(found.entry ?? []).length}`);
  process.exit(0);
}

const [caseId, code, raw, date = new Date().toISOString().slice(0, 10)] = args;
const lab = LAB[code];
const value = Number(String(raw).replace(",", "."));
if (!caseId || !lab || !Number.isFinite(value)) {
  console.error("Použití: npm run fhir:vysledek -- <case-NN> <hb|plt|wbc|ferritin> <hodnota> [YYYY-MM-DD]   nebo   -- --smazat");
  process.exit(1);
}

const load = (file) => JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8")).cases;
const c = load("demo.json").find((x) => x.case_id === caseId && x.birth_number);
if (!c) throw new Error(`Případ ${caseId} nemá rodné číslo nebo neexistuje.`);
const digits = c.birth_number.replace(/\D/g, "");
const rcs = [...new Set([c.birth_number, `${digits.slice(0, 6)}/${digits.slice(6)}`, digits])];
const patients = await fhir("GET", `Patient?identifier=${rcs.map((r) => encodeURIComponent(`${RC_SYSTEM}|${r}`)).join(",")}&_count=1`);
const patient = patients.entry?.[0]?.resource;
if (!patient) throw new Error(`Pacient ${c.patient_name} (RČ ${c.birth_number}) v nemocnici není.`);

const created = await fhir("POST", "Observation", {
  resourceType: "Observation",
  meta: { tag: [TAG] },
  status: "final",
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
  code: { coding: [{ system: "http://loinc.org", code: lab.code, display: lab.display }], text: lab.label },
  subject: { reference: `Patient/${patient.id}` },
  effectiveDateTime: date,
  issued: new Date().toISOString(),
  valueQuantity: { value, unit: lab.unit, system: "http://unitsofmeasure.org", code: lab.unit },
});
console.log(`Nemocnice zapsala ${lab.label} ${value} (${lab.unit}, odběr ${date}) pacientovi ${c.patient_name} → ${BASE}/Observation/${created.id}`);
console.log(`V aplikaci u ${caseId} klikněte na „Aktualizovat“ v sekci Z nemocnice. Úklid: npm run fhir:vysledek -- --smazat`);
