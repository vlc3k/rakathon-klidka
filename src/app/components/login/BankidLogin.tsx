"use client";

import { useSearchParams } from "next/navigation";
import { BankIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { InfoTip } from "@/app/components/shared/InfoTip";

// Proč se nepovedlo přihlášení přes Bank iD (?bankid= z /api/auth/bankid a jeho návratu).
const BANKID_ERRORS: Record<string, string> = {
  nenastaveno: "Přihlášení přes Bank iD zatím není nastavené. Přihlaste se identifikátorem.",
  nedostupne: "Bank iD teď neodpovídá. Zkuste to za chvíli, nebo se přihlaste identifikátorem.",
  nenalezen: "Bank iD vás ověřilo, ale v ambulanci vás podle rodného čísla nenacházíme. Přihlaste se identifikátorem, nebo zavolejte koordinátorce.",
  zruseno: "Přihlášení přes Bank iD jste zrušili.",
  neplatne: "Přihlášení přes Bank iD se nepovedlo dokončit. Zkuste to znovu.",
  vyprselo: "Přihlášení přes Bank iD vypršelo. Zkuste to znovu.",
};

// Druhá cesta pro pacienta: bankovní identita (OIDC, lib/server/bankid.ts). Po návratu z banky vznikne
// stejná session jako po běžném přihlášení a pacient jde rovnou na svůj přehled.
export function BankidLogin() {
  const reason = useSearchParams().get("bankid");
  const message = reason ? BANKID_ERRORS[reason] : undefined;
  return (
    <div className="flex flex-col gap-4">
      {message && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <WarningIcon className="mt-0.5 size-4 shrink-0" />
          {message}
        </p>
      )}
      <div className="flex items-center gap-4 text-sm text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        nebo
        <span className="h-px flex-1 bg-border" />
      </div>
      {/* Odkaz, ne tlačítko: přihlášení pokračuje na stránce Bank iD a vrátí se zpátky. */}
      <a
        href="/api/auth/bankid"
        className="press flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-6 text-base font-medium outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BankIcon className="size-5" />
        Přihlásit přes Bank iD
      </a>
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        Ověření přes vaši banku
        <InfoTip>
          Bankovní identita: přihlásíte se stejně jako do internetového bankovnictví. Banka nám potvrdí jen vaše jméno, datum narození a
          rodné číslo, hesla ani údaje o účtu nevidíme.
        </InfoTip>
      </p>
    </div>
  );
}
