import config from "@/lib/casy-pripravy.json";

// Časová osa připravenosti: kdy bude pacient připravený a jestli se to stihne do zákroku.
// Pevná pravidla z konfigurace (čekací doby VFN, platnost vyšetření, konsenzus PBM), žádná AI predikce.
// Dny se počítají od dneška (0 = dnes), zákrok je v den `daysToCase`.

export type StepState = "done" | "running" | "todo";
export type Step = {
  id: string;
  label: string;
  state: StepState;
  start: number;
  end: [number, number]; // nejdřív, nejpozději
  latestStart: number; // nejpozději spustit, aby se stihl zákrok
  estimate: boolean;
  source: string;
};
export type Readiness = {
  steps: Step[];
  ready: [number, number] | null;
  reserve: number | null; // v horším případě
  status: "ok" | "tight" | "risk" | "late" | "unknown";
  startToday: Step[];
  iron: { oral: boolean; ivDeadline: number } | null;
};
export type ReadinessInput = {
  daysToCase: number | null;
  items: { id: string; state: string }[]; // z kontrolního seznamu
  requested: string[]; // co ambulance vyžádala (běží od dneška)
  waived: string[];
  consults: string[]; // přidaná konzilia
  anemia: boolean; // Hb pod prahem v dokumentaci
  ironStarted: boolean;
};

type Cfg = { label: string; dny: number[]; platnost?: number; odhad: boolean; zdroj: string };
const STEPS = config.kroky as Record<string, Cfg>;
const IRON = config.zelezo;

function step(id: string, state: StepState, start: number, daysToCase: number, after = 0): Step {
  const c = STEPS[id];
  const s = state === "todo" ? Math.max(start, after) : start;
  return {
    id,
    label: c.label,
    state,
    start: state === "done" ? 0 : s,
    end: state === "done" ? [0, 0] : [s + c.dny[0], s + c.dny[1]],
    latestStart: daysToCase - c.dny[1] - STEPS.aa.dny[1],
    estimate: c.odhad,
    source: c.zdroj,
  };
}

export function readiness(input: ReadinessInput): Readiness {
  const T = input.daysToCase;
  if (T === null) return { steps: [], ready: null, reserve: null, status: "unknown", startToday: [], iron: null };

  const steps: Step[] = [];
  for (const item of input.items) {
    if (!STEPS[item.id] || input.waived.includes(item.id)) continue;
    const state: StepState = item.state === "done" ? "done" : input.requested.includes(item.id) ? "running" : "todo";
    // Vyšetření s omezenou platností nemá smysl dělat dřív, než by v den zákroku platilo.
    // Výjimka: při anémii se krev bere hned, aby šla začít léčba (platnost se týká kontrolního Hb před zákrokem).
    const validity = item.id === "lab" && input.anemia ? undefined : STEPS[item.id].platnost;
    const earliest = validity ? Math.max(0, T - validity) : 0;
    steps.push(step(item.id, state, state === "running" ? 0 : earliest, T));
  }
  for (const id of input.consults) if (STEPS[id]) steps.push(step(id, "running", 0, T));

  let iron: Readiness["iron"] = null;
  if (input.anemia) {
    const lab = steps.find((s) => s.id === "lab" && s.state !== "done");
    const after = lab ? lab.end[1] : 0;
    steps.push(step("zelezo", input.ironStarted ? "running" : "todo", 0, T, after));
    iron = { oral: T >= IRON.peroralni_od, ivDeadline: T - IRON.iv_nejpozdeji_pred_zakrokem };
  }

  const open = steps.filter((s) => s.state !== "done");
  const lastMin = Math.max(0, ...open.map((s) => s.end[0]));
  const lastMax = Math.max(0, ...open.map((s) => s.end[1]));
  const aa = STEPS.aa.dny;
  const ready: [number, number] = [lastMin + aa[0], lastMax + aa[1]];

  // Železo musí být podané nejpozději 14 dní před zákrokem, jinak skoro nezabere.
  const ironLate = iron && steps.some((s) => s.id === "zelezo" && s.end[1] > iron!.ivDeadline);
  const reserve = T - ready[1];
  const status = ready[0] > T ? "late" : reserve < 0 || ironLate ? "risk" : reserve < 3 ? "tight" : "ok";
  // Co spustit: kroky, které ještě neběží a blíží se jim nejzazší termín (do týdne, nebo už je pozdě).
  const startToday = steps.filter((s) => s.state === "todo" && s.latestStart <= 7).sort((a, b) => a.latestStart - b.latestStart);
  return { steps, ready, reserve, status, startToday, iron };
}

export const CONSULTS = config.konzilia as string[];
export const stepLabel = (id: string) => STEPS[id]?.label ?? id;
