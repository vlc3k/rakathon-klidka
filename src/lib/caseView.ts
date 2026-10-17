// Z odpovědí API (detail zákroku, úkoly) skládá, co ukazuje detail v ambulanci: profil z dokumentů,
// originály s místy, odkud AI četla, kontrolní seznam a vstup pro časovou osu. Nic nepočítá znovu:
// stav Hb, PBM a kontroly čtení přicházejí ze serveru, tady se jen třídí a popisuje.
import { DOCUMENT_TYPES, INFORMATION_TYPES } from "@/db/catalog";
import type { CaseDetail, CaseDocument, Information, Task } from "@/lib/api/types";
import { formatDate } from "@/lib/date";
import type { ReadinessInput } from "@/lib/readiness";
import type { Check } from "@/lib/reading/validate";
import type { Box } from "@/lib/reading/ground";

// ---------------------------------------------------------------------------
// Popisky
// ---------------------------------------------------------------------------

export const documentTypeLabel = (type: string | null) =>
  type && type in DOCUMENT_TYPES ? DOCUMENT_TYPES[type as keyof typeof DOCUMENT_TYPES].name : "Dokument";

const ISSUE_LABEL: Record<string, string> = {
  patient_identity_unclear: "Nejasná identita",
  values_and_ranges_inconsistent: "Posunuté hodnoty",
  missing_sample_date: "Chybí datum odběru",
  old_document: "Starý dokument",
  partial_page: "Neúplná stránka",
  illegible: "Hůř čitelné",
  redacted: "Začerněno",
  other: "Jiné",
};
const IMPORTANT_ISSUES = new Set(["patient_identity_unclear", "values_and_ranges_inconsistent", "missing_sample_date", "old_document"]);

// ---------------------------------------------------------------------------
// Hodnoty informací (tvar podle typu je v db/values.ts)
// ---------------------------------------------------------------------------

type LabValue = { value?: number | string; unit?: string | null; flag?: "L" | "H" | null; name?: string };
type Value = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function informationLabel(info: Pick<Information, "type" | "value">) {
  const value = info.value as Value;
  if (info.type === "lab_other") return str(value.name) ?? "Laboratoř";
  return info.type in INFORMATION_TYPES ? INFORMATION_TYPES[info.type as keyof typeof INFORMATION_TYPES].name : info.type;
}

// Hodnota tak, jak ji čte člověk: „101 g/l“, „Concor 5 mg 1-0-0“, „Penicilin (vyrážka)“.
export function informationText(info: Pick<Information, "type" | "value">) {
  const value = info.value as Value;
  if (value.none === true) return "nemá";
  if (typeof value.value === "boolean") return value.value ? "ano" : "ne";
  if (typeof value.value === "number" || typeof value.value === "string") {
    return [value.value, str(value.unit)?.replace("10^9", "10⁹")].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
  }
  if (info.type === "medication") return [str(value.name), str(value.strength), str(value.dose)].filter(Boolean).join(" ");
  if (info.type === "allergy") return [str(value.substance), str(value.reaction) && `(${str(value.reaction)})`].filter(Boolean).join(" ");
  if (info.type === "diagnosis" || info.type === "condition") return [str(value.icd10), str(value.text)].filter(Boolean).join(" ");
  return str(value.text) ?? JSON.stringify(value);
}

export const boxOf = (bbox: unknown): Box | null => {
  const b = bbox as Partial<Box> | null;
  if (!b || ![b.x, b.y, b.w, b.h].every((n) => typeof n === "number")) return null;
  const quad = Array.isArray(b.quad) && b.quad.length === 4 && b.quad.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number")) ? b.quad : undefined;
  return { x: b.x!, y: b.y!, w: b.w!, h: b.h!, ...(quad ? { quad } : {}) };
};

// ---------------------------------------------------------------------------
// Profil: co z dokumentů víme
// ---------------------------------------------------------------------------

export type Verification = { verifiedAt: string | null; verifiedBy: string | null };

export type LabRow = {
  id: string;
  code: string;
  label: string;
  value: string;
  flag: "L" | "H" | null;
  sampleDate: string | null;
  documentId: string | null;
  check: Check;
  box: Box | null;
  verified: Verification | null;
};
// Položka profilu. `ids`: všechny informace, které zastupuje (stejný lék z víc dokumentů, stejná diagnóza dvakrát),
// potvrzuje a odvolává se jimi; potvrzená je, až když jsou potvrzené všechny.
export type ProfileItem = { id: string; ids: string[]; text: string; documentId: string | null; box: Box | null; verified: Verification | null };
export type MedRow = ProfileItem & { name: string; dose: string | null };
export type ProfileBlock<T> = { items: T[]; ids: string[]; verified: Verification | null };

