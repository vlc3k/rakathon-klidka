import { test } from "node:test";
import assert from "node:assert/strict";
import { checkValue, type ReadValue } from "@/lib/reading/validate";

const ctx = { today: new Date("2026-10-17"), documentDate: "2026-09-25" };
const v = (o: Partial<ReadValue>): ReadValue => ({ code: "hb", value: 135, unit: "g/l", ref_low: 120, ref_high: 160, sample_date: "2026-09-24", flag: null, confidence: "high", ...o });

test("správná hodnota projde", () => assert.equal(checkValue(v({}), ctx).status, "ok"));
test("Hb ve volném textu bez jednotky a mezí projde (case-04)", () => assert.equal(checkValue(v({ value: 83, unit: null, ref_low: null, ref_high: null, sample_date: null, confidence: "medium" }), ctx).status, "ok"));
test("Hb 13,5 bez jednotky vypadá jako g/dl", () => assert.match(checkValue(v({ value: 13.5, unit: null }), ctx).reasons.join(), /g\/dl/));
test("posunutý řádek: Hb s mezemi hematokritu", () => assert.match(checkValue(v({ value: 0.44, ref_low: 0.4, ref_high: 0.5 }), ctx).reasons.join(), /posunutý řádek/));
test("trombocyty s mezemi leukocytů", () => assert.equal(checkValue(v({ code: "plt", value: 8.6, unit: "10^9/l", ref_low: 4, ref_high: 10 }), ctx).status, "uncertain"));
test("prohozené meze", () => assert.match(checkValue(v({ ref_low: 160, ref_high: 120 }), ctx).reasons.join(), /prohozené/));
test("značka L u hodnoty v normě", () => assert.match(checkValue(v({ flag: "L" }), ctx).reasons.join(), /značka L/));
test("odběr v budoucnosti", () => assert.match(checkValue(v({ sample_date: "2026-12-01" }), ctx).reasons.join(), /budoucnosti/));
test("nízká jistota čtení", () => assert.equal(checkValue(v({ confidence: "low" }), ctx).status, "uncertain"));
test("jednotka s horním indexem 10⁹/l projde", () => assert.equal(checkValue(v({ code: "plt", value: 255, unit: "10⁹/l", ref_low: 150, ref_high: 400 }), ctx).status, "ok"));
