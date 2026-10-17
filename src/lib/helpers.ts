// Pomocník z rodiny: vztahy a popisky. Sdílí server (ověření vstupu) i klient (formulář, výpisy pro ambulanci).

export const HELPER_RELATIONS = ["daughter", "son", "partner", "other"] as const;
export type HelperRelation = (typeof HELPER_RELATIONS)[number];

// label = volba ve formuláři pacienta, short = za jménem v přehledu („Petra, dcera“).
export const RELATION_LABELS: Record<HelperRelation, { label: string; short: string }> = {
  daughter: { label: "Dcera", short: "dcera" },
  son: { label: "Syn", short: "syn" },
  partner: { label: "Partner nebo partnerka", short: "partner/ka" },
  other: { label: "Někdo jiný", short: "blízký člověk" },
};

export const relationLabel = (relation: string | null | undefined) =>
  relation && relation in RELATION_LABELS ? RELATION_LABELS[relation as HelperRelation].short : "pomocník";

// Pozvánka platí 14 dní. Pak pacient pošle novou.
export const INVITE_DAYS = 14;

// Kdo dokument nahrál, jak to vidí ambulance: u pomocníka „Nahrál(a) Petra (dcera) za pacienta“, jinak nic.
export function helperUploadNote(people: Record<string, { displayName: string; role: string; relation?: string | null }>, uploadedBy: string | null | undefined) {
  const person = uploadedBy ? people[uploadedBy] : undefined;
  if (person?.role !== "helper") return null;
  return `Nahrál(a) ${person.displayName} (${relationLabel(person.relation)}) za pacienta`;
}