export type CaseProfile = {
  diagnosis: string;
  labs: LabRow[];
  allergies: ProfileBlock<ProfileItem>;
  allergiesNone: boolean;
  // „Neguje alergie“ jako položka k potvrzení (jen když žádnou alergii nevypisuje).
  allergiesNoneItem: ProfileItem | null;
  meds: ProfileBlock<MedRow>;
  anamnesis: ProfileBlock<ProfileItem>;
};

const LAB_ORDER = ["hemoglobin", "platelets", "leukocytes", "ferritin", "transferrin_saturation", "crp", "creatinine", "lab_other"];

const verification = (info: Information): Verification | null =>
  info.status === "verified" ? { verifiedAt: info.verifiedAt, verifiedBy: info.verifiedBy } : null;

// Potvrzené jsou, až když jsou potvrzené všechny; kdo a kdy podle posledního potvrzení.
function verifiedAll(infos: Information[]): Verification | null {
  if (infos.length === 0 || infos.some((info) => info.status !== "verified")) return null;
  const last = infos.map((info) => info.verifiedAt).filter((at): at is string => !!at).sort().at(-1) ?? null;
  return { verifiedAt: last, verifiedBy: infos.find((info) => info.verifiedAt === last)?.verifiedBy ?? null };
}

// Blok (alergie, léky, anamnéza): položky se potvrzují po jedné, blok je potvrzený, až když jsou všechny (tisk).
function block<T>(infos: Information[], toItem: (info: Information, group: Information[]) => T): ProfileBlock<T> {
  return { items: infos.map((info) => toItem(info, [info])), ids: infos.map((info) => info.id), verified: verifiedAll(infos) };
}

// Stejný lék z víc dokumentů jen jednou: „Paracetamol“ ze zprávy a „Paralen paracetamol“ ze seznamu léků
// mají společné výrazné slovo (látku nebo značku). Zobrazí se ten s místem na fotce a nejdelším názvem,
// potvrzení ale platí pro všechny jeho výskyty.
const GENERIC_WORDS = new Set(["tablety", "tableta", "inhalator", "roztok", "sodna", "draselna", "injekce", "kapsle", "dle", "potreby"]);
const medWords = (info: Information) =>
  (str((info.value as Value).name) ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 5 && !GENERIC_WORDS.has(word));

function medsBlock(infos: Information[], toItem: (info: Information, group: Information[]) => MedRow): ProfileBlock<MedRow> {
  const groups: Information[][] = [];
  for (const info of infos) {
    const words = medWords(info);
    const group = groups.find((g) => g.some((other) => medWords(other).some((word) => words.includes(word))));
    if (group) group.push(info);
    else groups.push([info]);
  }
  const shown = groups.map((g) => [...g].sort((a, b) => Number(!!b.bbox) - Number(!!a.bbox) || (str((b.value as Value).name) ?? "").length - (str((a.value as Value).name) ?? "").length)[0]);
  return { ...block(infos, toItem), items: shown.map((info, i) => toItem(info, groups[i])) };
}

// Stejná položka víckrát (stejný text z víc dokumentů) jen jednou, ale se všemi výskyty pro potvrzení.
function uniqueBlock(infos: Information[], key: (info: Information) => string, toItem: (info: Information, group: Information[]) => ProfileItem): ProfileBlock<ProfileItem> {
  const groups = new Map<string, Information[]>();
  for (const info of infos) groups.set(key(info), [...(groups.get(key(info)) ?? []), info]);
  return { ...block(infos, toItem), items: [...groups.values()].map((group) => toItem(group[0], group)) };
}

// Údaje z dokumentu, který nepatří pacientovi (nebo to nejde ověřit), se nepoužijí. Stejně jako pravidlo Hb na serveru.
export function usableInformation(detail: CaseDetail) {
  const unusable = new Set(detail.documents.filter((d) => d.patientMatch === "mismatch" || d.patientMatch === "uncertain").map((d) => d.id));
  return detail.information.filter((info) => info.status !== "rejected" && !(info.documentId && unusable.has(info.documentId)));
}

