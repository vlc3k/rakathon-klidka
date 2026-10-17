// SIMULACE Sdíleného lékového záznamu (SLZ, eRecept SÚKL) pro demo: do nemocničního FHIR serveru (IRIS) zapíše
// demo pacientům výdeje léků v lékárně za poslední rok jako MedicationDispense se štítkem „simulace SLZ“.
// Skutečný SLZ je jen pro zdravotnická zařízení s certifikátem SÚKL; v provozu by data přišla přes VFN.
// Navazuje na to, co o pacientech víme (IRIS, papíry od praktika), a schválně obsahuje pár rozdílů proti papírům
// (lék vyzvednutý v lékárně, který na zprávě chybí), ať jde ukázat porovnání.
// Pacienta hledá podle rodného čísla. Opakované spuštění nic nezdvojí.
//
//   node --env-file=.env scripts/seed-slz.mjs            (FHIR_BASE_URL, FHIR_USER, FHIR_PASSWORD; bez nich lokální IRIS)
//   node --env-file=.env scripts/seed-slz.mjs --smazat   odstraní simulované záznamy
import { readFileSync } from "node:fs";

const BASE = (process.env.FHIR_BASE_URL ?? "http://localhost:52773/fhir/r4").replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${process.env.FHIR_USER ?? "SuperUser"}:${process.env.FHIR_PASSWORD ?? "SYS"}`).toString("base64");
const headers = { "Content-Type": "application/fhir+json", Accept: "application/fhir+json", Authorization: AUTH };
const RC_SYSTEM = "https://ncez.mzcr.cz/fhir/sid/rcis";
const SLZ_SYSTEM = "urn:smart-onco-aa:slz-simulace";
const TAG = { system: "urn:smart-onco-aa:demo", code: "slz-simulace", display: "Simulace Sdíleného lékového záznamu" };
const ATC = "http://www.whocc.no/atc";

const demo = JSON.parse(readFileSync(new URL("./data/demo.json", import.meta.url), "utf8"));

// Výdeje: lék (obchodní název a látka), ATC, síla, dávkování z receptu, kdy vydáno, kolik balení.
const RECORDS = {
  "case-01": [
    { name: "Godasal", substance: "kyselina acetylsalicylová", atc: "B01AC06", strength: "100 mg", dose: "0-1-0", dates: ["2026-04-14", "2026-07-09", "2026-09-30"] },
  ],
  "case-02": [{ name: "Nurofen pro děti", substance: "ibuprofen", atc: "M01AE01", strength: "20 mg/ml", dose: "dle potřeby při horečce", dates: ["2026-08-21"] }],
  "case-03": [
    { name: "Tenoretic", substance: "atenolol, chlortalidon", atc: "C07CB03", strength: "50 mg/12,5 mg", dose: "1-0-0", dates: ["2026-01-12", "2026-04-08", "2026-07-06", "2026-10-02"] },
    { name: "Ferrum Lek", substance: "železo", atc: "B03AB05", strength: "100 mg", dose: "1-0-0", dates: ["2026-09-18"] },
  ],
  "case-04": [
    { name: "Hydrochlorothiazid Léčiva", substance: "hydrochlorothiazid", atc: "C03AA03", strength: "12,5 mg", dose: "1-0-0", dates: ["2026-02-03", "2026-05-04", "2026-08-03"] },
    { name: "Naproxen", substance: "naproxen", atc: "M01AE02", strength: "220 mg", dose: "dle potřeby, max. 2× denně", dates: ["2026-06-16", "2026-09-22"] },
  ],
  "case-05": [
    { name: "Naproxen", substance: "naproxen", atc: "M01AE02", strength: "220 mg", dose: "dle potřeby při bolesti", dates: ["2026-03-11"] },
    { name: "Baclofen Polpharma", substance: "baklofen", atc: "M03BX01", strength: "10 mg", dose: "1-1-1", dates: ["2026-03-11", "2026-06-10", "2026-09-09"] },
  ],
  "case-06": [
    { name: "Clexane", substance: "enoxaparin", atc: "B01AB05", strength: "4000 IU/0,4 ml", dose: "0-0-1 s.c.", dates: ["2026-05-20", "2026-08-19"] },
    { name: "Ventolin inhalátor", substance: "salbutamol", atc: "R03AC02", strength: "100 µg/dávka", dose: "1–2 vdechy dle potřeby", dates: ["2026-02-27"] },
    { name: "Paralen", substance: "paracetamol", atc: "N02BE01", strength: "500 mg", dose: "dle potřeby, max. 4× denně", dates: ["2026-07-30"] },
  ],
};

async function fhir(method, url, body) {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}/${url}`, { method, headers, ...(body && { body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => null);
  if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`${method} ${url}: FHIR ${res.status} ${JSON.stringify(json?.issue ?? json).slice(0, 400)}`);
  return json;
}

if (process.argv.includes("--smazat")) {
  const found = await fhir("GET", `MedicationDispense?_tag=${encodeURIComponent(`${TAG.system}|${TAG.code}`)}&_count=500&_elements=id`);
  for (const e of found.entry ?? []) await fhir("DELETE", `MedicationDispense/${e.resource.id}`);
  console.log(`${BASE}: smazáno ${found.entry?.length ?? 0} simulovaných výdejů SLZ.`);
  process.exit(0);
}

for (const [caseId, meds] of Object.entries(RECORDS)) {
  const c = demo.cases.find((x) => x.case_id === caseId);
  const patients = await fhir("GET", `Patient?identifier=${encodeURIComponent(`${RC_SYSTEM}|${c.birth_number}`)}&_elements=id`);
  const patientId = patients.entry?.[0]?.resource?.id;
  if (!patientId) throw new Error(`${c.patient_name}: na ${BASE} není (RČ ${c.birth_number}). Spusťte nejdřív seed-fhir.`);

  const entry = meds.flatMap((m) =>
    m.dates.map((date) => {
      const key = `${c.case_id}-${m.atc}-${date}`;
      return {
        resource: {
          resourceType: "MedicationDispense",
          meta: { tag: [TAG] },
          identifier: [{ system: SLZ_SYSTEM, value: key }],
          status: "completed",
          medicationCodeableConcept: { coding: [{ system: ATC, code: m.atc, display: m.substance }], text: `${m.name} ${m.strength} (${m.substance})` },
          subject: { reference: `Patient/${patientId}` },
          quantity: { value: 1, unit: "balení" },
          whenHandedOver: `${date}T10:00:00+02:00`,
          dosageInstruction: [{ text: m.dose }],
          note: [{ text: "SIMULACE Sdíleného lékového záznamu (eRecept SÚKL) pro demo, ne skutečný výdej." }],
        },
        request: { method: "POST", url: "MedicationDispense", ifNoneExist: `identifier=${SLZ_SYSTEM}|${key}` },
      };
    }),
  );
  const res = await fhir("POST", "", { resourceType: "Bundle", type: "batch", entry });
  const created = (res.entry ?? []).filter((e) => String(e.response?.status).startsWith("201")).length;
  console.log(`${c.patient_name} (Patient/${patientId}): ${entry.length} výdejů, nově zapsáno ${created}.`);
}
