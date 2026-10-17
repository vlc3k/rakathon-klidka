// Patří dokument (nebo záznam z nemocnice) tomuto pacientovi? Jedno pravidlo pro frontu, nahrávání i FHIR.
// Klíč je rodné číslo. Jméno jen potvrzuje: bez ohledu na diakritiku, velikost písmen, pořadí a tituly.
// Bez importů z Node, používá ho i klient.

export type IdentityResult = "match" | "match_warn" | "uncertain" | "mismatch";

export type Identity = { name: string | null | undefined; birthNumber: string | null | undefined };

export const IDENTITY_LABEL: Record<IdentityResult, string> = {
  match: "Patří pacientovi",
  match_warn: "Patří, s upozorněním",
  uncertain: "Nejisté, ověří člověk",
  mismatch: "Patří jinému člověku",
};

/** Číslice z RČ; začerněné nebo nečitelné znaky jako „?“. */
export function normRc(rc: string | null | undefined) {
  return (rc ?? "").replace(/[*xX_]/g, "?").replace(/[^0-9?]/g, "");
}

/** Formálně platné RČ: 9 číslic (narození před 1954) nebo 10 dělitelných 11, rozumný měsíc a den. */
export function isValidRc(rc: string | null | undefined) {
  const d = normRc(rc);
  if (!/^\d{9,10}$/.test(d)) return false;
  const yy = +d.slice(0, 2), mm = +d.slice(2, 4) % 50 % 20, dd = +d.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  if (d.length === 9) return yy < 54;
  const mod = +d.slice(0, 9) % 11;
  return +d[9] === (mod === 10 ? 0 : mod);
}

/** Pohlaví a datum narození z platného RČ. */
export function rcInfo(rc: string | null | undefined): { sex: "male" | "female"; birthDate: string } | null {
  if (!isValidRc(rc)) return null;
  const d = normRc(rc);
  const yy = +d.slice(0, 2), m = +d.slice(2, 4), dd = d.slice(4, 6);
  const year = d.length === 9 ? 1900 + yy : yy < 54 ? 2000 + yy : 1900 + yy;
  const month = m % 50 % 20;
  return { sex: m > 50 ? "female" : "male", birthDate: `${year}-${String(month).padStart(2, "0")}-${dd}` };
}

/** RČ ve tvaru 000000/0000. */
export function formatRc(rc: string | null | undefined) {
  const d = normRc(rc);
  return d.length >= 9 ? `${d.slice(0, 6)}/${d.slice(6)}` : (rc ?? "");
}

const TITLES = new Set(["mudr", "mddr", "ing", "bc", "mgr", "phdr", "judr", "rndr", "doc", "prof", "phd", "csc", "dis", "pan", "pani", "sl"]);

function nameTokens(name: string | null | undefined) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1 && !TITLES.has(t))
    .sort();
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** same = stejné jméno (i jiné pořadí, bez diakritiky), close = překlep v jednom písmenu, different = jiný člověk. */
export function compareNames(a: string | null | undefined, b: string | null | undefined): "same" | "close" | "different" | "unknown" {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.length || !y.length) return "unknown";
  if (x.join(" ") === y.join(" ")) return "same";
  if (x.length !== y.length) return "different";
  // každé slovo jednoho jména má protějšek nanejvýš o 1 písmeno jiný (a celkem nanejvýš 2 písmena)
  const used = new Set<number>();
  let total = 0;
  for (const t of x) {
    let best = -1, bestD = Infinity;
    y.forEach((u, i) => {
      if (used.has(i)) return;
      const dd = distance(t, u);
      if (dd < bestD) {
        best = i;
        bestD = dd;
      }
    });
    if (best < 0 || bestD > 1) return "different";
    used.add(best);
    total += bestD;
  }
  return total <= 2 ? "close" : "different";
}

/** Shoda RČ s ohledem na začerněné číslice. Vrací počet ověřených číslic, nebo -1 při rozporu. */
function rcAgreement(doc: string, patient: string) {
  if (doc.length !== patient.length) return -1;
  let known = 0;
  for (let i = 0; i < doc.length; i++) {
    if (doc[i] === "?") continue;
    if (doc[i] !== patient[i]) return -1;
    known++;
  }
  return known;
}

/** Liší se jen jednou číslicí nebo prohozením dvou sousedních (typický překlep při opisování). */
function oneTypo(a: string, b: string) {
  if (a.length !== b.length) return false;
  const diff = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
  if (diff.length === 1) return true;
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

export function matchIdentity(doc: Identity, patient: Identity): { result: IdentityResult; reason: string } {
  const docRc = normRc(doc.birthNumber), patRc = normRc(patient.birthNumber);
  const names = compareNames(doc.name, patient.name);
  const nameOk = names === "same" || names === "close";
  const nameNote = names === "close" ? " Jméno se liší v písmenu, zkontrolujte." : "";

  if (docRc && patRc) {
    const known = rcAgreement(docRc, patRc);
    if (known === docRc.length) {
      if (names === "different") return { result: "uncertain", reason: "Rodné číslo sedí, ale jméno je jiné." };
      return { result: names === "close" ? "match_warn" : "match", reason: `Sedí rodné číslo.${nameNote}` };
    }
    if (known >= 6) {
      if (nameOk) return { result: "match_warn", reason: `Rodné číslo je částečně nečitelné, viditelná část a jméno sedí.${nameNote}` };
      return { result: "uncertain", reason: "Rodné číslo je částečně nečitelné a jméno nesedí." };
    }
    if (known === -1 && nameOk && !isValidRc(docRc) && oneTypo(docRc, patRc)) {
      return { result: "uncertain", reason: `Rodné číslo na dokumentu (${formatRc(docRc)}) je neplatné a liší se o jednu číslici, nejspíš překlep.` };
    }
    if (known === -1) return { result: "mismatch", reason: `Na dokumentu je jiné rodné číslo (${formatRc(doc.birthNumber)}).` };
    return { result: "uncertain", reason: "Rodné číslo na dokumentu nejde přečíst." };
  }

  if (!docRc) {
    if (names === "unknown") return { result: "uncertain", reason: "Na dokumentu není jméno ani rodné číslo." };
    if (nameOk) return { result: "match_warn", reason: `Na dokumentu chybí rodné číslo, sedí jméno.${nameNote}` };
    return { result: "mismatch", reason: `Na dokumentu je jiné jméno (${doc.name}).` };
  }
  // pacient v systému nemá RČ
  if (nameOk) return { result: "match_warn", reason: `Pacient nemá v systému rodné číslo, sedí jméno.${nameNote}` };
  return { result: names === "unknown" ? "uncertain" : "mismatch", reason: names === "unknown" ? "Nejde ověřit." : `Na dokumentu je jiné jméno (${doc.name}).` };
}

/** Dokument se smí započítat pacientovi (údaje, PBM) jen při shodě. */
export const identityOk = (doc: Identity, patient: Identity) => {
  const r = matchIdentity(doc, patient).result;
  return r === "match" || r === "match_warn";
};
