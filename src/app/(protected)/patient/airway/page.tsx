import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { AirwayCapture } from "@/app/components/patient/AirwayCapture";

// Obsah je za přihlášením (SessionGate v layoutu) a data načítá klient z API, okamžitá navigace se tu nečeká.
export const instant = false;

// Fotku úst posuzuje anesteziolog (Mallampati), aplikace jen hlídá, aby byla použitelná.
export default function AirwayPage() {
  return (
    <div className="flex flex-col gap-6 pb-12 lg:mx-auto lg:max-w-md">
      <Link
        href="/patient"
        className="press -ml-2 flex min-h-12 w-max items-center gap-1 px-2 text-lg text-foreground hover:text-muted-foreground"
      >
        <ChevronLeft className="size-6" /> Zpět na přípravu
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          Ukažte nám pusu
          <InfoTip>
            Anesteziolog si podle fotky otevřených úst udělá představu, jak
            snadno se při zákroku zajistí dýchání. Seďte rovně, hlavu držte
            rovně, pusu otevřete naplno, jazyk vyplázněte co nejvíc a nic
            neříkejte. Fotka se vyfotí sama, až bude poloha správná. Fotku z
            boku a se zakloněnou hlavou můžete přidat, není povinná. Uvidí je
            jen vaše ambulance.
          </InfoTip>
        </h1>
        <p className="text-base text-muted-foreground">
          Jedna fotka otevřených úst. Sedněte si rovně, telefon držte před
          obličejem, kamera vás navede.
        </p>
      </header>
      <AirwayCapture />
    </div>
  );
}
