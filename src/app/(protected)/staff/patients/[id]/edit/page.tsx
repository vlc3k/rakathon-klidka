import { Suspense } from "react";
import { PatientForm } from "@/app/components/shared/PatientForm";

// Pacienti jsou v databázi, id není známé při buildu. Data načte formulář z API.
export const instant = false;

// Parametr se čte uvnitř Suspense, aby byl přechod na stránku okamžitý.
export default function EditPatientPage({ params }: PageProps<"/staff/patients/[id]/edit">) {
  return <Suspense>{params.then(({ id }) => <PatientForm id={id} />)}</Suspense>;
}
