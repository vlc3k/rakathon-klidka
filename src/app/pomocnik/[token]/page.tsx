import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { HelperJoin } from "@/app/components/patient/HelperJoin";
import { describeInvite } from "@/lib/server/services/helpers";

// Pozvánka je v databázi a platnost se porovnává s aktuálním časem, okamžitá navigace se tu nečeká.
export const instant = false;

// Odkaz s tokenem nepatří do vyhledávačů.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Pomocník z rodiny otevřel odkaz z pozvánky (QR, SMS). Ověří se datem narození pacienta a dostane vlastní přihlášení.
export default function HelperInvitePage({ params }: PageProps<"/pomocnik/[token]">) {
  return (
    <Suspense fallback={null}>
      {params.then(({ token }) => (
        <Invite token={token} />
      ))}
    </Suspense>
  );
}

async function Invite({ token }: { token: string }) {
  await connection();
  const invite = await describeInvite(token);
  if (!invite) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Pozvánka už neplatí</h1>
        <p className="text-lg text-muted-foreground">Mohla vypršet nebo ji pacient zrušil. Požádejte ho prosím o novou.</p>
      </div>
    );
  }
  return <HelperJoin token={token} patientFirstName={invite.patientFirstName} />;
}
