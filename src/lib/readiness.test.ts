import { test } from "node:test";
import assert from "node:assert/strict";
import { readiness, type ReadinessInput } from "@/lib/readiness";

const base: ReadinessInput = { daysToCase: 27, items: [{ id: "predop", state: "done" }, { id: "lab", state: "missing" }, { id: "dotaznik", state: "missing" }], requested: [], waived: [], consults: [], anemia: false, ironStarted: false };

test("bez termínu nic nepočítá", () => assert.equal(readiness({ ...base, daysToCase: null }).status, "unknown"));
test("běžná příprava se za 27 dní stihne", () => assert.equal(readiness(base).status, "ok"));
test("kardiolog (8 až 12 týdnů) za 27 dní nestihne", () => assert.equal(readiness({ ...base, consults: ["kardiolog"] }).status, "late"));
test("echo (4 až 6 týdnů) za 35 dní hrozí odklad", () => assert.equal(readiness({ ...base, daysToCase: 35, consults: ["echo"] }).status, "risk"));
test("Hb s platností 14 dní se nemá brát dřív než 14 dní před zákrokem", () => {
  const lab = readiness({ ...base, daysToCase: 40 }).steps.find((s) => s.id === "lab")!;
  assert.equal(lab.start, 26);
});
test("anémie 10 dní před zákrokem: na nitrožilní železo pozdě", () => assert.ok(["risk", "late"].includes(readiness({ ...base, daysToCase: 10, anemia: true }).status)));
test("anémie 27 dní před zákrokem: železo se stihne, perorální už ne", () => {
  const r = readiness({ ...base, anemia: true });
  assert.equal(r.iron?.oral, false);
  assert.notEqual(r.status, "late");
});
test("odběr 27 dní předem do co spustit nepatří", () => assert.ok(!readiness(base).startToday.some((s) => s.id === "lab")));
test("odběr 12 dní předem do co spustit patří", () => assert.ok(readiness({ ...base, daysToCase: 12 }).startToday.some((s) => s.id === "lab")));
test("prominutý krok se nepočítá", () => assert.ok(!readiness({ ...base, waived: ["lab"] }).steps.some((s) => s.id === "lab")));
test("při anémii se krev bere hned, ne až před zákrokem", () => {
  const lab = readiness({ ...base, daysToCase: 40, anemia: true }).steps.find((s) => s.id === "lab")!;
  assert.equal(lab.start, 0);
});
test("case-04: anémie 27 dní předem je na hraně (lepší případ stihne, horší ne)", () => {
  const r = readiness({ ...base, anemia: true });
  const iron = r.steps.find((s) => s.id === "zelezo")!;
  assert.ok(iron.end[0] <= r.iron!.ivDeadline);
  assert.equal(r.status, "risk");
});
