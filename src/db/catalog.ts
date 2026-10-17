// Katalog: typy informací, typy dokumentů a prahy pravidel.
// Je v kódu, protože na něm stojí pravidla (PBM čte 'hemoglobin'), schéma výstupu AI
// a FHIR export. Šablony a úkoly, které si lékaři skládají, jsou v databázi
// a na tyhle typy jen odkazují.
//
// Prahy PBM (120 g/l, 14 dní, 500 ml) jsou ze zadání v4.2.

export const RULES = {
  version: "2026-10-16.3",            // ukládá se do tasks.evidence
  pbm: {                              // Patient Blood Management: péče o anémii před operací
    hbThresholdGl: 120,
    hbValidForDays: 14,
    bloodLossThresholdMl: 500,
    oralWindowWeeks: 6,               // okno léčby v UI, jen informace, nastavitelné pro VFN
  },
  queue: { noResponseDays: 3 },       // pacient nereaguje → připomínka, pak úkol zavolat
} as const;

// Oblasti profilu = řádky semaforu (minimální klinický rámec, v4.2 kap. 4)
export const AREAS = {
  identification:   { name: "Identifikace a výkon",    patient: "Vaše údaje a zákrok" },
  current_health:   { name: "Aktuální zdravotní stav", patient: "Jak se teď cítíte" },
  history:          { name: "Významná anamnéza",       patient: "Vaše nemoci" },
  medication:       { name: "Medikace",                patient: "Léky" },
  allergy:          { name: "Alergie",                 patient: "Alergie" },
  prior_anesthesia: { name: "Předchozí anestezie",     patient: "Předchozí narkózy" },
  functional:       { name: "Funkční stav",            patient: "Fyzická kondice" },
  labs:             { name: "Laboratoř",               patient: "Krevní testy" },
  documents:        { name: "Dokumentace",             patient: "Dokumenty" },
  oncology:         { name: "Onkologická specifika",   patient: "Onkologická léčba" },
  airway:           { name: "Dýchací cesty",           patient: "Fotky úst" },
} as const;

// Jak členit informace:
// - jeden řádek = jedna věc, která jde samostatně ověřit a má vlastní datum
//   (jeden výsledek, jeden lék, jedna alergie)
// - vlastní typ, když s ním pracuje pravidlo, úkol nebo otázka (hemoglobin, hmotnost)
// - společný typ s názvem uvnitř hodnoty, když ho jen čte lékař (lab_other, condition)
// - "nemám žádné" je taky informace: {"none": true}, jinak nejde poznat "nevíme" od "nic"
// Tvar hodnoty hlídá zod v db/values.ts.
type InformationType = {
  name: string;
  area: keyof typeof AREAS;
  example: Record<string, unknown>;   // tvar information.value
  list?: true;                        // víc řádků najednou (léky, alergie); jinak platí poslední
  validForDays?: number;              // jak dlouho od odběru výsledek platí
  loinc?: string;                     // pro FHIR export
  question?: string;                  // jak se zeptat pacienta (úkol typu question)
  answerRange?: [number, number];     // rozumné meze číselné odpovědi
};

// Laboratorní výsledek: meze jako čísla, aby šly kontrolovat (lib/reading/validate.ts); flag L/H z laboratoře.
const lab = (name: string, unit: string, loinc: string, validForDays?: number): InformationType =>
  ({ name, area: "labs", example: { value: 0, unit, refLow: 0, refHigh: 0, flag: null }, loinc, ...(validForDays ? { validForDays } : {}) });

