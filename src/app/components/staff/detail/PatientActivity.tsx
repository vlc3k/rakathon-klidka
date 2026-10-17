"use client";

import { DoneIcon, WaitingIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { ListCard, ListRow } from "@/app/components/shared/ListCard";
import { documentUrl } from "@/lib/api/client";
import type { CaseDetail } from "@/lib/api/types";
import { formatDateTime } from "@/lib/date";
import { CONSENT_SIGNING } from "@/lib/features";
import { helperUploadNote } from "@/lib/helpers";
import { SmoothImage } from "@/app/components/shared/LoadingStates";
import { VoicePlayer } from "@/app/components/staff/detail/VoicePlayer";

const done = <DoneIcon className="size-5 shrink-0 text-green-600 [--icon-accent:currentColor]" />;
const pending = <WaitingIcon className="size-5 shrink-0 text-muted-foreground" />;

// Co pacient udělal v portálu: podepsal souhlas, poslal hlasovou zprávu (activity z detailu zákroku). Zprávy hraje VoicePlayer.
// Hlasovku může poslat i pomocník z rodiny, pak je pod ní, kdo ji nahrál.
export function PatientActivity({ caseId, activity, people }: { caseId: string; activity: CaseDetail["activity"]; people: CaseDetail["people"] }) {
  const { consent } = activity;
  const voice = [...activity.voiceMessages].reverse();

  return (
    <>
      {/* Podpis souhlasu je zatím schovaný (lib/features.ts). */}
      {CONSENT_SIGNING && (
        <ListCard title="Souhlas">
          <ListRow
            icon={consent ? done : pending}
            label="Souhlas s anestezií"
            sub={consent ? `Podepsáno ${formatDateTime(consent.signedAt)}${consent.version ? ` · znění ${consent.version}` : ""}` : "Zatím nepodepsán"}
            trailing={
              consent && (
                <SmoothImage src={documentUrl(caseId, consent.documentId)} alt="Podpis pacienta" className="h-10 w-max rounded-lg bg-muted px-2" imgClassName="h-full w-auto" placeholderClassName="w-24" />
              )
            }
          />
        </ListCard>
      )}

      <ListCard title="Hlasové zprávy" count={voice.length || undefined} aside={voice.length === 0 && <span className="text-muted-foreground">Žádné</span>}>
        {voice.length > 0 &&
          voice.map((message) => {
            const uploader = helperUploadNote(people, message.uploadedBy);
            return (
              <li key={message.documentId} className="py-3 pr-5 pl-4">
                <VoicePlayer src={documentUrl(caseId, message.documentId)} seconds={message.seconds} seed={message.documentId} date={formatDateTime(message.uploadedAt)} />
                {uploader && <p className="mt-1 text-sm text-muted-foreground">{uploader}</p>}
              </li>
            );
          })}
      </ListCard>
    </>
  );
}
