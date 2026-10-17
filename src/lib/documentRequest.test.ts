import { test } from "node:test";
import assert from "node:assert/strict";
import { documentRequestTask } from "@/lib/documentRequest";

test("výsledky krve kvůli Hb: testy a poznámka jdou pacientovi, úkol patří do PBM", () =>
  assert.deepEqual(documentRequestTask({ type: "lab_report", tests: ["krevní obraz", "ferritin"], note: " Nalačno. ", pbm: true }), {
    assignee: "patient",
    kind: "upload",
    title: "Laboratorní výsledky",
    documentType: "lab_report",
    informationType: "hemoglobin",
    process: "pbm",
    instructions: "Co v nich má být: krevní obraz, ferritin. Ukažte to svému praktickému lékaři. Nalačno.",
    payload: { tests: ["krevní obraz", "ferritin"], note: "Nalačno." },
  }));

test("výsledky krve: co v nich má být, jde dopsat i vlastními slovy", () =>
  assert.deepEqual(documentRequestTask({ type: "lab_report", tests: ["krevní obraz"], extra: " vitamin B12, folát " }), {
    assignee: "patient",
    kind: "upload",
    title: "Laboratorní výsledky",
    documentType: "lab_report",
    instructions: "Co v nich má být: krevní obraz, vitamin B12, folát. Ukažte to svému praktickému lékaři.",
    payload: { tests: ["krevní obraz", "vitamin B12, folát"] },
  }));

test("výsledky krve jen s vlastním textem, bez rychlých voleb", () =>
  assert.equal(documentRequestTask({ type: "lab_report", extra: "TSH" }).instructions, "Co v nich má být: TSH. Ukažte to svému praktickému lékaři."));

test("jiný dokument: název napíše ambulance, v detailu je jen poznámka", () =>
  assert.deepEqual(documentRequestTask({ type: "other", name: "  Zpráva z kardiologie ", note: "Hlavně echo srdce." }), {
    assignee: "patient",
    kind: "upload",
    title: "Zpráva z kardiologie",
    documentType: "other",
    instructions: "Hlavně echo srdce.",
    payload: { note: "Hlavně echo srdce." },
  }));

test("bez doplnění dostane pacient obecnou radu, kde dokument získá", () =>
  assert.equal(documentRequestTask({ type: "ecg" }).instructions, "Záznam EKG nebo zpráva, kde je popsané."));

test("testy patří jen k laboratoři, u jiného dokumentu se zahodí", () =>
  assert.deepEqual(documentRequestTask({ type: "ecg", tests: ["ferritin"] }).payload, {}));

test("PBM běží jen u výsledků krve, jiný dokument ze zkratky u Hb ho nespustí", () =>
  assert.equal("process" in documentRequestTask({ type: "ecg", pbm: true }), false));
