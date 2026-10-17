"use client";

import { useState } from "react";
import Link from "next/link";
import { FamilyIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DetailSection } from "@/app/components/shared/DetailSection";
import { ListCard } from "@/app/components/shared/ListCard";
import { BLAMELESS } from "@/app/components/patient/TodayPanel";
import { CONSENT_SIGNING } from "@/lib/features";
import { api, errorMessage } from "@/lib/api/client";
import { revalidate, useApi } from "@/lib/api/useApi";
import type { Helper } from "@/lib/api/types";
import { formatDate } from "@/lib/date";
import { relationLabel } from "@/lib/helpers";

// „Kdo vám pomáhá“ v podrobném přehledu pacienta: pomocníci z rodiny a čekající pozvánky.
// Ukončit přístup smí jen pacient sám (API), pomocník tuhle sekci nevidí.
export function HelpersSection() {
  const { data: helpers, error: loadError } = useApi<Helper[]>("/api/v1/helpers");
  const [ending, setEnding] = useState<Helper | null>(null);
  const [error, setError] = useState("");

  async function revoke(helper: Helper) {
    setError("");
    try {
      await api.delete(`/api/v1/helpers/${helper.id}`);
      await revalidate("/api/v1/helpers");
    } catch (e) {
      setError(errorMessage(e, BLAMELESS.send));
    }
  }

  return (
    <DetailSection title="Kdo vám pomáhá" info={`Pomocník z rodiny vidí, co je potřeba, a může posílat podklady a zprávy ambulanci.${CONSENT_SIGNING ? " Souhlas s anestezií podepisujete jen vy." : ""}`}>
      <ListCard outlined>
        {helpers?.map((helper) => (
          <li key={helper.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-h-12 items-center gap-4">
              <FamilyIcon className="size-6 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-base">
                  {helper.displayName}, {relationLabel(helper.relation)}
                </span>
                <span className="block text-base text-muted-foreground">
                  {helper.joinedAt ? `Pomáhá od ${formatDate(helper.joinedAt)}` : `Pozvánka čeká, platí do ${formatDate(helper.inviteExpiresAt)}`}
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => setEnding(helper)}
              className="press min-h-12 shrink-0 rounded-full bg-destructive/10 px-5 text-base font-medium text-destructive outline-none select-none hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ukončit přístup
            </button>
          </li>
        ))}
        {helpers?.length === 0 && <li className="flex min-h-12 items-center px-4 py-3 text-base text-muted-foreground">Zatím vám nikdo nepomáhá.</li>}
        {loadError && !helpers && <li className="px-4 py-3 text-base text-destructive">{loadError.message}</li>}
        <li>
          <Link href="/patient/pomocnik" className="press flex min-h-12 items-center gap-4 px-4 py-3 text-base font-medium outline-none select-none hover:bg-muted/50 focus-visible:bg-muted">
            Pozvat pomocníka z rodiny
          </Link>
        </li>
      </ListCard>
      {error && (
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => !open && setEnding(null)}
        title="Ukončit přístup?"
        description={ending ? `${ending.displayName} už neuvidí vaši přípravu a nebude moct posílat podklady. Novou pozvánku můžete poslat kdykoli.` : ""}
        confirmLabel="Ukončit přístup"
        destructive
        onConfirm={() => ending && void revoke(ending)}
      />
    </DetailSection>
  );
}
