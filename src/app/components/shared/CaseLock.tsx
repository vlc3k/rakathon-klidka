"use client";

import { createContext, useContext } from "react";

// Uzavřený (exportovaný) zákrok: údaje se jen čtou. Potvrzování, úpravy a vyžádání se schovají;
// zamyká to i server (assertCaseOpen), tohle je jen ať nikdo neklikne na něco, co skončí chybou.
const CaseLockContext = createContext(false);

export function CaseLock({ locked, children }: { locked: boolean; children: React.ReactNode }) {
  return <CaseLockContext value={locked}>{children}</CaseLockContext>;
}

export function useCaseLocked() {
  return useContext(CaseLockContext);
}
