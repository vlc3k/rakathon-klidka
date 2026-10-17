import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { cases } from "@/db/schema";
import { POST as markSeen } from "@/app/api/v1/cases/[caseId]/mark-seen/route";
import { GET as queue } from "@/app/api/v1/queue/route";
import { recordEvent } from "@/lib/server/events";
import { testDb } from "../support/db";
import { createCase, createDocument, createInformation, createPatient, createStaff, createTask, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

async function caseWithHb(staffId: string, surgeryDate: string, hb: number | null, lastName: string) {
  const { user } = await createPatient({ user: { lastName, displayName: `Jan ${lastName}` } });
  const row = await createCase(user.id, staffId, { surgeryDate });
  if (hb !== null) {
    const doc = await createDocument(row.id, user.id, { issuedDate: "2026-10-10" });
    await createInformation(row.id, { type: "hemoglobin", value: { value: hb, unit: "g/l" }, documentId: doc.id, observedDate: "2026-10-10", status: "verified", verifiedBy: staffId });
  }
  return { user, row };
}

describe("fronta", () => {
  test("řadí Pozor, Doplnit, V pořádku a ukáže, co dělat dál", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    const staff = await createStaff();
    const ok = await caseWithHb(staff.id, "2026-11-01", 140, "Vpořádku");
    const missing = await caseWithHb(staff.id, "2026-10-21", null, "Chybí");
    const alert = await caseWithHb(staff.id, "2026-11-13", 98, "Anémie");
    const cancelled = await caseWithHb(staff.id, "2026-10-20", 90, "Zrušený");
    await testDb.update(cases).set({ status: "cancelled" }).where(eq(cases.id, cancelled.row.id));
    const cookie = await loginCookie(staff.id);

    const res = await queue(request("GET", "/api/v1/queue", { cookie }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { caseId: string }) => r.caseId)).toEqual([alert.row.id, missing.row.id, ok.row.id]);
    expect(body.rows[0]).toMatchObject({ patientName: "Jan Anémie", daysToCase: 27, hb: { value: 98, status: "alert" }, nextStep: "assess_pbm" });
    expect(body.rows[1]).toMatchObject({ daysToCase: 4, hb: { value: null, status: "missing" }, nextStep: "request_hb" });
    expect(body.rows[2]).toMatchObject({ hb: { status: "ok", verified: true }, nextStep: null });
    expect(body.stats).toEqual({ alert: 1, new: 0, silent: 0, daysAhead: 21 }); // průměr dní do zákroku u známého Hb: (27 + 15) / 2
  });

  test("probíhající PBM čeká na odběr", async () => {
    const staff = await createStaff();
    const { row } = await caseWithHb(staff.id, "2026-11-13", 98, "Anémie");
    await createTask(row.id, { assignee: "patient", kind: "action", title: "Odběr krve", documentType: null, informationType: null, process: "pbm", approvedBy: staff.id });

    const body = await (await queue(request("GET", "/api/v1/queue", { cookie: await loginCookie(staff.id) }))).json();

    expect(body.rows[0]).toMatchObject({ pbmStatus: "running", nextStep: "await_lab" });
  });

  test("co udělal pacient, svítí jako nové, dokud zákrok neotevře někdo z AA", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const { user, row } = await caseWithHb(staff.id, "2026-11-13", 140, "Nový");
    await recordEvent(testDb, { caseId: row.id, actorId: user.id, type: "document.uploaded", summary: "Pacient nahrál dokument." });

    const before = await (await queue(request("GET", "/api/v1/queue", { cookie }))).json();
    await markSeen(request("POST", `/api/v1/cases/${row.id}/mark-seen`, { cookie }), params({ caseId: row.id }));
    const after = await (await queue(request("GET", "/api/v1/queue", { cookie }))).json();

    expect(before.rows[0].isNew).toBe(true);
    expect(before.stats.new).toBe(1);
    expect(after.rows[0].isNew).toBe(false);
  });

  test("pacient frontu nevidí", async () => {
    const { user } = await createPatient();

    const res = await queue(request("GET", "/api/v1/queue", { cookie: await loginCookie(user.id) }));

    expect(res.status).toBe(403);
  });

  test("pacient, který se od založení neozval, svítí sestře; otevření úkolů stačí", async () => {
    const staff = await createStaff();
    const cookie = await loginCookie(staff.id);
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const silent = await caseWithHb(staff.id, "2026-11-13", 140, "Mlčí");
    const opened = await caseWithHb(staff.id, "2026-11-13", 140, "Otevřel");
    const fresh = await caseWithHb(staff.id, "2026-11-13", 140, "Čerstvý");
    await testDb.update(cases).set({ createdAt: fiveDaysAgo }).where(eq(cases.id, silent.row.id));
    await testDb.update(cases).set({ createdAt: fiveDaysAgo }).where(eq(cases.id, opened.row.id));
    await recordEvent(testDb, { caseId: opened.row.id, actorId: opened.user.id, type: "task.read", summary: "Pacient si přečetl úkoly." });

    const body = await (await queue(request("GET", "/api/v1/queue", { cookie }))).json();
    const byId = (id: string) => body.rows.find((r: { caseId: string }) => r.caseId === id);

    expect(byId(silent.row.id).silentDays).toBe(5);
    expect(byId(opened.row.id).silentDays).toBeNull();
    expect(byId(fresh.row.id).silentDays).toBeNull();
    expect(body.stats.silent).toBe(1);
  });
});