export function caseProfile(detail: CaseDetail): CaseProfile {
  const infos = usableInformation(detail);
  const ofType = (...types: string[]) => infos.filter((info) => types.includes(info.type));

  const labs = ofType(...LAB_ORDER)
    .map((info): LabRow => {
      const value = info.value as LabValue;
      return {
        id: info.id,
        code: info.type,
        label: informationLabel(info),
        value: informationText(info),
        flag: value.flag ?? null,
        sampleDate: info.observedDate ? formatDate(info.observedDate) : null,
        documentId: info.documentId,
        check: info.checks ?? { status: "ok", reasons: [] },
        box: boxOf(info.bbox),
        verified: verification(info),
      };
    })
    .sort((a, b) => LAB_ORDER.indexOf(a.code) - LAB_ORDER.indexOf(b.code));

  const allergyInfos = ofType("allergy");
  const listed = allergyInfos.filter((info) => (info.value as Value).none !== true);
  const meds = ofType("medication").filter((info) => (info.value as Value).none !== true);
  const anamnesis = ofType("condition", "anesthesia_complication", "oncology_treatment").filter((info) => (info.value as Value).none !== true);

  const item = (info: Information, group: Information[] = [info]): ProfileItem => ({
    id: info.id,
    ids: group.map((member) => member.id),
    text: informationText(info),
    documentId: info.documentId,
    box: boxOf(info.bbox),
    verified: verifiedAll(group),
  });
  const denied = allergyInfos.filter((info) => (info.value as Value).none === true);
  const allergiesNone = allergyInfos.length > 0 && listed.length === 0;
  return {
    diagnosis: detail.case.diagnosis?.text ?? detail.case.procedureName ?? "",
    labs,
    allergies: block(allergyInfos, item),
    allergiesNone,
    allergiesNoneItem: allergiesNone && denied.length > 0 ? item(denied[0], denied) : null,
    meds: medsBlock(meds, (info, group) => {
      const value = info.value as Value;
      return { ...item(info, group), name: str(value.name) ?? "Lék", dose: [str(value.strength), str(value.dose)].filter(Boolean).join(" ") || null };
    }),
    anamnesis: uniqueBlock(anamnesis, (info) => informationText(info).toLowerCase(), item),
  };
}

// ---------------------------------------------------------------------------
// Dokumenty: originály a co v nich AI přečetla
// ---------------------------------------------------------------------------

export type DocMark = { id: string; label: string; value: string; box: Box | null };

export type DocView = {
  id: string;
  type: string;
  typeLabel: string;
  date: string | null;
  page: string | null;
  status: CaseDocument["status"];
  mimeType: string;
  /** patří pacientovi (shoda RČ a jména); bez kontroly zatím počítáme, že ano */
  identityOk: boolean;
  identityNote: string | null;
  identityChecked: boolean;
  issues: { label: string; detail: string; important: boolean }[];
  marks: DocMark[];
  error: string | null;
};

export function caseDocuments(detail: CaseDetail): DocView[] {
  const marksByDoc = new Map<string, DocMark[]>();
  for (const info of detail.information) {
    if (!info.documentId || info.status === "rejected") continue;
    const list = marksByDoc.get(info.documentId) ?? [];
    list.push({ id: info.id, label: informationLabel(info), value: informationText(info), box: boxOf(info.bbox) });
    marksByDoc.set(info.documentId, list);
  }
  return detail.documents.map((doc) => {
    const marks = marksByDoc.get(doc.id) ?? [];
    const observed = detail.information.find((info) => info.documentId === doc.id && info.observedDate)?.observedDate;
    const date = doc.issuedDate ?? observed ?? null;
    const unread = doc.status === "uploaded" || doc.status === "processing";
    return {
      id: doc.id,
      type: doc.type ?? (unread ? "unread" : "other"),
      typeLabel: doc.type ? documentTypeLabel(doc.type) : doc.status === "failed" ? "Nepřečtený dokument" : unread ? "Čeká na přečtení" : "Dokument",
      date: date ? formatDate(date) : null,
      page: doc.pageLabel,
      status: doc.status,
      mimeType: doc.mimeType,
      identityOk: doc.patientMatch === "match" || doc.patientMatch === "pending",
      identityNote: doc.patientMatchNote,
      identityChecked: doc.patientMatch !== "pending",
      issues: ((doc.issues ?? []) as { code?: string; detail?: string }[])
        .filter((issue) => issue.code && issue.code !== "redacted")
        .map((issue) => ({ label: ISSUE_LABEL[issue.code!] ?? issue.code!, detail: issue.detail ?? "", important: IMPORTANT_ISSUES.has(issue.code!) })),
      marks,
      error: doc.error,
    };
  });
}

// Stránky stejné zprávy (typ + datum) patří k sobě. `id` = první stránka, podle ní má zpráva svou stránku
// v ambulanci (/staff/[caseId]/documents/[documentId]), ale otevře se z kterékoli její stránky.
export type DocGroup = { id: string; typeLabel: string; date: string | null; pages: DocView[] };

