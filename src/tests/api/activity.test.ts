import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { cases, events } from "@/db/schema";
import { GET as activity } from "@/app/api/v1/cases/[caseId]/activity/route";
import { testDb } from "../support/db";
import { createCase, createPatient, createStaff, loginCookie } from "../support/factories";
import { params, request } from "../support/http";

type Body = {
  from: string;
  to: string;
  today: string;
  events: { type: string; day: string; actor: { displayName: string; role: string } | null }[];
  surgery: { date: string; procedureName: string | null } | null;
};

const event = (caseId: string, actorId: string | null, type: string, createdAt: string) =>
  testDb.insert(events).values({ caseId, actorId, type, summary: type, createdAt: new Date(createdAt) });

const get = async (caseId: string, cookie: string) => activity(request("GET", `/api/v1/cases/${caseId}/activity`, { cookie }), params({ caseId }));

describe("aktivita zákroku", () => {
  test("události po dnech v pražském čase, zákrok a mřížka od týdne před založením do týdne po zákroku", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z")); // sobota
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id, { surgeryDate: "2026-11-13", procedureName: "Resekce tlustého střeva" });
    await testDb.update(cases).set({ createdAt: new Date("2026-10-01T09:00:00Z") }).where(eq(cases.id, row.id));
    const other = await createCase(user.id, staff.id);
    // Ve 22:30 UTC je v Praze už další den.
    await event(row.id, user.id, "document.uploaded", "2026-10-16T22:30:00Z");
    await event(row.id, staff.id, "information.verified", "2026-10-17T07:00:00Z");
    await event(row.id, null, "document.read", "2026-10-16T22:31:00Z");
    await event(other.id, user.id, "task.read", "2026-10-15T09:00:00Z");

    const res = await get(row.id, await loginCookie(staff.id));

    expect(res.status).toBe(200);
    const body: Body = await res.json();
    // Založeno ve čtvrtek 1. 10. → od pondělí 21. 9.; zákrok v pátek 13. 11. → do neděle 22. 11. To je 9 týdnů,
    // na minimum 12 se doplní dozadu, takže od 31. 8.
    expect(body).toMatchObject({ from: "2026-08-31", to: "2026-11-22", today: "2026-10-17", surgery: { date: "2026-11-13", procedureName: "Resekce tlustého střeva" } });
    expect(body.events.map((e) => [e.type, e.day])).toEqual([
      ["document.read", "2026-10-17"],
      ["information.verified", "2026-10-17"],
      ["document.uploaded", "2026-10-17"],
    ]);
    expect(body.events[0].actor).toBeNull();
    expect(body.events[1].actor).toMatchObject({ role: "aa" });
  });

  test("krátký zákrok má aspoň 12 týdnů, zrušený se jako plánovaný neukazuje", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T08:00:00Z"));
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id, { surgeryDate: "2026-10-20", status: "cancelled" });

    const body: Body = await (await get(row.id, await loginCookie(staff.id))).json();

    expect(body.surgery).toBeNull();
    expect((Date.parse(body.to) - Date.parse(body.from) + 86_400_000) / (7 * 86_400_000)).toBe(12);
  });

  test("jen pro ambulanci", async () => {
    const staff = await createStaff();
    const { user } = await createPatient();
    const row = await createCase(user.id, staff.id);

    const res = await get(row.id, await loginCookie(user.id));

    expect(res.status).toBe(403);
  });
});
