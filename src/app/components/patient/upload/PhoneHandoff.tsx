"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api/client";

// „Vyfotit telefonem“ na počítači bez kamery: QR kód s jednorázovým odkazem (15 minut, jen nahrání k tomuto
// zákroku). Telefon ho naskenuje, vyfotí dokument a odešle; počítač se každé 2 s ptá, kolik stránek dorazilo,
// a jakmile jsou přijaté, ukáže to (čtení AI běží dál na pozadí jako po nahrání z počítače).

type Link = { token: string; url: string; expiresAt: string };
type Status = { expired: boolean; received: number; reading: number };

export function PhoneHandoff({ caseId, taskId, onClose, onReceived }: { caseId: string; taskId?: string; onClose: () => void; onReceived: () => void }) {
  const [link, setLink] = useState<Link | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .post<Link>(`/api/v1/cases/${caseId}/upload-link`, taskId ? { taskId } : {})
      .then(async (created) => {
        if (!alive) return;
        setLink(created);
        setQr(await QRCode.toDataURL(created.url, { margin: 1, width: 320 }));
      })
      .catch((e) => alive && setError(errorMessage(e, "QR kód se nepodařilo připravit.")));
    return () => {
      alive = false;
    };
  }, [caseId, taskId]);

  // Čeká na telefon: kolik stránek od vytvoření odkazu dorazilo.
  useEffect(() => {
    if (!link) return;
    const tick = () =>
      api
        .get<Status>(`/api/v1/cases/${caseId}/upload-link?token=${encodeURIComponent(link.token)}`)
        .then(setStatus)
        .catch(() => undefined);
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, [caseId, link]);

  const received = status?.received ?? 0;
  // Adresu „localhost“ telefon neotevře (znamená „tohle zařízení“). Při vývoji je potřeba PUBLIC_APP_URL (tunel).
  const unreachable = link ? /^https?:\/\/(localhost|127\.|\[::1\])/.test(link.url) : false;
  // Stránky přijaté a chvíli nic nového: telefon je hotový (posílá po stránkách, čtení běží na pozadí).
  const [settledAt, setSettledAt] = useState(0);
  useEffect(() => {
    if (!received) return;
    const timer = setTimeout(() => setSettledAt(received), 4000);
    return () => clearTimeout(timer);
  }, [received]);
  const settled = received > 0 && settledAt === received;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="phone-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl bg-background p-6 text-center shadow-xl">
        {received > 0 && settled ? (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-green-700 text-white">
              <Check className="size-7" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 id="phone-title" className="text-xl font-semibold tracking-tight">
                Přijato z telefonu
              </h2>
              <p className="text-base text-muted-foreground">
                {received === 1 ? "1 stránka" : received < 5 ? `${received} stránky` : `${received} stránek`}
                {status?.reading ? ", AI ji teď čte." : "."}
              </p>
            </div>
            <Button className="h-12 w-full rounded-full text-base" onClick={onReceived}>
              Hotovo
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 id="phone-title" className="text-xl font-semibold tracking-tight">
                Vyfoťte telefonem
              </h2>
              <p className="text-base text-muted-foreground">Naskenujte QR kód foťákem v telefonu. Otevře se kamera, dokument vyfoťte a odešlete.</p>
            </div>
            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- QR je data URL vytvořená v prohlížeči
              <img src={qr} alt="QR kód pro vyfocení dokumentu telefonem" className="size-64 rounded-xl" />
            ) : (
              <span className="flex size-64 items-center justify-center rounded-xl bg-muted">
                <Loader className="size-6 text-muted-foreground motion-safe:animate-spin" />
              </span>
            )}
            {unreachable && (
              <p role="alert" className="text-sm font-medium text-amber-700">
                Kód vede na adresu tohoto počítače, telefon ji neotevře. Otevřete aplikaci přes veřejnou adresu, nebo nastavte PUBLIC_APP_URL.
              </p>
            )}
            {status?.expired ? (
              <p className="text-sm text-amber-700">Kód vypršel. Zavřete okno a zkuste to znovu.</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                {received > 0 ? (
                  <>
                    <Loader className="size-4 motion-safe:animate-spin" /> Přichází z telefonu…
                  </>
                ) : (
                  "Čekám na telefon, kód platí 15 minut."
                )}
              </p>
            )}
            <Button variant="ghost" className="h-11 w-full rounded-full text-base" onClick={onClose}>
              Zavřít
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
