"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ChevronLeft, Copy, MessageSquare, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DoneIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { useSession } from "@/app/components/shared/Session";
import { BLAMELESS } from "@/app/components/patient/TodayPanel";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import { revalidate } from "@/lib/api/useApi";
import type { HelperInvite as Invite } from "@/lib/api/types";
import { CONSENT_SIGNING } from "@/lib/features";
import { HELPER_RELATIONS, INVITE_DAYS, RELATION_LABELS, type HelperRelation } from "@/lib/helpers";
import { cn } from "@/lib/utils";

// Pacient pozve pomocníka z rodiny: jméno, vztah a výslovný souhlas, pak QR kód a odkaz (SMS, sdílení, kopie).
// Token z odkazu server vrátí jen jednou, v databázi je jen jeho hash. Kdo odkaz ztratí, pozve znovu.
// Velká tlačítka a jedna věc na obrazovce: formulář, nebo hotová pozvánka.

const ACTION = "press flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-border bg-background px-5 py-3 text-left text-lg font-medium outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function HelperInvite() {
  const { role } = useSession();
  const [invite, setInvite] = useState<Invite | null>(null);

  return (
    <div className="flex flex-col gap-8 pb-12 lg:mx-auto lg:max-w-xl">
      <Link href="/patient?zobrazeni=vse" className="press -ml-2 flex min-h-12 w-max items-center gap-1 px-2 text-lg text-foreground hover:text-muted-foreground">
        <ChevronLeft className="size-6" /> Zpět na přípravu
      </Link>
      {role !== "patient" ? (
        <p className="text-lg">Další pomocníky může pozvat jen pacient sám.</p>
      ) : invite ? (
        <InviteReady invite={invite} />
      ) : (
        <InviteForm onCreated={setInvite} />
      )}
    </div>
  );
}

function InviteForm({ onCreated }: { onCreated: (invite: Invite) => void }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<HelperRelation | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = name.trim() !== "" && relation !== null && consent && !busy;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.post<Invite>("/api/v1/helpers", { displayName: name.trim(), relation, consent });
      await revalidate("/api/v1/helpers");
      onCreated(created);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 500 ? e.message : errorMessage(e, BLAMELESS.send));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Pozvat pomocníka z rodiny</h1>
        <p className="text-lg text-muted-foreground">Může za vás fotit podklady od lékařů a posílat zprávy ambulanci ze svého telefonu.</p>
      </header>

      <label className="flex flex-col gap-2">
        <span className="text-lg font-medium">Jméno</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="off"
          placeholder="Petra"
          className="h-14 rounded-2xl border-2 border-border bg-background px-4 text-lg outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-lg font-medium">Kdo to je?</legend>
        {HELPER_RELATIONS.map((code) => (
          <label
            key={code}
            className={cn(
              "flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border-2 px-4 py-3 text-lg",
              relation === code ? "border-foreground bg-muted" : "border-border",
            )}
          >
            <input type="radio" name="relation" value={code} checked={relation === code} onChange={() => setRelation(code)} className="size-7 shrink-0 accent-foreground" />
            {RELATION_LABELS[code].label}
          </label>
        ))}
      </fieldset>

      <label className="flex min-h-14 cursor-pointer items-start gap-4 rounded-2xl border-2 border-border px-4 py-3 text-lg">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-7 shrink-0 accent-foreground" />
        <span>
          Souhlasím, aby mi pomáhal(a) s přípravou na zákrok.
          <span className="mt-1 block text-base text-muted-foreground">Uvidí, co je potřeba, a bude moct posílat podklady a zprávy.{CONSENT_SIGNING && " Souhlas s anestezií podepisujete jen vy."} Přístup můžete kdykoli ukončit.</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!ready} className="h-14 w-full max-w-sm rounded-full text-lg">
        {busy ? "Vytvářím pozvánku…" : "Vytvořit pozvánku"}
      </Button>
    </form>
  );
}

function InviteReady({ invite }: { invite: Invite }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const name = invite.helper.displayName;
  // Adresa, na kterou dosáhne telefon pomocníka (v demu přes NEXT_PUBLIC_PUBLIC_URL, jinak tahle stránka).
  const base = process.env.NEXT_PUBLIC_PUBLIC_URL ?? window.location.origin;
  const link = `${base}/pomocnik/${invite.token}`;
  const text = `Pomůžeš mi s přípravou na operaci? Otevři tento odkaz a zadej moje datum narození: ${link}`;

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 360 })
      .then(setQr)
      .catch((e: unknown) => console.error("QR kód se nevytvořil:", e));
  }, [link]);

  async function share() {
    try {
      await navigator.share({ title: "Příprava na operaci", text });
    } catch {
      // Zavřené sdílení není chyba, nic neukazujeme.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="flex flex-col gap-8" aria-live="polite">
      <header className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-lg font-medium text-green-700">
          <DoneIcon className="size-6" /> Pozvánka je hotová
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Pošlete ji: {name}</h1>
        <p className="text-lg text-muted-foreground">
          Ať si {name} načte kód telefonem, nebo pošlete odkaz. Při otevření zadá vaše datum narození. Pozvánka platí {INVITE_DAYS} dní.
        </p>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element -- QR je data URL vytvořená v prohlížeči */}
      {qr ? <img src={qr} alt="QR kód pozvánky" className="size-60 rounded-2xl border-2 border-border" /> : <div className="size-60 rounded-2xl bg-muted" />}

      <div className="flex max-w-sm flex-col gap-3">
        <a href={`sms:?&body=${encodeURIComponent(text)}`} className={ACTION}>
          <MessageSquare className="size-6" />
          Poslat SMS
        </a>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button type="button" onClick={share} className={ACTION}>
            <Share2 className="size-6" />
            Sdílet
          </button>
        )}
        <button type="button" onClick={copy} className={ACTION}>
          <Copy className="size-6" />
          {copied ? "Odkaz zkopírovaný" : "Zkopírovat odkaz"}
        </button>
      </div>
    </section>
  );
}
