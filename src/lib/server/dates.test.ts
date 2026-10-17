import { afterEach, describe, expect, test, vi } from "vitest";
import { ageOn, daysBetween, subtractDays, todayInPrague } from "@/lib/server/dates";

afterEach(() => {
  vi.useRealTimers();
});

describe("data", () => {
  test("dnešek se počítá v pražském čase, ne v UTC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T22:30:00Z")); // v Praze už 17. 10. 0:30

    expect(todayInPrague()).toBe("2026-10-17");
  });

  test("počet dní mezi dvěma daty", () => {
    expect(daysBetween("2026-10-17", "2026-11-13")).toBe(27);
    expect(daysBetween("2026-10-17", "2026-10-10")).toBe(-7);
  });

  test("počet dní nezávisí na přechodu na zimní čas", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  test("věk k danému dni", () => {
    expect(ageOn("1960-03-01", "2026-02-28")).toBe(65);
    expect(ageOn("1960-03-01", "2026-03-01")).toBe(66);
  });

  test("odečtení dní od data", () => {
    expect(subtractDays("2026-11-13", 14)).toBe("2026-10-30");
  });
});
