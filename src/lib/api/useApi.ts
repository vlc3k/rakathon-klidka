"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, ApiError } from "@/lib/api/client";

// Čtení z API s mezipamětí v paměti stránky (klíč = cesta). Víc komponent se stejnou cestou sdílí jeden
// požadavek a po změně (revalidate) se obnoví všechny najednou. Při každém zobrazení se data načtou znovu,
// mezitím je vidět poslední známý stav (stale-while-revalidate).

type Entry = { data?: unknown; error?: ApiError; loading: boolean };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();

const LOADING: Entry = { loading: true };
const IDLE: Entry = { loading: false };

function set(key: string, entry: Entry) {
  entries.set(key, entry);
  listeners.get(key)?.forEach((listener) => listener());
}

function load(key: string): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const previous = entries.get(key);
  if (previous && !previous.loading) set(key, { ...previous, loading: true });
  const promise = api
    .get(key)
    .then(
      (data) => set(key, { data, loading: false }),
      (error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError(0, "Něco se pokazilo.");
        set(key, { data: entries.get(key)?.data, error: apiError, loading: false });
      },
    )
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function useApi<T>(path: string | null, { refreshMs }: { refreshMs?: number } = {}) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!path) return () => {};
      const subscribers = listeners.get(path) ?? new Set();
      subscribers.add(listener);
      listeners.set(path, subscribers);
      return () => {
        subscribers.delete(listener);
      };
    },
    [path],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (path ? (entries.get(path) ?? LOADING) : IDLE),
    () => (path ? LOADING : IDLE),
  );

  // Načíst při zobrazení a pak případně v intervalu (jen když je stránka vidět).
  useEffect(() => {
    if (!path) return;
    void load(path);
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(path);
    }, refreshMs);
    return () => clearInterval(timer);
  }, [path, refreshMs]);

  const reload = useCallback(() => (path ? load(path) : Promise.resolve()), [path]);
  return { data: entry.data as T | undefined, error: entry.error, loading: entry.loading && entry.data === undefined, reload };
}

// Po změně: znovu načte všechny cesty, které začínají předponou (třeba „/api/v1/cases/<id>“ = detail i úkoly).
// Cesty, které zrovna nikdo nezobrazuje, se jen zahodí a načtou se při dalším zobrazení.
export function revalidate(...prefixes: string[]) {
  const matches = (key: string) => prefixes.some((prefix) => key === prefix || key.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || key.startsWith(`${prefix}?`));
  const jobs: Promise<void>[] = [];
  for (const key of [...entries.keys()]) {
    if (!matches(key)) continue;
    if (listeners.get(key)?.size) jobs.push(load(key));
    else entries.delete(key);
  }
  return Promise.all(jobs);
}

// Po odhlášení nesmí v paměti zůstat nic z předchozího účtu.
export function clearApiCache() {
  entries.clear();
  inflight.clear();
}
