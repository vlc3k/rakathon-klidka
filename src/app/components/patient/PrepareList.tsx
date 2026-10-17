"use client";

import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { BookIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { DetailSection } from "@/app/components/shared/DetailSection";
import { ListCard } from "@/app/components/shared/ListCard";
import { ARTICLES } from "@/lib/patientInfo";

// Odkazy ven se otevřou v novém okně, ať se pacient do přípravy vrátí jedním přepnutím.
const MORE = [
  { title: "Poučený pacient", source: "Souhlasy a poučení VFN", href: "https://www.poucenypacient.cz/" },
  { title: "Anestezie na NZIP", source: "Národní zdravotnický informační portál", href: "https://www.nzip.cz/kategorie/498-anestezie" },
];

// Informace před zákrokem. Souhlas s anestezií je mezi úkoly v „Co je potřeba“ (PatientDashboard).
// Fajfku „Přečteno“ a počet přečtených zatím nemáme, potvrzení přečtení API ještě neumí (MISSING_ENDPOINTS.md, bod 1).
export function PrepareList() {
  return (
    <DetailSection title="Než přijdete">
      <ListCard outlined>
        {ARTICLES.map((article) => (
          <li key={article.id}>
            <Link
              href={`/patient/info/${article.id}`}
              className="press flex min-h-16 items-center gap-4 px-4 py-3 outline-none select-none hover:bg-muted/50 focus-visible:bg-muted"
            >
              <BookIcon className="size-6 shrink-0 p-0.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-base">{article.title}</span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ListCard>
      {/* Víc k anestezii z ověřených zdrojů: portál VFN se souhlasy a poučeními a NZIP ministerstva zdravotnictví. */}
      <ListCard outlined>
        {MORE.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="press flex min-h-16 items-center gap-4 px-4 py-3 outline-none select-none hover:bg-muted/50 focus-visible:bg-muted"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base">{link.title}</span>
                <span className="text-sm text-muted-foreground">{link.source}</span>
              </span>
              <ExternalLink className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          </li>
        ))}
      </ListCard>
    </DetailSection>
  );
}
