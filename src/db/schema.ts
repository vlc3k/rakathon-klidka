// SMART ONCO AA: datový model v3
//
// Základní jednotka je ÚKOL (task): pacient nebo AA má udělat jednu věc:
// nahrát dokument, odpovědět na otázku, nebo provést akci.
// Úkoly na začátku zákroku vzniknou zkopírováním ŠABLONY.
//
// Všechno, co o pacientovi víme (diagnóza, hemoglobin, léky, výška…), je INFORMACE
// (tabulka information): typ, hodnota v JSON, datum, zdroj a stav ověření.
// Ověřování nálezů AI není úkol, žije jen v information. Ověřuje jen AA, nikdy pacient.
//
// Do databáze ukládáme fakta a rozhodnutí lidí. Upozornění, semafor, stav PBM
// a pořadí ve frontě počítá TS za běhu z těchto tabulek a z catalog.ts.
// Prázdné created_by / entered_by / actor_id = systém (pravidla, AI).
//
// K databázi přistupuje jen server (lib/server/db.ts). RLS není zapnuté: aplikace
// se připojuje jednou rolí a oprávnění hlídá API (lib/server/auth.ts).

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date());
const caseId = () => uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------
// Výčty: jen stavy, které hlídá databáze. Typy informací a dokumentů jsou v catalog.ts.
// ---------------------------------------------------------------------------

// aa = kdokoli z anesteziologické ambulance; helper = pomocník z rodiny, kterého pozval pacient (tabulka helpers)
export const userRole = pgEnum("user_role", ["patient", "aa", "helper"]);
export const caseStatus = pgEnum("case_status", ["new", "active", "closed", "cancelled"]); // new = založil pacient sám, čeká na potvrzení v AA
export const taskKind = pgEnum("task_kind", [
  "upload",    // nahrát dokument (např. laboratoř s hemoglobinem ne starším 14 dní)
  "question",  // odpovědět / doplnit informaci (výška, váha, alergie…)
  "action",    // udělat něco mimo aplikaci (odběr krve, PBM posouzení, zavolat pacientovi)
]);
export const taskStatus = pgEnum("task_status", [
  "open",      // čeká na toho, komu patří
  "submitted", // pacient nahrál, AI dokument ještě čte
  "done",
  "snoozed",   // odloženo s důvodem
  "cancelled", // nepotřeba / zamítnuto, s důvodem
]);
export const documentStatus = pgEnum("document_status", ["uploaded", "processing", "processed", "failed"]);
// Přepis dokumentu (document_transcripts): celý text všech stránek, z něj AI vytáhne hodnoty do information.
export const transcriptStatus = pgEnum("transcript_status", [
  "processing", // AI právě čte hodnoty
  "processed",  // hodnoty jsou v information
  "failed",     // čtení selhalo, důvod v error; jde zopakovat
  "skipped",    // pacient čtení přeskočil, stránky zůstaly pro AA bez hodnot
]);
export const patientMatch = pgEnum("patient_match", ["pending", "match", "mismatch", "uncertain"]); // odpovídá / neodpovídá / nelze ověřit
export const informationStatus = pgEnum("information_status", [
  "ai_extracted", // přečetla AI, nikdo zatím nepotvrdil, že to sedí s dokumentem
  "verified",     // člověk z AA potvrdil, že hodnota odpovídá dokumentu; kdo, je ve verified_by
  "rejected",     // nesedí; oprava je nová informace s replaces_id
]);

// ---------------------------------------------------------------------------
// Lidé
// ---------------------------------------------------------------------------

// Každý, kdo se přihlašuje: pacient i lidé z AA.
export const users = pgTable("users", {
  id: id(),
  role: userRole("role").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  displayName: text("display_name").notNull(),                     // jak se zobrazuje, i s tituly: "MUDr. Jana Dvořáková, Ph.D."
  email: text("email"),                                            // AA se jím přihlašuje; ukládá se malými písmeny
  phone: text("phone"),                                            // pacient: kontakt; AA: číslo, které vidí pacient
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
]);

// Pacient = uživatel s rolí 'patient'. Tady je jen to, co v users není.
export const patients = pgTable("patients", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  birthNumber: text("birth_number").unique(),                      // rodné číslo bez lomítka; cizinci ho nemají
  externalId: text("external_id").unique(),                        // identifikátor z nemocnice (VFN-2026-0142), velkými písmeny; pacient se jím přihlašuje
  birthDate: date("birth_date").notNull(),
  sex: text("sex"),
}, (t) => [
  check("patients_birth_number_format", sql`${t.birthNumber} ~ '^[0-9]{9,10}$'`),
  check("patients_has_identifier", sql`${t.birthNumber} is not null or ${t.externalId} is not null`),
]);