export function documentGroups(detail: CaseDetail): DocGroup[] {
  const groups = new Map<string, DocGroup>();
  for (const doc of caseDocuments(detail)) {
    const key = `${doc.typeLabel}|${doc.date ?? doc.id}`;
    const found = groups.get(key);
    if (found) found.pages.push(doc);
    else groups.set(key, { id: doc.id, typeLabel: doc.typeLabel, date: doc.date, pages: [doc] });
  }
  return [...groups.values()];
}

export const pagesLabel = (count: number) => (count === 1 ? "1 strana" : count < 5 ? `${count} strany` : `${count} stran`);

// ---------------------------------------------------------------------------
// Úkoly: kontrolní seznam, výsledky krve kvůli Hb (PBM) a konzilia
// ---------------------------------------------------------------------------

const ACTIVE: Task["status"][] = ["open", "submitted", "snoozed"];
export const isActive = (task: Task) => ACTIVE.includes(task.status);

const payloadOf = (task: Task) => (task.payload ?? {}) as { tests?: unknown; note?: unknown; consult?: unknown };

// Vyžádané konzilium je úkol pro AA s payload.consult (klíč z lib/casy-pripravy.json).
export const consultOf = (task: Task) => (typeof payloadOf(task).consult === "string" ? (payloadOf(task).consult as string) : null);
export const testsOf = (task: Task) => (Array.isArray(payloadOf(task).tests) ? (payloadOf(task).tests as string[]) : []);
// Co ambulance u vyžádaného dokumentu doplnila (testy, poznámka pro pacienta), jak to vidí ambulance.
export const requestDetail = (task: Task) => [testsOf(task).join(", "), typeof payloadOf(task).note === "string" ? payloadOf(task).note : ""].filter(Boolean).join(" · ");

// Výsledky krve vyžádané kvůli Hb, dokud nejsou přečtené. Dřív to byla akce pro pacienta, teď nahrání dokumentu.
export const pbmTask = (tasks: Task[]) => tasks.find((task) => task.process === "pbm" && isActive(task)) ?? null;

// Kontrolní seznam: úkoly ze šablony a ty, které AA přidala. Výsledky krve kvůli Hb a konzilia mají vlastní místo.
export const checklistTasks = (tasks: Task[]) => tasks.filter((task) => task.process !== "pbm" && consultOf(task) === null);

// Krok časové osy (lib/casy-pripravy.json) podle toho, jaký dokument úkol chce.
const STEP_BY_DOCUMENT: Record<string, string> = {
  preop_exam: "predop",
  lab_report: "lab",
  ecg: "ekg",
  imaging_report: "rtg",
  medication_list: "leky",
};
export const stepOf = (task: Task) => (task.documentType ? (STEP_BY_DOCUMENT[task.documentType] ?? null) : task.informationType === "hemoglobin" ? "lab" : null);

export function readinessInput(daysToCase: number | null, tasks: Task[], anemia: boolean): ReadinessInput {
  const steps = new Map<string, Task[]>();
  for (const task of checklistTasks(tasks)) {
    const step = stepOf(task);
    if (step) steps.set(step, [...(steps.get(step) ?? []), task]);
  }
  const items: ReadinessInput["items"] = [];
  const requested: string[] = [];
  const waived: string[] = [];
  for (const [step, own] of steps) {
    const live = own.filter((task) => task.status !== "cancelled");
    if (live.length === 0) {
      waived.push(step);
      continue;
    }
    const done = live.every((task) => task.status === "done" || task.status === "submitted");
    items.push({ id: step, state: done ? "done" : "missing" });
    // úkol pro pacienta už je vyžádaný (běží), úkol pro AA musí někdo spustit
    if (!done && live.some((task) => task.assignee === "patient")) requested.push(step);
  }
  if (pbmTask(tasks)) requested.push("lab"); // výsledky krve už jsou vyžádané
  return {
    daysToCase,
    items,
    requested,
    waived,
    consults: tasks.filter(isActive).map(consultOf).filter((id): id is string => id !== null),
    anemia,
    ironStarted: false,
  };
}

// Úkol, přes který se nahrává daný druh souboru (podpis, fotka…), ať se nahráním rovnou splní.
export const uploadTaskFor = (tasks: Task[], documentType: string) =>
  tasks.find((task) => task.kind === "upload" && task.documentType === documentType && task.status !== "cancelled" && task.status !== "done")?.id;