// Typy informací = information.type
export const INFORMATION_TYPES = {
  diagnosis:               { name: "Diagnóza, kvůli které je zákrok", area: "identification",
                             example: { text: "Karcinom rekta", icd10: "C20" } },
  condition:               { name: "Další onemocnění", area: "history", list: true,
                             example: { text: "Diabetes 2. typu", icd10: "E11" } },
  known_anemia:            { name: "Chudokrevnost v minulosti", area: "history",
                             example: { value: true }, question: "Řekl vám někdy lékař, že máte chudokrevnost?" },
  hemoglobin:              lab("Hemoglobin", "g/l", "718-7", 14),
  ferritin:                lab("Ferritin", "µg/l", "2276-4"),
  transferrin_saturation:  lab("Saturace transferinu", "%", "2502-3"),
  crp:                     lab("CRP", "mg/l", "1988-5"),
  platelets:               lab("Trombocyty", "10^9/l", "777-3"),
  leukocytes:              lab("Leukocyty", "10^9/l", "6690-2"),
  creatinine:              lab("Kreatinin", "µmol/l", "14682-9"),
  lab_other:               { name: "Jiný laboratorní výsledek", area: "labs", list: true,
                             example: { name: "ALT", value: 0.6, unit: "µkat/l", refLow: 0.1, refHigh: 0.8 } },
  weight:                  { name: "Hmotnost", area: "identification", loinc: "29463-7",
                             example: { value: 82, unit: "kg" }, question: "Kolik vážíte?", answerRange: [25, 300] },
  height:                  { name: "Výška", area: "identification", loinc: "8302-2",
                             example: { value: 178, unit: "cm" }, question: "Jak jste vysoký/á?", answerRange: [100, 230] },
  medication:              { name: "Lék", area: "medication", list: true,
                             example: { name: "Concor", strength: "5 mg", dose: "1-0-0", reason: "tlak" } },
  allergy:                 { name: "Alergie / nežádoucí reakce", area: "allergy", list: true,
                             example: { substance: "Penicilin", reaction: "vyrážka" },
                             question: "Máte nějakou alergii nebo jste špatně snášel/a nějaký lék?" },
  anesthesia_complication: { name: "Komplikace předchozí narkózy", area: "prior_anesthesia", list: true,
                             example: { text: "zvracení po narkóze", year: 2019 } },
  functional_capacity:     { name: "Fyzická zdatnost", area: "functional",
                             example: { value: true }, question: "Vyjdete dvě patra schodů bez zastavení?" },
  oncology_treatment:      { name: "Onkologická léčba", area: "oncology", list: true,
                             example: { kind: "chemotherapy", lastDate: "2026-09-01" } },
  symptom:                 { name: "Aktuální obtíž", area: "current_health", list: true,
                             example: { text: "dušnost při chůzi" } },
  note:                    { name: "Poznámka", area: "current_health", list: true,
                             example: { text: "" } },
  // Hodnocení z fotek dýchacích cest. Zadává jen anesteziolog, aplikace nic neodhaduje.
  // mallampati null = z fotky nejde hodnotit.
  airway_assessment:       { name: "Hodnocení dýchacích cest", area: "airway",
                             example: { mallampati: 2, findings: ["dentition"], note: "" } },
} as const satisfies Record<string, InformationType>;

export type InformationTypeCode = keyof typeof INFORMATION_TYPES;

// Typy dokumentů = documents.type a tasks.document_type.
export const DOCUMENT_TYPES = {
  lab_report:        { name: "Laboratorní výsledky",   patientHint: "Výsledky krevních testů od vašeho lékaře nebo z laboratoře." },
  preop_exam:        { name: "Předoperační vyšetření", patientHint: "Zpráva od praktického lékaře nebo internisty před operací." },
  outpatient_report: { name: "Ambulantní zpráva",      patientHint: "Zpráva z ambulance, kde se léčíte." },
  specialist_report: { name: "Odborná zpráva",         patientHint: "Zpráva od specialisty (kardiolog, neurolog, plicní…)." },
  imaging_report:    { name: "Zobrazovací vyšetření",  patientHint: "Zpráva z ultrazvuku, rentgenu, CT nebo magnetické rezonance." },
  ecg:               { name: "EKG",                    patientHint: "Záznam EKG nebo zpráva, kde je popsané." },
  anesthesia_record: { name: "Předchozí anesteziologický záznam", patientHint: "Záznam z předchozí narkózy, pokud ho máte." },
  medication_list:   { name: "Seznam léků",            patientHint: "Seznam léků, které berete. Stačí vyfotit krabičky." },
  discharge_report:  { name: "Propouštěcí zpráva",     patientHint: "Zpráva z nemocnice po hospitalizaci." },
  other:             { name: "Jiný dokument",          patientHint: "" },
  portrait:          { name: "Fotka pacienta",         patientHint: "Abychom vás při příjmu bezpečně poznali." },
  airway_photo:      { name: "Fotka úst",              patientHint: "Fotka pro anesteziologa, kamera vás navede." },
  consent_signature: { name: "Podpis souhlasu",        patientHint: "" },
  voice_message:     { name: "Hlasová zpráva",         patientHint: "Dotaz, změna léků, cokoli. Do 2 minut." },
} as const satisfies Record<string, { name: string; patientHint: string }>;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

// Typy, které určí klient při nahrání (fotka, podpis, hlasovka). AI je nečte, ostatní typy rozpozná AI.
export const CLIENT_DOCUMENT_TYPES = ["portrait", "airway_photo", "consent_signature", "voice_message"] as const satisfies readonly DocumentType[];
export type ClientDocumentType = (typeof CLIENT_DOCUMENT_TYPES)[number];
export const isClientDocumentType = (type: string | null): type is ClientDocumentType => CLIENT_DOCUMENT_TYPES.includes(type as ClientDocumentType);

// Nálezy z fotek dýchacích cest (airway_assessment.findings). Popisky pro UI a tisk.
export const AIRWAY_FINDINGS = {
  limited_mouth_opening:  "Omezené otevření úst",
  dentition:              "Volné nebo chybějící zuby, náhrada",
  prominent_incisors:     "Předsunuté horní řezáky",
  receding_chin:          "Ustupující brada",
  limited_neck_extension: "Omezený záklon hlavy",
  beard:                  "Vousy (ztěžují ventilaci maskou)",
} as const;
export type AirwayFinding = keyof typeof AIRWAY_FINDINGS;