// Pomocník z rodiny (dcera, syn, partner…), kterého pozval pacient. Přístup je na úrovni pacienta, ne zákroku:
// senior má často víc zákroků po sobě a nemá kvůli každému zvát znovu. Pomocník vidí a dělá totéž co pacient,
// kromě podpisu souhlasu s anestezií, zvaní dalších pomocníků a ukončení přístupu; to hlídá API, ne jen obrazovka.
// V odkazu z pozvánky je náhodný token, tady jen jeho SHA-256 (jako u sessions). Účet pomocníka (users, role helper)
// vznikne až při přijetí pozvánky, kdy pomocník zadá datum narození pacienta.
export const helpers = pgTable("helpers", {
  id: id(),
  patientId: uuid("patient_id").notNull().references(() => patients.userId),
  userId: uuid("user_id").references(() => users.id),              // účet pomocníka; prázdné, dokud pozvánku nepřijal
  displayName: text("display_name").notNull(),                     // jak ho pacient pojmenoval: "Petra"
  relation: text("relation").notNull(),                            // daughter / son / partner / other (lib/helpers.ts)
  inviteTokenHash: text("invite_token_hash").notNull(),            // SHA-256 tokenu z odkazu (hex)
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }).notNull(), // do kdy jde pozvánku přijmout (14 dní)
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(), // kdy pacient výslovně souhlasil s pomocí
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  joinedAt: timestamp("joined_at", { withTimezone: true }),        // první přijetí pozvánky
  revokedAt: timestamp("revoked_at", { withTimezone: true }),      // pacient ukončil přístup; pozvánka ani session pak neplatí
}, (t) => [
  index("helpers_patient_idx").on(t.patientId),
  uniqueIndex("helpers_invite_token_key").on(t.inviteTokenHash),
  uniqueIndex("helpers_user_key").on(t.userId),
  check("helpers_relation", sql`${t.relation} in ('daughter', 'son', 'partner', 'other')`),
]);

// Přihlášení. V cookie je jen náhodný token, tady jeho SHA-256, takže únik databáze session nevydá.
// Odhlášení řádek smaže, session tím přestane platit hned, ne až po vypršení.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),                                     // SHA-256 tokenu z cookie (hex)
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("sessions_user_idx").on(t.userId),
]);

// Neúspěšná přihlášení pro omezení zkoušení (identifikátor a IP zvlášť). Klíč je SHA-256, ne čitelný údaj.
export const loginAttempts = pgTable("login_attempts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  key: text("key").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("login_attempts_key_idx").on(t.key, t.createdAt),
  index("login_attempts_created_idx").on(t.createdAt), // úklid prošlých pokusů
]);

// ---------------------------------------------------------------------------
// Šablony
// ---------------------------------------------------------------------------

