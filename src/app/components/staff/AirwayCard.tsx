"use client";

import { useCaseLocked } from "@/app/components/shared/CaseLock";
import { useState } from "react";
import { DoneIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Button } from "@/components/ui/button";
import { ListCard } from "@/app/components/shared/ListCard";
import { SmoothImage } from "@/app/components/shared/LoadingStates";
import { AIRWAY_FINDINGS, type AirwayFinding } from "@/db/catalog";
import { api, documentUrl, errorMessage } from "@/lib/api/client";
import { useApi } from "@/lib/api/useApi";
import type { CaseDetail } from "@/lib/api/types";
import { formatFullDate } from "@/lib/date";
import { cn } from "@/lib/utils";

type Cls = 1 | 2 | 3 | 4;
type Photo = CaseDetail["airwayPhotos"][number];
type Assessment = NonNullable<CaseDetail["airwayAssessment"]>;

const ROMAN = ["I", "II", "III", "IV"] as const;
// Nálezy, které jdou posoudit jen z nepovinné fotky. Bez ní je lékař může zadat z jiného zdroje (videohovor, vyšetření).
const FINDING_NEEDS: Partial<Record<AirwayFinding, Photo["view"]>> = {
  prominent_incisors: "profile",
  receding_chin: "profile",
  limited_neck_extension: "extension",
};
const VIEW_LABEL = {
  front: "Ústa a jazyk",
  profile: "Z boku",
  extension: "Hlava zakloněná",
} as const;
// Modifikovaná Mallampatiho klasifikace (Samsoon a Young): co je vidět při otevřených ústech a vyplazeném jazyku.
const CLASS_TEXT: Record<Cls, string> = {
  1: "měkké patro, celý čípek, patrové oblouky",
  2: "měkké patro a čípek",
  3: "měkké patro a kořen čípku",
  4: "jen tvrdé patro",
};

// Fotky dýchacích cest od pacienta a hodnocení anesteziologa. Aplikace nic neodhaduje:
// kamera hlídala jen polohu, světlo a ostrost; třídu a nálezy zadává lékař a ukládá se, kdo a kdy.
export function AirwayCard({
  caseId,
  photos,
  assessment,
}: {
  caseId: string;
  photos: Photo[];
  assessment: Assessment | null;
}) {
  const locked = useCaseLocked();
  const [editing, setEditing] = useState(false);
  const front = photos.find((p) => p.view === "front");
  const others = photos.filter((p) => p.view !== "front");
  const meta = (front?.meta ?? {}) as { mouthRatio?: number | null };

  return (
    <ListCard
      title="Dýchací cesty"
      info="Pacient fotil doma s navedením kamery. Povinná je fotka úst s vyplazeným jazykem bez zvuku, profil a zakloněná hlava jsou nepovinné. Kamera hlídala jen polohu, světlo a ostrost. Třídu podle Mallampatiho a nálezy určuje anesteziolog. Mallampati sám předpovídá obtížnou intubaci jen středně, je to včasný signál, ne náhrada vyšetření."
      aside={
        photos.length === 0 && (
          <span className="text-muted-foreground">Fotky zatím nejsou</span>
        )
      }
    >
      {photos.length > 0 && (
        <li className="flex flex-col gap-6 p-5 lg:flex-row lg:items-start">
          <div className="flex flex-col gap-2 lg:w-64 lg:shrink-0">
            {front && <PhotoLink caseId={caseId} photo={front} large />}
            {others.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {others.map((p) => (
                  <PhotoLink key={p.view} caseId={caseId} photo={p} />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {front && `Vyfoceno ${formatFullDate(front.uploadedAt)}`}
              {typeof meta.mouthRatio === "number" &&
                ` · otevření úst ${Math.round(meta.mouthRatio * 100)} % výšky obličeje (orientačně)`}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {assessment && !editing ? (
              <Summary
                assessment={assessment}
                onEdit={locked ? undefined : () => setEditing(true)}
              />
            ) : locked ? (
              <p className="text-base text-muted-foreground">Nehodnoceno, zákrok je uzavřený.</p>
            ) : (
              <AssessmentForm
                caseId={caseId}
                initial={assessment}
                hasFront={!!front}
                views={photos.map((p) => p.view)}
                onDone={() => setEditing(false)}
              />
            )}
          </div>
        </li>
      )}
    </ListCard>
  );
}

function PhotoLink({
  caseId,
  photo,
  large = false,
}: {
  caseId: string;
  photo: Photo;
  large?: boolean;
}) {
  const url = documentUrl(caseId, photo.documentId);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      className="press flex flex-col gap-1"
    >
      <SmoothImage
        src={url}
        alt={`Pacient: ${VIEW_LABEL[photo.view]}`}
        className={cn("aspect-square w-full rounded-xl", large && "lg:w-64")}
        imgClassName="size-full object-cover"
      />
      <span className="text-xs text-muted-foreground">
        {VIEW_LABEL[photo.view]}
      </span>
    </a>
  );
}

function Summary({
  assessment,
  onEdit,
}: {
  assessment: Assessment;
  onEdit?: () => void;
}) {
  const cls = assessment.mallampati;
  const difficult = cls === 3 || cls === 4;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-2xl font-semibold tracking-tight">
          {cls ? `Mallampati ${ROMAN[cls - 1]}` : "Z fotek nelze hodnotit"}
        </p>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Změnit
          </button>
        )}
      </div>
      {cls && (
        <p className="text-sm text-muted-foreground">
          Vidět: {CLASS_TEXT[cls]}
        </p>
      )}
      {difficult && (
        <p className="flex items-start gap-2 text-sm font-medium text-amber-700">
          <WarningIcon className="mt-0.5 size-4 shrink-0" /> Možné obtížné
          zajištění dýchacích cest (hodnocení lékaře)
        </p>
      )}
      {assessment.findings.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {assessment.findings.map((f) => (
            <li key={f}>· {AIRWAY_FINDINGS[f as AirwayFinding] ?? f}</li>
          ))}
        </ul>
      )}
      {assessment.note && <p className="text-sm">{assessment.note}</p>}
      <p className="flex items-center gap-2 text-sm text-green-700">
        <DoneIcon className="size-4" /> Posoudil(a) {assessment.by ?? "AA"}
        {assessment.at && `, ${formatFullDate(assessment.at)}`}
      </p>
    </div>
  );
}

