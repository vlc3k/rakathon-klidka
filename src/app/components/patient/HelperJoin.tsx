"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import { clearApiCache } from "@/lib/api/useApi";
import { CONSENT_SIGNING } from "@/lib/features";

// Přijetí pozvánky: pomocník zadá datum narození pacienta (ověření, že ho opravdu zná).
// Server počítá špatné pokusy stejně jako u přihlášení. Po úspěchu jde rovnou do pacientské části.
export function HelperJoin({ token, patientFirstName }: { token: string; patientFirstName: string }) {
  const router = useRouter();
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!birthDate) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/helper", { token, birthDate });
      clearApiCache();
      router.replace("/patient");
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 500 ? e.message : errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl leading-snug font-semibold tracking-tight text-balance">{patientFirstName} vás požádal(a) o pomoc s přípravou na zákrok.</h1>
        <p className="text-lg text-muted-foreground">
          Budete moct fotit podklady od lékařů a posílat zprávy ambulanci.{CONSENT_SIGNING && ` Souhlas s anestezií podepíše jen ${patientFirstName}.`}
        </p>
      </header>
      <label className="flex flex-col gap-2">
        <span className="text-lg font-medium">Kdy se narodil(a) {patientFirstName}?</span>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          required
          className="h-14 rounded-2xl border-2 border-border bg-background px-4 text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-base text-muted-foreground">Tím ověříme, že pomáháte tomu správnému člověku.</span>
      </label>
      {error && (
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!birthDate || busy} className="h-14 w-full max-w-sm rounded-full text-lg">
        {busy ? "Ověřuji…" : "Začít pomáhat"}
      </Button>
    </form>
  );
}
