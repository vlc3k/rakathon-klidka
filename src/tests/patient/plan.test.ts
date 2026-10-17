import { describe, expect, test } from "vitest";
import { patientPlan } from "@/app/components/patient/plan";
import type { PatientCaseView, Task } from "@/lib/api/types";

// Přehled pacienta skládá jen z úkolů a pohledu na zákrok, databázi nepotřebuje.
const view = { id: "case-1", status: "active", daysToCase: 20, surgeryDate: null, documents: [], consent: null } as unknown as PatientCaseView;

const labRequest = {
  id: "task-lab",
  caseId: "case-1",
  assignee: "patient",
  kind: "upload",
  title: "Laboratorní výsledky",
  instructions: "Co v nich má být: krevní obraz, ferritin. Ukažte to svému praktickému lékaři.",
  documentType: "lab_report",
  informationType: "hemoglobin",
  process: "pbm",
  payload: { tests: ["krevní obraz", "ferritin"] },
  status: "open",
  dueDate: null,
  documentId: null,
  completedAt: null,
  createdAt: "2026-10-17T08:00:00.000Z",
} as unknown as Task;

describe("vyžádané výsledky krve u pacienta", () => {
  test("jsou v tom, co je ještě potřeba, s tím, co v nich má být, a fotí se rovnou k úkolu", () => {
    const { needed } = patientPlan("case-1", view, [labRequest], false);

    expect(needed).toEqual([
      expect.objectContaining({
        id: "task-lab",
        kind: "pbm",
        title: "Laboratorní výsledky",
        detail: "Co v nich má být: krevní obraz, ferritin. Ukažte to svému praktickému lékaři.",
        href: "/patient/upload?task=task-lab",
      }),
    ]);
  });

  test("jsou dalším krokem i se svým detailem, zpráva z ambulance tak řekne, co nést praktikovi", () => {
    const { next } = patientPlan("case-1", view, [labRequest], false);

    expect(next).toEqual({
      kind: "pbm",
      label: "Vyfotit výsledek",
      href: "/patient/upload?task=task-lab",
      detail: "Co v nich má být: krevní obraz, ferritin. Ukažte to svému praktickému lékaři.",
    });
  });

  test("mají kartu mezi zprávami od lékařů jako každý jiný vyžádaný dokument", () => {
    const { visits } = patientPlan("case-1", view, [labRequest], false);

    expect(visits.map((visit) => visit.id)).toEqual(["task-lab"]);
  });
});
