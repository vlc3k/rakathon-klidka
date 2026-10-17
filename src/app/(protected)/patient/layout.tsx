import { Suspense } from "react";
import { PageSkeleton } from "@/app/components/shared/LoadingStates";
import { RoleGate } from "@/app/components/shared/RoleGate";
import { PatientCaseProvider } from "@/app/components/patient/PatientCase";
import { PatientShell } from "@/app/components/patient/PatientShell";

// Jen pro přihlášeného pacienta nebo jeho pomocníka z rodiny, ověřeno na serveru (RoleGate). Do té doby kostra stránky i s rámem.
// Co pomocník nesmí (podpis souhlasu, zvaní pomocníků), hlídá API; obrazovky to jen nenabízejí.
// Vybraný zákrok drží PatientCaseProvider tady v layoutu, takže vydrží přechody mezi podstránkami (souhlas, fotka úst, nahrání).
// Bílé pozadí: nejvyšší kontrast textu pro seniory, karty mají místo podkladu jemný obrys.
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-background pt-safe">
      <Suspense fallback={<PageSkeleton framed />}>
        <RoleGate role={["patient", "helper"]}>
          <PatientShell>
            <PatientCaseProvider>{children}</PatientCaseProvider>
          </PatientShell>
        </RoleGate>
      </Suspense>
    </div>
  );
}
