"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { HospitalSnapshot } from "@/lib/fhir/snapshot";

// Kopie dat z nemocnice, pro každou operaci (caseId) zvlášť a nejnovější první. Stažení vždy přidá novou kopii,
// starší zůstanou (víme, co lékař viděl v kterém okamžiku). Zatím v prohlížeči jako caseStore, v provozu v databázi.
const KEY = "smart-aa-hospital-v1";
const EVENT = "smart-aa-hospital";
const MAX_PER_CASE = 10;

type All = Record<string, HospitalSnapshot[]>;

function readAll(): All {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

let cache: All | null = null;
function snapshot() {
  if (cache === null) cache = readAll();
  return cache;
}
const empty: All = {};
const none: HospitalSnapshot[] = [];

function subscribe(cb: () => void) {
  const h = () => {
    cache = readAll();
    cb();
  };
  window.addEventListener("storage", h);
  window.addEventListener(EVENT, h);
  return () => {
    window.removeEventListener("storage", h);
    window.removeEventListener(EVENT, h);
  };
}

export function useHospitalSnapshots(caseId: string) {
  const all = useSyncExternalStore(subscribe, snapshot, () => empty);
  const list = all[caseId] ?? none;
  const add = useCallback(
    (s: HospitalSnapshot) => {
      const cur = readAll();
      const next = { ...cur, [caseId]: [s, ...(cur[caseId] ?? [])].slice(0, MAX_PER_CASE) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      cache = next;
      window.dispatchEvent(new Event(EVENT));
    },
    [caseId],
  );
  return { snapshots: list, add };
}
