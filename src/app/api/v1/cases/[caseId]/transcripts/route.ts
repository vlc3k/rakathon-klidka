import { json, readIds, readJson, route } from "@/lib/server/http";
import { createDocumentTranscript, createTranscriptSchema, toTranscriptDto } from "@/lib/server/services/transcripts";
import { requireUploader } from "@/lib/server/uploadLink";

// POST /api/v1/cases/:caseId/transcripts { documentIds, skip? }: přepis dokumentu z jeho stránek (v tomto pořadí)
// a hodnoty do information. skip = nahrát bez čtení. Chyba AI → 502 s přepisem ve stavu failed; jde poslat znovu.
export const POST = route(async (req, ctx: RouteContext<"/api/v1/cases/[caseId]/transcripts">) => {
  const { caseId } = await readIds(ctx, "caseId");
  const { user, row } = await requireUploader(req, caseId);
  const input = await readJson(req, createTranscriptSchema);
  const { transcript, informationCount, failure } = await createDocumentTranscript(user, row, input);
  if (failure) return json({ error: failure.message, transcript: toTranscriptDto(transcript, null, user) }, { status: failure.status });
  return json(toTranscriptDto(transcript, informationCount, user), { status: 201 });
});
