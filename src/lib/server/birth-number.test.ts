import { describe, expect, test } from "vitest";
import { maskBirthNumber, parseBirthNumber } from "@/lib/server/birth-number";

describe("rodné číslo", () => {
  test("desetimístné mužské číslo dá datum narození a pohlaví", () => {
    expect(parseBirthNumber("600301/0002")).toEqual({ digits: "6003010002", birthDate: "1960-03-01", sex: "M" });
  });

  test("ženské číslo má k měsíci připočteno 50", () => {
    expect(parseBirthNumber("6053010007")).toEqual({ digits: "6053010007", birthDate: "1960-03-01", sex: "F" });
  });

  test("od roku 2004 může mít měsíc připočteno 20", () => {
    expect(parseBirthNumber("052715/0008")?.birthDate).toBe("2005-07-15");
  });

  test("devítimístné číslo platí jen pro narozené před rokem 1954", () => {
    expect(parseBirthNumber("500505123")?.birthDate).toBe("1950-05-05");
    expect(parseBirthNumber("600301123")).toBeNull();
  });

  test("odmítne číslo, které není dělitelné jedenácti", () => {
    expect(parseBirthNumber("6003011235")).toBeNull();
  });

  test("odmítne neexistující datum", () => {
    expect(parseBirthNumber("600231/0002")).toBeNull();
  });

  test("odmítne jiné znaky než číslice a lomítko", () => {
    expect(parseBirthNumber("60030a0002")).toBeNull();
  });

  test("maskuje koncovku", () => {
    expect(maskBirthNumber("6003010002")).toBe("600301/****");
  });
});
