import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLevel, activityWeeks, categoryOf } from "@/lib/activity";

test("kalendář aktivity: týdny od pondělí do neděle, přes přechod na zimní čas bez posunu", () => {
  const weeks = activityWeeks("2026-10-19", "2026-11-01");
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks[0], ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.equal(weeks[1].at(-1), "2026-11-01");
});

test("kalendář aktivity: síla barvy po čtvrtinách nejaktivnějšího dne", () => {
  assert.equal(activityLevel(0, 8), 0);
  assert.equal(activityLevel(1, 8), 1);
  assert.equal(activityLevel(2, 8), 1);
  assert.equal(activityLevel(3, 8), 2);
  assert.equal(activityLevel(8, 8), 4);
  assert.equal(activityLevel(3, 0), 0);
});

test("kalendář aktivity: druhy událostí", () => {
  assert.equal(categoryOf("document.uploaded"), "upload");
  assert.equal(categoryOf("document.seen"), "view");
  assert.equal(categoryOf("task.read"), "view");
  assert.equal(categoryOf("document.read_failed"), "ai");
  assert.equal(categoryOf("document.transcribed"), "ai");
  assert.equal(categoryOf("information.verified"), "data");
  assert.equal(categoryOf("task.done"), "task");
  assert.equal(categoryOf("case.created"), "other");
  assert.equal(categoryOf("document.removed"), "other");
});
