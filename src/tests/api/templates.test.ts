import { describe, expect, test } from "vitest";
import { GET as getTemplate, PUT as putTemplate } from "@/app/api/v1/templates/[templateId]/route";
import { GET as listTemplates, POST as createTemplate } from "@/app/api/v1/templates/route";
import { createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

const labTask = { assignee: "patient", kind: "upload", title: "Krevní testy", documentType: "lab_report", informationType: "hemoglobin", validForDays: 14, dueDaysBeforeSurgery: 14 };
const ecgTask = { assignee: "patient", kind: "upload", title: "EKG", documentType: "ecg", appliesFromAge: 65 };

async function staffSession() {
  const staff = await createStaff();
  return { staff, cookie: await loginCookie(staff.id) };
}

const create = (cookie: string, json: unknown) => createTemplate(request("POST", "/api/v1/templates", { cookie, json }));

describe("šablony", () => {
  test("založí šablonu s úkoly a seznam ukáže jejich počet", async () => {
    const { cookie } = await staffSession();

    const res = await create(cookie, { name: "Resekce tlustého střeva", bloodLossMl: 800, tasks: [labTask, ecgTask] });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: "Resekce tlustého střeva", ownerId: null, isActive: true, tasks: [expect.objectContaining({ title: "Krevní testy", sortOrder: 0 }), expect.objectContaining({ title: "EKG", sortOrder: 1 })] });
    const list = await (await listTemplates(request("GET", "/api/v1/templates", { cookie }))).json();
    expect(list).toEqual([expect.objectContaining({ id: created.id, taskCount: 2 })]);
  });

  test("vlastní šablona patří tomu, kdo ji založil", async () => {
    const { staff, cookie } = await staffSession();

    const res = await create(cookie, { name: "Moje", own: true, tasks: [] });

    expect(await res.json()).toMatchObject({ ownerId: staff.id });
  });

  test("kopie převezme úkoly zdrojové šablony", async () => {
    const { cookie } = await staffSession();
    const source = await (await create(cookie, { name: "Nemocniční", tasks: [labTask, ecgTask] })).json();

    const res = await create(cookie, { name: "Moje kopie", own: true, copyFromId: source.id });

    expect((await res.json()).tasks.map((t: { title: string }) => t.title)).toEqual(["Krevní testy", "EKG"]);
  });

  test("úprava nahradí seznam úkolů a u ponechaných zachová ID", async () => {
    const { cookie } = await staffSession();
    const created = await (await create(cookie, { name: "Šablona", tasks: [labTask, ecgTask] })).json();
    const [lab] = created.tasks;

    const res = await putTemplate(
      request("PUT", `/api/v1/templates/${created.id}`, {
        cookie,
        json: { name: "Šablona v2", isActive: true, tasks: [{ ...labTask, id: lab.id, title: "Krevní obraz" }, { assignee: "patient", kind: "question", title: "Kolik vážíte?", informationType: "weight" }] },
      }),
      params({ templateId: created.id }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Šablona v2");
    expect(body.tasks.map((t: { id: string; title: string }) => [t.id === lab.id, t.title])).toEqual([
      [true, "Krevní obraz"],
      [false, "Kolik vážíte?"],
    ]);
  });

  test("úkol z jiné šablony do úpravy nepřijme", async () => {
    const { cookie } = await staffSession();
    const a = await (await create(cookie, { name: "A", tasks: [labTask] })).json();
    const b = await (await create(cookie, { name: "B", tasks: [] })).json();

    const res = await putTemplate(request("PUT", `/api/v1/templates/${b.id}`, { cookie, json: { name: "B", isActive: true, tasks: [{ ...labTask, id: a.tasks[0].id }] } }), params({ templateId: b.id }));

    expect(res.status).toBe(400);
  });

  test("otázka bez typu informace neprojde", async () => {
    const { cookie } = await staffSession();

    const res = await create(cookie, { name: "Chybná", tasks: [{ assignee: "patient", kind: "question", title: "Kolik vážíte?" }] });

    expect(res.status).toBe(400);
  });

  test("neaktivní šablony jsou jen na požádání", async () => {
    const { cookie } = await staffSession();
    const created = await (await create(cookie, { name: "Stará", tasks: [] })).json();
    await putTemplate(request("PUT", `/api/v1/templates/${created.id}`, { cookie, json: { name: "Stará", isActive: false, tasks: [] } }), params({ templateId: created.id }));

    const active = await (await listTemplates(request("GET", "/api/v1/templates", { cookie }))).json();
    const all = await (await listTemplates(request("GET", "/api/v1/templates?includeInactive=true", { cookie }))).json();

    expect(active).toEqual([]);
    expect(all).toHaveLength(1);
  });

  test("detail vrátí úkoly seřazené", async () => {
    const { cookie } = await staffSession();
    const created = await (await create(cookie, { name: "Šablona", tasks: [labTask, ecgTask] })).json();

    const res = await getTemplate(request("GET", `/api/v1/templates/${created.id}`, { cookie }), params({ templateId: created.id }));

    expect((await res.json()).tasks.map((t: { title: string }) => t.title)).toEqual(["Krevní testy", "EKG"]);
  });

  test("pacient šablony nečte ani nemění", async () => {
    const { user } = await createPatient();
    const cookie = await loginCookie(user.id);

    expect((await listTemplates(request("GET", "/api/v1/templates", { cookie }))).status).toBe(403);
    expect((await create(cookie, { name: "X", tasks: [] })).status).toBe(403);
  });
});
