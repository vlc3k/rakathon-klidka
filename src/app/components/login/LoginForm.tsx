"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/app/components/shared/TextField";
import { BankidLogin } from "@/app/components/login/BankidLogin";
import { api, ApiError, errorMessage } from "@/lib/api/client";
import { clearApiCache } from "@/lib/api/useApi";
import type { Role, Session } from "@/lib/api/types";
import { homeOf } from "@/lib/roles";

type Mode = "patient" | "staff";

// Přihlášení bez SMS, dokud není BankID: pacient identifikátorem z nemocnice a datem narození,
// zdravotník e-mailem a heslem ambulance (POST /api/auth/login). Přihlášeného rovnou pošle dál.
export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("patient");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<Session>("/api/auth/session")
      .then((session) => alive && router.replace(homeOf(session.role)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();
    const body =
      mode === "patient"
        ? { identifier: field("identifier"), birthDate: field("birthDate") }
        : { email: field("email"), password: String(data.get("password") ?? "") };
    setBusy(true);
    setError(null);
    try {
      const user = await api.post<{ role: Role }>("/api/auth/login", body);
      clearApiCache();
      router.replace(homeOf(user.role));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, errorMessage(e)));
      setBusy(false);
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-3xl font-semibold tracking-tight">{mode === "patient" ? "Přihlášení" : "Přihlášení pro ambulanci"}</h1>

      <form key={mode} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {mode === "patient" ? (
          <>
            <TextField
              id="identifier"
              name="identifier"
              label="Identifikátor"
              info="Najdete ho ve zprávě od ambulance."
              placeholder="VFN-2026-0142"
              autoComplete="username"
              autoCapitalize="characters"
              autoCorrect="off"
              required
            />
            <TextField id="birthDate" name="birthDate" label="Datum narození" type="date" autoComplete="bday" required />
          </>
        ) : (
          <>
            <TextField
              id="email"
              name="email"
              label="E-mail"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              required
            />
            <TextField id="password" name="password" label="Heslo" type="password" autoComplete="current-password" required />
          </>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error.status === 400 ? "Vyplňte prosím všechna pole." : error.message}
          </p>
        )}

        <Button type="submit" disabled={busy} className="mt-2 h-12 w-full rounded-full px-6 text-base">
          {busy ? "Přihlašuji…" : "Přihlásit"}
        </Button>
        {mode === "patient" && (
          <Suspense fallback={null}>
            <BankidLogin />
          </Suspense>
        )}
      </form>

      <Button variant="ghost" className="h-11 w-full rounded-full text-base" onClick={() => switchMode(mode === "patient" ? "staff" : "patient")}>
        {mode === "patient" ? "Jsem zdravotník" : "Jsem pacient"}
      </Button>
    </div>
  );
}
