import { describe, expect, test } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getPatient, PATCH as patchPatient } from "@/app/api/v1/patients/[patientId]/route";
import { GET as listPatients, POST as createPatientRoute } from "@/app/api/v1/patients/route";
import { createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function staffCookie() {
  return loginCookie((await createStaff()).id);
}

const newPatient = {
  firstName: "Marie",
  lastName: "Svobodová",
  phone: "+420 600 000 002",
  externalId: "vfn-2026-0200",
  birthNumber: "605301/0007",
};

describe("založení pacienta", () => {
  test("z rodného čísla odvodí datum narození a pohlaví, ven jde RČ maskované", async () => {
    const cookie = await staffCookie();

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: newPatient }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      externalId: "VFN-2026-0200",
      firstName: "Marie",
      lastName: "Svobodová",
      birthDate: "1960-03-01",
      sex: "F",
      birthNumber: "605301/****",
      cases: [],
    });
  });

  test("nový pacient se hned přihlásí identifikátorem a datem narození", async () => {
    const cookie = await staffCookie();
    await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: newPatient }));

    const res = await login(request("POST", "/api/auth/login", { json: { identifier: "VFN-2026-0200", birthDate: "1960-03-01" } }));

    expect(res.status).toBe(200);
  });

  test("zákroky z formuláře založí ve stejném požadavku", async () => {
    const cookie = await staffCookie();

    const res = await createPatientRoute(
      request("POST", "/api/v1/patients", {
        cookie,
        json: { ...newPatient, cases: [{ procedureName: "Hysterektomie", diagnosis: { text: "Myomatóza dělohy" }, surgeryDate: "2026-10-28" }] },
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).cases).toEqual([expect.objectContaining({ procedureName: "Hysterektomie", surgeryDate: "2026-10-28", status: "active" })]);
  });

  test("neplatné rodné číslo odmítne s popisem pole", async () => {
    const cookie = await staffCookie();

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: { ...newPatient, birthNumber: "6003011235" } }));

    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual([expect.objectContaining({ path: "birthNumber" })]);
  });

  test("datum narození, které nesedí s rodným číslem, odmítne", async () => {
    const cookie = await staffCookie();

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: { ...newPatient, birthDate: "1961-01-01" } }));

    expect(res.status).toBe(400);
  });

  test("bez rodného čísla je datum narození povinné", async () => {
    const cookie = await staffCookie();
    const withoutBirthNumber = { ...newPatient, birthNumber: undefined };

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: withoutBirthNumber }));

    expect(res.status).toBe(400);
  });

  test("stejný identifikátor podruhé vrátí 409", async () => {
    const cookie = await staffCookie();
    await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: newPatient }));

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: { ...newPatient, birthNumber: "6003010002" } }));

    expect(res.status).toBe(409);
  });

  test("chyba u zákroku z formuláře má cestu k tomu zákroku", async () => {
    const cookie = await staffCookie();
    const cases = [{ procedureName: "Kýla", diagnosis: { text: "Tříselná kýla" } }, { diagnosis: { text: "Karcinom rekta" } }];

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: { ...newPatient, cases } }));

    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual([expect.objectContaining({ path: "cases.1.procedureName" })]);
  });

  test("výchozí hlášky validace jsou česky", async () => {
    const cookie = await staffCookie();

    const res = await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: { ...newPatient, firstName: "", birthDate: "zítra" } }));

    const messages = (await res.json()).issues.map((i: { message: string }) => i.message);
    expect(messages).toHaveLength(2);
    for (const message of messages) expect(message).toMatch(/[ěščřžýáíéůú]/);
  });

  test("pacient pacienty zakládat ani číst nesmí", async () => {
    const { user } = await createPatient();
    const cookie = await loginCookie(user.id);

    expect((await createPatientRoute(request("POST", "/api/v1/patients", { cookie, json: newPatient }))).status).toBe(403);
    expect((await listPatients(request("GET", "/api/v1/patients", { cookie }))).status).toBe(403);
  });
});

describe("seznam a detail pacienta", () => {
  test("hledá podle jména i identifikátoru, RČ je maskované", async () => {
    const cookie = await staffCookie();
    await createPatient({ user: { firstName: "Jan", lastName: "Novák" }, patient: { externalId: "VFN-2026-0141", birthNumber: "6003010002" } });
    await createPatient({ user: { firstName: "Petr", lastName: "Dvořák" }, patient: { externalId: "VFN-2026-0143" } });

    const byName = await (await listPatients(request("GET", "/api/v1/patients?q=nov", { cookie }))).json();
    const byId = await (await listPatients(request("GET", "/api/v1/patients?q=0143", { cookie }))).json();

    expect(byName).toEqual([expect.objectContaining({ lastName: "Novák", birthNumber: "600301/****" })]);
    expect(byId).toEqual([expect.objectContaining({ lastName: "Dvořák" })]);
  });

  test("znak NUL v hledání vrátí 400, ne 500", async () => {
    const cookie = await staffCookie();

    const res = await listPatients(request("GET", "/api/v1/patients?q=nov%00ak", { cookie }));

    expect(res.status).toBe(400);
  });

  test("detail pro formulář úpravy má celé rodné číslo", async () => {
    const cookie = await staffCookie();
    const { user } = await createPatient({ patient: { birthNumber: "6003010002" } });

    const res = await getPatient(request("GET", `/api/v1/patients/${user.id}`, { cookie }), params({ patientId: user.id }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: user.id, birthNumber: "6003010002" });
  });

  test("neexistující i neplatné ID vrátí 404", async () => {
    const cookie = await staffCookie();
    const missing = "00000000-0000-4000-8000-000000000000";

    expect((await getPatient(request("GET", `/api/v1/patients/${missing}`, { cookie }), params({ patientId: missing }))).status).toBe(404);
    expect((await getPatient(request("GET", "/api/v1/patients/abc", { cookie }), params({ patientId: "abc" }))).status).toBe(404);
  });

  test("odebrání rodného čísla ponechá datum narození", async () => {
    const cookie = await staffCookie();
    const { user } = await createPatient({ patient: { birthNumber: "6003010002", birthDate: "1960-03-01" } });

    const res = await patchPatient(request("PATCH", `/api/v1/patients/${user.id}`, { cookie, json: { birthNumber: null } }), params({ patientId: user.id }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ birthNumber: null, birthDate: "1960-03-01" });
  });

  test("úprava změní jméno i zobrazované jméno", async () => {
    const cookie = await staffCookie();
    const { user } = await createPatient();

    const res = await patchPatient(request("PATCH", `/api/v1/patients/${user.id}`, { cookie, json: { lastName: "Nováková" } }), params({ patientId: user.id }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lastName: "Nováková", displayName: `${user.firstName} Nováková` });
  });
});
