// Demo zákroky pro 6 pacientů z nemocničního FHIR (IRIS): zákrok ze šablony, úkoly, nahrané fotky dokumentů
// (lib/data/demo-docs) a jejich čtení naostro přes AI, stejně jako když je nahraje pacient. Časová osa vznikne sama.
// Jde přes služby backendu (lib/server/services), ne přímo do tabulek, ať data vypadají jako ze skutečného provozu.
// Pacienty musí už mít databáze (scripts/seed-patients.ts), kontakt v AA je první uživatel z AA (npm run db:seed).
//
//   npm run seed:cases              založí, co chybí (opakované spuštění nic nezdvojí, přečtené dokumenty nečte znovu)
//   npm run seed:cases -- --smazat  smaže tyto demo zákroky i se soubory v úložišti
import { readFileSync } from "node:fs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { cases, documents, patients, tasks, templates, users } from "@/db/schema";
import type { CurrentUser } from "@/lib/server/auth";
import { getBlobStore } from "@/lib/server/blob";
import { getDb } from "@/lib/server/db";
import { createCase } from "@/lib/server/services/cases";
import { uploadDocument } from "@/lib/server/services/documents";
import { createTemplate } from "@/lib/server/services/templates";
import { createDocumentTranscript, transcribeDocument } from "@/lib/server/services/transcripts";
import demo from "./data/demo.json";

for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // proměnné můžou přijít z prostředí
  }
}

const TEMPLATE = "Předoperační příprava (demo)";
const DOCS_DIR = new URL("../lib/data/demo-docs/", import.meta.url);

// Typ dokumentu z demo dat → úkol ze šablony, přes který ho pacient nahraje.
const TASK_FOR: Record<string, string> = {
  preoperative_exam: "Předoperační vyšetření",
  laboratory: "Krevní testy",
  ecg: "EKG",
};

type DemoCase = (typeof demo.cases)[number];
type DemoDocument = { file: string; _truth?: { dx?: string[] }; document: { type: string } };
const docInfo = (file: string) => (demo.documents as DemoDocument[]).find((d) => d.file === file);

// Jen pacienti, kteří jsou i v nemocničním FHIR (Nedbal tam není).
const demoCases = demo.cases.filter((c): c is DemoCase & { hospital: { fhirId: string } } => !!c.hospital?.fhirId);

const asActor = (u: { id: string; role: CurrentUser["role"]; firstName: string; lastName: string; displayName: string }): CurrentUser => ({
  id: u.id,
  role: u.role,
  firstName: u.firstName,
  lastName: u.lastName,
  displayName: u.displayName,
});

async function staffActor() {
  const [row] = await getDb().select().from(users).where(eq(users.role, "aa")).orderBy(asc(users.createdAt)).limit(1);
  if (!row) throw new Error("V databázi není nikdo z AA. Spusťte nejdřív npm run db:seed.");
  return asActor(row);
}

async function patientOf(c: DemoCase) {
  const [row] = await getDb()
    .select({ id: users.id, role: users.role, firstName: users.firstName, lastName: users.lastName, displayName: users.displayName })
    .from(patients)
    .innerJoin(users, eq(users.id, patients.userId))
    .where(eq(patients.birthNumber, c.birth_number.replace("/", "")));
  if (!row) throw new Error(`${c.patient_name}: pacient v databázi chybí. Spusťte nejdřív scripts/seed-patients.ts.`);
  return asActor(row);
}

// Šablona pro všechny demo zákroky. Úkoly pro pacienta odpovídají dokumentům, které máme nafocené.
async function ensureTemplate(actor: CurrentUser) {
  const [found] = await getDb().select({ id: templates.id }).from(templates).where(eq(templates.name, TEMPLATE));
  if (found) return found.id;
  const template = await createTemplate(actor, {
    name: TEMPLATE,
    description: "Běžná předoperační příprava: zpráva od praktika, krevní testy, od 45 let EKG.",
    tasks: [
      { assignee: "patient", kind: "upload", title: TASK_FOR.preoperative_exam, documentType: "preop_exam", instructions: "Zpráva od praktického lékaře nebo internisty před operací." },
      { assignee: "patient", kind: "upload", title: TASK_FOR.laboratory, documentType: "lab_report", informationType: "hemoglobin", validForDays: 14, instructions: "Krevní obraz ne starší než 14 dní před operací." },
      { assignee: "patient", kind: "upload", title: TASK_FOR.ecg, documentType: "ecg", appliesFromAge: 45 },
      { assignee: "patient", kind: "upload", title: "Fotka úst", documentType: "airway_photo", isRequired: false },
      { assignee: "aa", kind: "action", title: "Zkontrolovat přečtené hodnoty" },
    ],
  });
  console.log(`Šablona „${TEMPLATE}“ založena.`);
  return template.id;
}

