import { DOCUMENT_TYPES, type DocumentType } from "@/db/catalog";

// Vyžádání dokumentu od pacienta: obyčejný úkol na nahrání. Nic se neodesílá a žádanku nevystavujeme,
// pacient úkol uvidí v portálu, vyšetření si zařídí u svého lékaře a výsledek nahraje.

// Co lze od pacienta vyžádat (lékařské zprávy a jiný dokument). Fotku, podpis a hlasovku si pacient pošle sám.
export const REQUESTABLE: DocumentType[] = ["lab_report", "preop_exam", "ecg", "imaging_report", "specialist_report", "medication_list", "discharge_report", "outpatient_report", "anesthesia_record", "other"];

// Rychlé volby u výsledků krve. Co v nich má být, vybírá anesteziolog.
export const LAB_TESTS = ["krevní obraz", "ferritin", "saturace transferinu", "CRP", "koagulace (aPTT, Quick)", "kreatinin", "glykémie"];

export type DocumentRequest = {
  type: DocumentType;
  /** název u jiného dokumentu */
  name?: string;
  /** co má být ve výsledcích krve (rychlé volby) */
  tests?: string[];
  /** co ještě má být ve výsledcích krve, vlastními slovy */
  extra?: string;
  /** poznámka pro pacienta */
  note?: string;
  /** vyžádáno kvůli hemoglobinu: úkol patří do PBM a splní ho i přečtený Hb */
  pbm?: boolean;
};

// Tělo POST /tasks. Detail pro pacienta (co má dokument obsahovat) je v instructions, pro ambulanci zvlášť v payload.
export function documentRequestTask({ type, name, tests = [], extra = "", note = "", pbm = false }: DocumentRequest) {
  const lab = type === "lab_report";
  const wanted = lab ? [...tests, extra.trim()].filter(Boolean) : [];
  const remark = note.trim();
  const detail = [wanted.length ? `Co v nich má být: ${wanted.join(", ")}. Ukažte to svému praktickému lékaři.` : "", remark].filter(Boolean).join(" ");
  return {
    assignee: "patient" as const,
    kind: "upload" as const,
    title: (type === "other" && name?.trim()) || DOCUMENT_TYPES[type].name,
    documentType: type,
    ...(lab && pbm ? { informationType: "hemoglobin" as const, process: "pbm" as const } : {}),
    instructions: detail || DOCUMENT_TYPES[type].patientHint || null,
    payload: { ...(wanted.length ? { tests: wanted } : {}), ...(remark ? { note: remark } : {}) },
  };
}
