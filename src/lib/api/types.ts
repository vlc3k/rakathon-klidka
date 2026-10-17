// Tvary odpovědí API v1, jak je vidí klient. Odvozené z návratových typů služeb na serveru (jen typy,
// `import type` se při buildu zahodí, takže do prohlížeče nic ze serveru neodejde). JSON nemá Date,
// časy chodí jako ISO řetězce, proto Jsonify.
import type { SessionUser } from "@/lib/server/session";
import type { getCaseActivity } from "@/lib/server/services/activity";
import type { getCaseDetail, getPatientCaseView, listUserCases } from "@/lib/server/services/case-views";
import type { listCases } from "@/lib/server/services/cases";
import type { toMetadataDto } from "@/lib/server/services/documents";
import type { createInvite, listHelpers } from "@/lib/server/services/helpers";
import type { getPatient, listPatients } from "@/lib/server/services/patients";
import type { getQueue } from "@/lib/server/services/queue";
import type { listTasks } from "@/lib/server/services/tasks";
import type { getTemplate, listTemplates } from "@/lib/server/services/templates";
import type { HospitalSnapshot } from "@/lib/fhir/snapshot";

export type Jsonify<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

type Data<F extends (...args: never[]) => unknown> = Jsonify<Awaited<ReturnType<F>>>;

export type Session = SessionUser;
export type Role = Session["role"];

export type Queue = Data<typeof getQueue>;

export type CaseActivity = Data<typeof getCaseActivity>;
export type ActivityEvent = CaseActivity["events"][number];
export type QueueRow = Queue["rows"][number];

export type CaseDetail = Data<typeof getCaseDetail>;
export type Information = CaseDetail["information"][number];
export type CaseDocument = CaseDetail["documents"][number];
export type HbFinding = CaseDetail["hb"];
export type HbStatus = HbFinding["status"];

export type Task = Data<typeof listTasks>[number];
export type TaskStatus = Task["status"];

export type UserCase = Data<typeof listUserCases>[number];
export type PatientCaseView = Data<typeof getPatientCaseView>;
export type DocumentMetadata = Jsonify<ReturnType<typeof toMetadataDto>>;

export type Patient = Data<typeof listPatients>[number];
export type PatientDetail = Data<typeof getPatient>;
export type CaseListItem = Data<typeof listCases>[number];

export type Helper = Data<typeof listHelpers>[number];
export type HelperInvite = Data<typeof createInvite>;

export type Template = Data<typeof listTemplates>[number];
export type TemplateDetail = Data<typeof getTemplate>;

export type { HospitalSnapshot };
