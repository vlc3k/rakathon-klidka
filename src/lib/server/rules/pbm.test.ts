import { describe, expect, test } from "vitest";
import { evaluatePbm } from "@/lib/server/rules/pbm";

describe("stav PBM", () => {
  test("bez spouštěče PBM není", () => {
    expect(evaluatePbm({ bloodLossMl: 200, hbStatus: "ok", knownAnemia: false, activePbmTasks: 0 })).toEqual({ status: "none", triggers: [] });
  });

  test("krevní ztráta nad 500 ml, nízký Hb a známá anémie jsou spouštěče", () => {
    expect(evaluatePbm({ bloodLossMl: 800, hbStatus: "alert", knownAnemia: true, activePbmTasks: 0 })).toEqual({
      status: "indicated",
      triggers: ["blood_loss", "hb_low", "known_anemia"],
    });
  });

  test("přesně 500 ml ještě nespouští", () => {
    expect(evaluatePbm({ bloodLossMl: 500, hbStatus: "ok", knownAnemia: false, activePbmTasks: 0 }).status).toBe("none");
  });

  test("rozpracovaný úkol PBM znamená, že PBM probíhá", () => {
    expect(evaluatePbm({ bloodLossMl: 800, hbStatus: "alert", knownAnemia: false, activePbmTasks: 1 }).status).toBe("running");
  });
});