// Šablona = typ zákroku a seznam úkolů, které se při založení zákroku zkopírují.
// Upravovat smí kdokoli z AA, i nemocniční šablony.
export const templates = pgTable("templates", {
  id: id(),
  name: text("name").notNull(),                                    // "Resekce tlustého střeva"
  description: text("description"),
  bloodLossMl: integer("blood_loss_ml"),                           // výchozí očekávaná krevní ztráta (> 500 ml spouští PBM)
  ownerId: uuid("owner_id").references(() => users.id),            // prázdné = nemocniční šablona; jinak vlastní šablona lékaře
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Úkol v šabloně. Stejné sloupce "co je potřeba" jako tasks.
export const templateTasks = pgTable("template_tasks", {
  id: id(),
  templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  assignee: userRole("assignee").notNull(),                        // komu úkol patří: pacient, nebo AA
  kind: taskKind("kind").notNull(),
  title: text("title").notNull(),                                  // "Krevní testy (krevní obraz)"
  instructions: text("instructions"),                              // nápověda pro pacienta
  documentType: text("document_type"),                             // jaký dokument chceme (catalog.ts DOCUMENT_TYPES)
  informationType: text("information_type"),                       // jakou informaci potřebujeme (catalog.ts INFORMATION_TYPES)
  validForDays: integer("valid_for_days"),                         // jak dlouho od odběru / vystavení výsledek platí (hemoglobin 14)
  isRequired: boolean("is_required").notNull().default(true),
  appliesFromAge: integer("applies_from_age"),                     // úkol jen pro pacienty od tohoto věku (EKG od 65)
  dueDaysBeforeSurgery: integer("due_days_before_surgery"),        // termín splnění vůči operaci
}, (t) => [
  index("template_tasks_template_idx").on(t.templateId),
  check("template_tasks_target", sql`(${t.kind} <> 'upload' or ${t.documentType} is not null or ${t.informationType} is not null)
    and (${t.kind} <> 'question' or ${t.informationType} is not null)`),
]);

// ---------------------------------------------------------------------------
// Zákrok
// ---------------------------------------------------------------------------

// Zákrok = jedna předoperační příprava k jednomu plánovanému výkonu.
// Je tu jen plán (co, kdy, kdo). Co víme o pacientovi, včetně diagnózy, je v information.
export const cases = pgTable("cases", {
  id: id(),
  patientId: uuid("patient_id").notNull().references(() => patients.userId),
  templateId: uuid("template_id").references(() => templates.id),  // z jaké šablony vznikly úkoly
  status: caseStatus("status").notNull().default("new"),
  procedureName: text("procedure_name"),                           // předvyplněno ze šablony, jde upravit
  surgeryDate: date("surgery_date"),
  aaVisitAt: timestamp("aa_visit_at", { withTimezone: true }),     // schůzka v AA
  bloodLossMl: integer("blood_loss_ml"),                           // ze šablony, jde upravit
  isOncological: boolean("is_oncological").notNull().default(false),
  contactId: uuid("contact_id").references(() => users.id),        // kontaktní osoba v AA, pacient vidí jméno a telefon
  summary: text("summary"),                                        // AI souhrn pro AA (markdown)
  summaryPoints: jsonb("summary_points"),                          // [{"text":"…","informationIds":["…"]}]
  summaryAt: timestamp("summary_at", { withTimezone: true }),      // starší než poslední událost = přegenerovat
  aaSeenAt: timestamp("aa_seen_at", { withTimezone: true }),       // kdy zákrok naposledy otevřel někdo z AA → "nové"
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("cases_patient_idx").on(t.patientId),
]);

// Úkol na zákroku. Vzniká ze šablony, nebo ho zadá ambulance (vyžádání dokumentu, konzilium).
export const tasks = pgTable("tasks", {
  id: id(),
  caseId: caseId(),
  templateTaskId: uuid("template_task_id").references(() => templateTasks.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  assignee: userRole("assignee").notNull(),                        // komu úkol patří: pacient, nebo AA
  assigneeId: uuid("assignee_id").references(() => users.id),      // konkrétní člověk, nebo kdokoli s tou rolí
  kind: taskKind("kind").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  // co je potřeba (kopie ze šablony)
  documentType: text("document_type"),                             // jaký dokument chceme; AI pozná typ nahraného a úkol se splní
  informationType: text("information_type"),                       // jakou informaci potřebujeme; splní ji jakýkoli dokument nebo odpověď
  validForDays: integer("valid_for_days"),
  isRequired: boolean("is_required").notNull().default(true),
  dueDate: date("due_date"),
  // čím je splněno
  documentId: uuid("document_id").references((): AnyPgColumn => documents.id, { onDelete: "set null" }),
  informationId: uuid("information_id").references((): AnyPgColumn => information.id, { onDelete: "set null" }),
  // stav
  status: taskStatus("status").notNull().default("open"),
  statusNote: text("status_note"),                                 // důvod odložení / zrušení, nebo "výsledek je starší než 14 dní"
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),            // kdy si pacient úkol zobrazil (otevřel přehled zákroku); prázdné = ještě neviděl
  // převzaté upozornění (action)
  process: text("process"),                                        // 'pbm' = úkol patří do Patient Blood Management; z nich se počítá štítek PBM PROBÍHÁ
  alertKey: text("alert_key"),                                     // které upozornění úkol řeší: 'pbm.hb_low:<information_id>'
  payload: jsonb("payload").notNull().default({}),                 // např. odběr {"tests":["hemoglobin","ferritin","tsat"]}
  evidence: jsonb("evidence"),                                     // co upozornění v tu chvíli říkalo + verze pravidel
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("tasks_case_idx").on(t.caseId),
  index("tasks_queue_idx").on(t.assignee, t.status),
  uniqueIndex("tasks_open_alert_key").on(t.caseId, t.alertKey)
    .where(sql`${t.status} in ('open', 'snoozed') and ${t.alertKey} is not null`),
  check("tasks_target", sql`(${t.kind} <> 'upload' or ${t.documentType} is not null or ${t.informationType} is not null)
    and (${t.kind} <> 'question' or ${t.informationType} is not null)`),
  // klinicky významná akce směrem k pacientovi (odběr) jen po schválení v AA
  check("tasks_patient_action_approved", sql`not (${t.assignee} = 'patient' and ${t.kind} = 'action') or ${t.approvedBy} is not null`),
  check("tasks_note_required", sql`${t.status} not in ('snoozed', 'cancelled') or ${t.statusNote} is not null`),
  check("tasks_snooze_has_until", sql`${t.status} <> 'snoozed' or ${t.snoozedUntil} is not null`),
]);

// ---------------------------------------------------------------------------
// Dokumenty a informace
// ---------------------------------------------------------------------------

// Nahraná fotka / sken / PDF / hlasová zpráva, včetně výsledku čtení AI.
// Samotný soubor je v Azure Blob Storage pod klíčem file_path.
export const documents = pgTable("documents", {
  id: id(),
  caseId: caseId(),
  taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }), // přes který úkol byl nahraný (může splnit i jiné)
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  filePath: text("file_path").notNull(),                           // klíč originálu v privátním úložišti, bez osobních údajů
  fileName: text("file_name"),
  mimeType: text("mime_type").notNull(),                           // zjištěný z obsahu souboru, ne z hlavičky klienta
  sha256: text("sha256").notNull(),
  status: documentStatus("status").notNull().default("uploaded"),
  type: text("type"),                                              // typ dokumentu (catalog.ts DOCUMENT_TYPES); u lékařských zpráv ho rozpozná AI
  issuedDate: date("issued_date"),                                 // datum vystavení ≠ datum informací v něm
  pageLabel: text("page_label"),                                   // '2/2'
  patientMatch: patientMatch("patient_match").notNull().default("pending"),
  patientMatchNote: text("patient_match_note"),                    // proč (shoda RČ, jiné jméno…), RČ jen maskované
  patientMatchCheckedBy: uuid("patient_match_checked_by").references(() => users.id), // vyplněno = vazbu potvrdil člověk
  issues: jsonb("issues").notNull().default([]),                   // nečitelné, rozporné, podezřelé
  meta: jsonb("meta").notNull().default({}),                       // od klienta: metriky fotky úst, délka hlasovky, verze souhlasu
  aiModel: text("ai_model"),                                       // model, který stránku přepsal
  aiOutput: jsonb("ai_output"),                                    // surový strukturovaný výstup AI
  // Lékařská zpráva se čte ve dvou krocích: 1. přepis stránky (tady), 2. hodnoty z přepisu všech stránek (document_transcripts).
  transcript: jsonb("transcript"),                                 // přepis stránky po řádcích s polohou: {legibility, lines: [{id, text, box, confidence}]}
  transcriptText: text("transcript_text"),                         // celý text stránky (řádky pod sebou), pro hledání a čtení hodnot
  aiMeta: jsonb("ai_meta"),                                        // jak přepis vznikl: {model, promptVersion, schemaVersion, durationMs, attempts, usage, finishedAt}
  transcriptId: uuid("transcript_id").references((): AnyPgColumn => documentTranscripts.id, { onDelete: "set null" }), // dokument, do kterého stránka patří
  pageNumber: integer("page_number"),                              // pořadí stránky v dokumentu (1, 2, …)
  error: text("error"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  // Odebraný dokument (omylem nahraný, cizí stránka): nic se nemaže natvrdo, soubor v úložišti zůstává, API ho už nevydá.
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: uuid("removed_by").references(() => users.id),
}, (t) => [
  index("documents_case_idx").on(t.caseId),
  index("documents_transcript_idx").on(t.transcriptId),
  // stejný soubor jde nahrát znovu, jen když ten předchozí někdo odebral
  uniqueIndex("documents_case_sha256_key").on(t.caseId, t.sha256).where(sql`${t.removedAt} is null`),
]);

// Přepis jednoho dokumentu (i vícestránkového): celý text všech stránek a z něj hodnoty s odkazy
// na řádky přepisu. Hodnoty jdou do information (stav ai_extracted), výstup a metadata sem.
// Každé čtení je nový řádek, starší zůstávají (víme, co a jakým modelem se kdy přečetlo).
export const documentTranscripts = pgTable("document_transcripts", {
  id: id(),
  caseId: caseId(),
  status: transcriptStatus("status").notNull().default("processing"),
  documentType: text("document_type"),                             // rozpoznaný typ (catalog.ts DOCUMENT_TYPES)
  issuedDate: date("issued_date"),                                 // datum vystavení dokumentu
  pageCount: integer("page_count").notNull(),
  transcriptText: text("transcript_text"),                         // celý přepis všech stránek tak, jak šel do modelu
  output: jsonb("output"),                                         // ověřený strukturovaný výstup AI (lib/server/transcripts/schema.ts)
  model: text("model"),                                            // model, který hodnoty četl
  promptVersion: text("prompt_version"),
  schemaVersion: integer("schema_version"),
  usage: jsonb("usage"),                                           // spotřeba tokenů {input, output, total}
  durationMs: integer("duration_ms"),
  attempts: integer("attempts"),
  error: text("error"),                                            // proč čtení selhalo (kód a text, bez osobních údajů)
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("document_transcripts_case_idx").on(t.caseId, t.createdAt.desc()),
]);

// Informace: jedna věc o pacientovi s původem, datem a stavem ověření.
// Jeden řádek = jedna samostatně ověřitelná věc (jeden výsledek, jeden lék, jedna alergie).
// Nálezy AI mají stav ai_extracted. Ověření = člověk z AA potvrdí, že hodnota sedí
// s dokumentem (chyby čtení / OCR). Pacient nálezy AI neověřuje.
// Klinické rozhodnutí se na informaci neukládá, je v úkolech.
// Oprava = nová informace s replaces_id, původní dostane status 'rejected'.
// Informace zadaná člověkem (odpověď na otázku, zápis AA) vzniká rovnou jako 'verified'.
export const information = pgTable("information", {
  id: id(),
  caseId: caseId(),
  type: text("type").notNull(),                                    // typ (catalog.ts INFORMATION_TYPES): 'hemoglobin', 'weight', 'medication'…
  value: jsonb("value").notNull(),                                 // tvar podle typu, hlídá zod (db/values.ts): {"value":98,"unit":"g/l","refLow":135,"refHigh":175}
  rawText: text("raw_text"),                                       // jak to stojí v dokumentu: 'HGB 9,8 g/dl'
  observedDate: date("observed_date"),                             // datum odběru / vyšetření, NE datum dokumentu
  isObservedDateEstimated: boolean("is_observed_date_estimated").notNull().default(false), // převzaté z data dokumentu
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }), // z jakého dokumentu; prázdné = zadal člověk
  transcriptId: uuid("transcript_id").references(() => documentTranscripts.id, { onDelete: "set null" }), // ze kterého přepisu AI vznikla
  taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }), // odpověď na úkol (otázku); prázdné = z dokumentu nebo zápis AA
  bbox: jsonb("bbox"),                                             // výřez ve fotce {x,y,w,h} v rozsahu 0–1
  confidence: numeric("confidence", { mode: "number" }),           // jistota AI 0–1
  status: informationStatus("status").notNull(),
  enteredBy: uuid("entered_by").references(() => users.id),       // kdo zadal; prázdné = AI z dokumentu
  verifiedBy: uuid("verified_by").references(() => users.id),     // kdo ověřil / zamítl
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  note: text("note"),                                              // proč zamítnuto, když oprava chybí
  replacesId: uuid("replaces_id").references((): AnyPgColumn => information.id),
  createdAt: createdAt(),                                          // kdy se to systém dozvěděl
}, (t) => [
  index("information_case_type_idx").on(t.caseId, t.type, t.observedDate.desc()),
  index("information_document_idx").on(t.documentId),
  index("information_to_verify_idx").on(t.caseId, t.documentId).where(sql`${t.status} = 'ai_extracted'`), // seznam "k ověření"
  check("information_has_source", sql`${t.enteredBy} is not null or ${t.documentId} is not null`),
  check("information_verified_has_who", sql`${t.status} = 'ai_extracted' or ${t.verifiedBy} is not null`),
]);

// ---------------------------------------------------------------------------
// Stopa
// ---------------------------------------------------------------------------

// Časová osa zákroku. Zároveň audit (kdo co kdy) a zdroj pro "nové".
// Rodné číslo sem nepatří.
export const events = pgTable("events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  caseId: caseId(),
  actorId: uuid("actor_id").references(() => users.id),
  type: text("type").notNull(),                                    // 'document.uploaded', 'information.verified', 'task.done'…
  subjectId: uuid("subject_id"),                                   // id dokumentu / informace / úkolu
  summary: text("summary").notNull(),                              // čitelný řádek pro časovou osu
  data: jsonb("data").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  index("events_case_idx").on(t.caseId, t.id.desc()),
]);
