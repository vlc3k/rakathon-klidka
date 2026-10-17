import { RULES } from "@/db/catalog";
import type { HbStatus } from "@/lib/server/rules/hemoglobin";

// Patient Blood Management (zadání v4.2): spouští ho krevní ztráta nad 500 ml, Hb pod 120 g/l nebo známá anémie.
// Stav procesu (PROBÍHÁ) je oddělený od stavu hodnoty (Hb POZOR): probíhá, dokud je otevřený úkol s process = 'pbm'.

export type PbmTrigger = "blood_loss" | "hb_low" | "known_anemia";
export type PbmState = { status: "none" | "indicated" | "running"; triggers: PbmTrigger[] };

export function evaluatePbm(input: { bloodLossMl: number | null; hbStatus: HbStatus; knownAnemia: boolean; activePbmTasks: number }): PbmState {
  const triggers: PbmTrigger[] = [];
  if (input.bloodLossMl !== null && input.bloodLossMl > RULES.pbm.bloodLossThresholdMl) triggers.push("blood_loss");
  if (input.hbStatus === "alert") triggers.push("hb_low");
  if (input.knownAnemia) triggers.push("known_anemia");
  const status = input.activePbmTasks > 0 ? "running" : triggers.length ? "indicated" : "none";
  return { status, triggers };
}
