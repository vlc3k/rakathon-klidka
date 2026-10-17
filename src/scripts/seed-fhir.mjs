// Připraví nemocniční FHIR server (IRIS z hackathon kitu) pro demo: pacientům od InterSystems (Synthea), kteří jsou
// v scripts/data/demo.json, doplní rodné číslo a totožnost z aplikace (jméno, narození, pohlaví). Zdravotní data nemění.
// Naše dřívější vymyšlené pacienty (vfn-*, test-*, demo-*) smaže i s jejich záznamy.
// Pacienty hledá podle trvalého ID ze Synthea (stejné na každém serveru), ID v IRIS se mezi servery liší.
//
//   node scripts/seed-fhir.mjs                     (FHIR_BASE_URL, FHIR_USER, FHIR_PASSWORD, výchozí = lokální IRIS)
//   node scripts/seed-fhir.mjs --nahrat <složka>   nejdřív nahraje Synthea bundly (data/fhir z hackathon kitu)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.FHIR_BASE_URL ?? "http://localhost:52773/fhir/r4").replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${process.env.FHIR_USER ?? "SuperUser"}:${process.env.FHIR_PASSWORD ?? "SYS"}`).toString("base64");
const RC_SYSTEM = "https://ncez.mzcr.cz/fhir/sid/rcis";
const headers = { "Content-Type": "application/fhir+json", Accept: "application/fhir+json", Authorization: AUTH };

const demo = JSON.parse(readFileSync(new URL("./data/demo.json", import.meta.url), "utf8"));
const synthea = JSON.parse(readFileSync(new URL("./data/synthea.json", import.meta.url), "utf8"));
const SYNTHEA_SYSTEM = "https://github.com/synthetichealth/synthea";
// fhirId z lokálního IRIS (demo.json) → trvalé Synthea ID
const syntheaId = (fhirId) =>
  synthea.patients.find((p) => String(p.fhirId) === String(fhirId))?.identifiers?.find((i) => i.system === SYNTHEA_SYSTEM)?.value;

async function fhir(method, url, body) {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}/${url}`, { method, headers, ...(body && { body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => null);
  if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`${method} ${url}: FHIR ${res.status} ${JSON.stringify(json?.issue ?? json).slice(0, 500)}`);
  return json;
}

// --- nahrání Synthea bundlů (nemocnice a lékaři první, pacienti na ně odkazují) ---
const bundleDir = process.argv[process.argv.indexOf("--nahrat") + 1];
if (process.argv.includes("--nahrat")) {
  const files = readdirSync(bundleDir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => Number(!/^(hospital|practitioner)Information/.test(a)) - Number(!/^(hospital|practitioner)Information/.test(b)) || a.localeCompare(b));
  for (const f of files) {
    const uuid = /_([0-9a-f-]{36})\.json$/.exec(f)?.[1];
    if (uuid && (await fhir("GET", `Patient?identifier=${encodeURIComponent(`${SYNTHEA_SYSTEM}|${uuid}`)}&_elements=id`)).total > 0) {
      console.log(`${f}: už nahraný`);
      continue;
    }
    const res = await fetch(BASE, { method: "POST", headers, body: readFileSync(path.join(bundleDir, f)) });
    if (!res.ok) throw new Error(`POST ${f}: FHIR ${res.status} ${(await res.text()).slice(0, 300)}`);
    console.log(`${f}: nahráno`);
  }
}

// --- rodná čísla pacientům od InterSystems ---
const done = new Set();
for (const c of demo.cases) {
  const uuid = c.hospital?.fhirId && syntheaId(c.hospital.fhirId);
  if (!uuid || done.has(uuid)) continue;
  done.add(uuid);
  const found = await fhir("GET", `Patient?identifier=${encodeURIComponent(`${SYNTHEA_SYSTEM}|${uuid}`)}`);
  if ((found.entry?.length ?? 0) > 1) throw new Error(`${c.patient_name}: Synthea ${uuid} má na serveru víc pacientů, hledání nefunguje.`);
  const patient = found.entry?.[0]?.resource;
  if (!patient) throw new Error(`${c.patient_name}: na ${BASE} není (Synthea ${uuid}). Nahrajte data: --nahrat <složka data/fhir z kitu>.`);
  const id = patient.id;
  const others = (patient.identifier ?? []).filter((i) => i.system !== RC_SYSTEM);
  patient.identifier = [...others, { system: RC_SYSTEM, value: c.birth_number }];
  // totožnost podle aplikace (testovací osoby Bank iD), původní jméno od InterSystems zůstane jako dřívější
  const official = { use: "official", family: c.last_name, given: [c.first_name] };
  const previous = (patient.name ?? []).filter((n) => !(n.family === c.last_name && n.given?.[0] === c.first_name)).map((n) => ({ ...n, use: "old" }));
  patient.name = [official, ...previous.filter((n, i, all) => all.findIndex((m) => m.family === n.family && m.given?.[0] === n.given?.[0]) === i)];
  patient.birthDate = c.birth_date;
  patient.gender = c.sex;
  await fhir("PUT", `Patient/${id}`, patient);
  console.log(`Patient/${id} ${c.patient_name}: RČ ${c.birth_number}`);
}

// --- úklid našich dřívějších vymyšlených pacientů ---
const all = [];
for (let page = await fhir("GET", "Patient?_count=200&_elements=id"); page; ) {
  all.push(...(page.entry ?? []).map((e) => e.resource.id));
  const next = page.link?.find((l) => l.relation === "next")?.url;
  page = next ? await fhir("GET", next) : null;
}
const stale = all.filter((id) => /^(vfn|test|demo)-/.test(id));
for (const id of stale) {
  for (const type of ["Observation", "Condition", "MedicationStatement", "AllergyIntolerance"]) {
    const found = await fhir("GET", `${type}?patient=Patient/${id}&_count=500&_elements=id`);
    for (const e of found.entry ?? []) await fhir("DELETE", `${type}/${e.resource.id}`);
  }
  await fhir("DELETE", `Patient/${id}`);
}
console.log(`${BASE}: RČ doplněno ${done.size} pacientům, smazáno našich dřívějších pacientů: ${stale.length}`);
