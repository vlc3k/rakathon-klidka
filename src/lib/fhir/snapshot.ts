// Kopie dat pacienta z nemocničního systému (FHIR) v jednom okamžiku. Patří k jedné operaci (případu):
// nové stažení přidá další kopii, nic nepřepisuje, ani u jiných operací stejného pacienta.
// Jen typy, smí je importovat klient i server.
import type { IdentityResult } from "@/lib/identity";

export type HospitalGroup = "allergy" | "diagnosis" | "medication" | "lab" | "vital" | "other";

export type HospitalItem = {
  id: string;
  group: HospitalGroup;
  /** náš klíč (hemoglobin, weight…) nebo kód z FHIR, podle něj se hledá nejnovější hodnota */
  key: string;
  label: string;
  value: string;
  /** ISO datum (odběr, záznam) */
  date: string | null;
  /** potřebné pro předoperační vyšetření; zbytek je vidět jen přes „Zobrazit vše“ */
  relevant: boolean;
  flag?: "L" | "H";
  /** údaj, který do FHIR zapsala naše aplikace (ne nemocnice) */
  fromApp?: boolean;
};

export type HospitalSnapshot = {
  id: string;
  caseId: string;
  /** ISO čas stažení */
  fetchedAt: string;
  by: string;
  server: string;
  patient: { fhirId: string; name: string; birthNumber?: string };
  /** sedí pacient v nemocnici s pacientem v systému (u starších kopií chybí) */
  identity?: { result: IdentityResult; reason: string };
  /** odkud data přišla: kdo odpověděl (CapabilityStatement serveru) a kolik záznamů vrátil */
  source?: { software: string; fhirVersion: string; patientRef: string; resources: number; ms: number };
  items: HospitalItem[];
  /** co se před stažením odeslalo do nemocnice (ověřené údaje z dokumentů): nově zapsané / od nás už dřív /
   *  nemocnice už vedla sama (neposláno) / chyba */
  sent?: { created: number; existing: number; known?: number; failed: number };
};
