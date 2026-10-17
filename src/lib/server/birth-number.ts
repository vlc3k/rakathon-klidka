// Rodné číslo: kontrola, datum narození a pohlaví. RČ se ukládá jen jako číslice, ven jde maskované.

export type BirthNumber = { digits: string; birthDate: string; sex: "M" | "F" };

const pad = (n: number) => String(n).padStart(2, "0");

export function parseBirthNumber(input: string): BirthNumber | null {
  const digits = input.replace(/[\s/]/g, "");
  if (!/^\d{9,10}$/.test(digits)) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));

  let year: number;
  if (digits.length === 9) {
    // Devítimístná čísla se přidělovala do roku 1953.
    if (yy > 53) return null;
    year = 1900 + yy;
  } else {
    year = yy < 54 ? 2000 + yy : 1900 + yy;
    // Dělitelné 11; do roku 1985 i zbytek 10 s poslední číslicí 0. Deset číslic se do Number vejde přesně.
    const whole = Number(digits) % 11 === 0;
    const legacy = Number(digits.slice(0, 9)) % 11 === 10 && digits[9] === "0";
    if (!whole && !legacy) return null;
  }

  // Ženy mají k měsíci +50, od roku 2004 může být i +20 (muži) a +70 (ženy).
  let month = mm;
  let sex: BirthNumber["sex"] = "M";
  if (month > 70 && year >= 2004) {
    month -= 70;
    sex = "F";
  } else if (month > 50) {
    month -= 50;
    sex = "F";
  } else if (month > 20 && year >= 2004) {
    month -= 20;
  }
  if (month < 1 || month > 12) return null;

  const date = new Date(Date.UTC(year, month - 1, dd));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dd) return null;
  return { digits, birthDate: `${year}-${pad(month)}-${pad(dd)}`, sex };
}

export const maskBirthNumber = (digits: string) => `${digits.slice(0, 6)}/****`;