function diagnosisOf(c: DemoCase) {
  const first = c.documents.map((f) => docInfo(f)?._truth?.dx?.[0]).find(Boolean);
  const match = first?.match(/^([A-Z]\d{2}(?:\.\d{1,2})?)\s+(.+)$/);
  return match ? { icd10: match[1], text: match[2] } : { text: c.procedure };
}

async function seedCase(c: DemoCase, staff: CurrentUser, templateId: string) {
  const db = getDb();
  const patient = await patientOf(c);
  let [row] = await db.select().from(cases).where(and(eq(cases.patientId, patient.id), eq(cases.procedureName, c.procedure)));
  if (!row) {
    const caseId = await db.transaction((tx) =>
      createCase(tx, staff, {
        patientId: patient.id,
        templateId,
        procedureName: c.procedure,
        diagnosis: diagnosisOf(c),
        surgeryDate: c.case_date,
        isOncological: c.oncological,
      }),
    );
    [row] = await db.select().from(cases).where(eq(cases.id, caseId));
    console.log(`${c.patient_name}: založen zákrok ${c.procedure} (${c.case_date}).`);
  } else {
    console.log(`${c.patient_name}: zákrok už existuje.`);
  }

  const caseTasks = await db.select().from(tasks).where(eq(tasks.caseId, row.id));
  for (const file of c.documents) {
    const type = docInfo(file)?.document.type ?? "";
    const task = caseTasks.find((t) => t.title === TASK_FOR[type] && t.assignee === "patient");
    const form = new FormData();
    form.set("file", new File([readFileSync(new URL(file, DOCS_DIR))], file, { type: "image/jpeg" }));
    if (task && task.status === "open") form.set("taskId", task.id);

    const { created, document } = await uploadDocument(patient, row, form);
    if (document.transcriptId) {
      console.log(`  ${file}: už nahraný a přečtený.`);
      continue;
    }
    const started = Date.now();
    await transcribeDocument(patient, row, document.id);
    const { informationCount, failure } = await createDocumentTranscript(patient, row, { documentIds: [document.id] });
    if (failure) console.warn(`  ${file}: čtení selhalo: ${failure.message}`);
    else console.log(`  ${file}: ${created ? "nahráno" : "už bylo nahrané"}, přečteno ${informationCount} údajů za ${Math.round((Date.now() - started) / 1000)} s.`);
  }
}

async function remove() {
  const db = getDb();
  const blobs = getBlobStore();
  for (const c of demoCases) {
    const patient = await patientOf(c);
    const rows = await db.select({ id: cases.id }).from(cases).where(and(eq(cases.patientId, patient.id), eq(cases.procedureName, c.procedure)));
    if (!rows.length) continue;
    const ids = rows.map((r) => r.id);
    const files = await db.select({ filePath: documents.filePath }).from(documents).where(inArray(documents.caseId, ids));
    for (const f of files) await blobs.delete(f.filePath).catch(() => undefined);
    await db.delete(cases).where(inArray(cases.id, ids)); // úkoly, dokumenty, informace a události se smažou s ním
    console.log(`${c.patient_name}: smazán zákrok (${files.length} souborů).`);
  }
}

async function main() {
  if (process.argv.includes("--smazat")) return remove();
  const staff = await staffActor();
  const templateId = await ensureTemplate(staff);
  for (const c of demoCases) {
    try {
      await seedCase(c, staff, templateId);
    } catch (error) {
      console.error(`${c.patient_name}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
