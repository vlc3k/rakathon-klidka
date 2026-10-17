import { test } from "node:test";
import assert from "node:assert/strict";
import { sameMedication } from "./medicationMatch";

test("stejný lék pod obchodním názvem i látkou", () => {
  assert.ok(sameMedication("Paralen 500 mg (paracetamol)", "Paralen paracetamol"));
  assert.ok(sameMedication("Paralen 500 mg (paracetamol)", "Paracetamol"));
  assert.ok(sameMedication("Clexane 4000 IU/0,4 ml (enoxaparin)", "Clexane enoxaparin sodná sůl"));
  assert.ok(sameMedication("Tenoretic 50 mg/12,5 mg (atenolol, chlortalidon)", "Tenoretic"));
});

test("různé léky se nespojí, ani přes obecná slova", () => {
  assert.ok(!sameMedication("Godasal 100 mg (kyselina acetylsalicylová)", "Kyselina listová"));
  assert.ok(!sameMedication("Ferrum Lek 100 mg (železo)", "Tenoretic"));
  assert.ok(!sameMedication("Ventolin inhalátor (salbutamol)", "Seretide inhalátor"));
});
