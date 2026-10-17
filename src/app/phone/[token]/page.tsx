import { Suspense } from "react";
import { connection } from "next/server";
import { PhoneUpload } from "@/app/components/phone/token/PhoneUpload";
import { readUploadLink } from "@/lib/server/uploadLink";

// Telefon po naskenování QR z počítače („Vyfotit telefonem“): rovnou skener, bez přihlašování.
// Odkaz platí 15 minut a jen na nahrání dokumentu k jednomu zákroku (lib/server/uploadLink.ts).
export const instant = false;

export default function PhonePage({ params }: PageProps<"/phone/[token]">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/phone/[token]">, "params">) {
  // Platnost se porovnává s aktuálním časem, počítá se při každém otevření.
  await connection();
  const { token } = await params;
  const link = readUploadLink(token);
  if (!link) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center pt-safe pb-safe">
        <h1 className="text-2xl font-semibold tracking-tight">Odkaz vypršel</h1>
        <p className="max-w-xs text-base text-muted-foreground">Na počítači klikněte znovu na „Vyfotit telefonem“ a naskenujte nový QR kód.</p>
      </main>
    );
  }
  return <PhoneUpload token={token} caseId={link.caseId} taskId={link.taskId} />;
}
