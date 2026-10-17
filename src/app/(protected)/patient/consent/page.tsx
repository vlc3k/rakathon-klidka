import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ConsentSign } from "@/app/components/patient/ConsentSign";
import { CONSENT_SIGNING } from "@/lib/features";
import { CONSENT } from "@/lib/patientInfo";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

export default function ConsentPage() {
  // Podpis souhlasu je zatím schovaný (lib/features.ts): starý odkaz vede na přehled.
  if (!CONSENT_SIGNING) redirect("/patient");
  return (
    <div className="flex flex-col gap-8 pb-12 lg:mx-auto lg:max-w-xl">
      <Link href="/patient" className="press -ml-2 flex min-h-12 w-max items-center gap-1 px-2 text-lg text-foreground hover:text-muted-foreground">
        <ChevronLeft className="size-6" /> Zpět na přípravu
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{CONSENT.title}</h1>
        <p className="text-sm text-muted-foreground">{CONSENT.note}</p>
      </header>
      <ul className="flex flex-col gap-3 rounded-2xl bg-background p-5 text-base">
        {CONSENT.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <ConsentSign />
    </div>
  );
}