function AssessmentForm({
  caseId,
  initial,
  hasFront,
  views,
  onDone,
}: {
  caseId: string;
  initial: Assessment | null;
  hasFront: boolean;
  views: Photo["view"][];
  onDone: () => void;
}) {
  const detail = useApi(`/api/v1/cases/${caseId}`);
  const [cls, setCls] = useState<Cls | null | undefined>(
    initial ? initial.mallampati : undefined,
  );
  const [findings, setFindings] = useState<string[]>(initial?.findings ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggle = (f: string) =>
    setFindings((xs) =>
      xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f],
    );

  const save = async () => {
    if (cls === undefined) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/api/v1/cases/${caseId}/airway-assessment`, {
        mallampati: cls,
        findings,
        note: note.trim() || undefined,
      });
      await detail.reload();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Mallampati {hasFront ? "podle fotky úst" : ""}
        </span>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="radiogroup"
          aria-label="Mallampati"
        >
          {([1, 2, 3, 4] as Cls[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cls === c}
              onClick={() => setCls(c)}
              className={cn(
                "press flex flex-col items-center gap-1 rounded-xl p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                cls === c
                  ? "bg-foreground text-background"
                  : "bg-muted hover:bg-muted/70",
              )}
            >
              <ClassSketch cls={c} />
              <span className="font-semibold">{ROMAN[c - 1]}</span>
              <span
                className={cn(
                  "text-center text-xs leading-tight",
                  cls === c ? "text-background/70" : "text-muted-foreground",
                )}
              >
                {CLASS_TEXT[c]}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          role="radio"
          aria-checked={cls === null}
          onClick={() => setCls(null)}
          className={cn(
            "w-max text-sm underline-offset-4 hover:underline",
            cls === null ? "font-semibold" : "text-muted-foreground",
          )}
        >
          Z fotek nelze hodnotit
        </button>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Nálezy</legend>
        {(Object.entries(AIRWAY_FINDINGS) as [AirwayFinding, string][]).map(
          ([key, label]) => {
            const needs = FINDING_NEEDS[key];
            return (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={findings.includes(key)}
                  onChange={() => toggle(key)}
                />
                {label}
                {needs && !views.includes(needs) && (
                  <span className="text-xs text-muted-foreground">
                    {needs === "profile" ? "(chybí fotka z boku)" : "(chybí fotka se záklonem)"}
                  </span>
                )}
              </label>
            );
          },
        )}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Poznámka
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className="h-11 rounded-xl bg-muted px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          className="h-11 rounded-full px-6"
          disabled={cls === undefined || saving}
          onClick={save}
        >
          {saving ? "Ukládám…" : "Uložit hodnocení"}
        </Button>
        {initial && (
          <Button
            variant="secondary"
            className="h-11 rounded-full px-6"
            onClick={onDone}
            disabled={saving}
          >
            Zrušit
          </Button>
        )}
      </div>
    </div>
  );
}

// Schéma otevřených úst: čím vyšší třída, tím víc jazyk zakrývá patro, čípek a patrové oblouky.
function ClassSketch({ cls }: { cls: Cls }) {
  const tongueTop = { 1: 40, 2: 33, 3: 25, 4: 17 }[cls];
  return (
    <svg viewBox="0 0 64 52" className="h-12 w-16" aria-hidden>
      <ellipse
        cx="32"
        cy="26"
        rx="29"
        ry="23"
        fill="currentColor"
        opacity="0.08"
        stroke="currentColor"
        strokeOpacity="0.5"
      />
      {/* tvrdé a měkké patro */}
      <path
        d="M8 18 Q32 2 56 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 22 Q32 10 52 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.7"
      />
      {/* patrové oblouky */}
      <path
        d="M17 24 Q20 34 18 44"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.7"
      />
      <path
        d="M47 24 Q44 34 46 44"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.7"
      />
      {/* čípek */}
      <path d="M30 15 Q32 30 34 15" fill="currentColor" opacity="0.7" />
      {/* jazyk */}
      <path
        d={`M5 49 Q32 ${tongueTop - 10} 59 49 Z`}
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}
