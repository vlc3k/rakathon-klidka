"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { QuestionIcon, WarningIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { AITag } from "@/app/components/shared/AITag";
import { DetailSection } from "@/app/components/shared/DetailSection";
import { ListCard, ListRow } from "@/app/components/shared/ListCard";
import { ConfirmAllButton, unverifyInformation, VerifyButton, verifyInformation } from "@/app/components/shared/VerifyButton";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/api/client";
import type { CaseProfile, LabRow, ProfileItem, Verification } from "@/lib/caseView";

const ANAMNESIS_PREVIEW = 5; // kolik položek anamnézy je vidět, než se rozbalí

// Co z dokumentů víme, rozdělené do karet: alergie, laboratoř, léky, anamnéza.
// Všechno načetla AI, dokud to ambulance (lékař nebo sestra) proti originálu nepotvrdí. Potvrzuje se každá položka
// zvlášť (kolečko u řádku, jde i odvolat), „Potvrdit vše“ v hlavičce karty potvrdí zbytek karty najednou.
export function ProfilePanel({
  caseId,
  profile,
  onShowSource,
  focus = null,
}: {
  caseId: string;
  profile: CaseProfile;
  onShowSource: (key: string, documentId: string) => void;
  focus?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const confirm = async (ids: string[]) => {
    setError(null);
    try {
      await verifyInformation(caseId, ids);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const revoke = async (ids: string[]) => {
    setError(null);
    try {
      await unverifyInformation(caseId, ids);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  // Karta, kde právě běží „Potvrdit vše“: její nepotvrzené položky točí spinner.
  const [savingCard, setSavingCard] = useState<string | null>(null);
  type Confirmable = { ids: string[]; verified: Verification | null };
  // Kolečko u položky. `what` je údaj ve 4. pádě pro text dialogu („Potvrdit penicilin?“).
  const check = (item: Confirmable, what: string, card: string) => (
    <VerifyButton
      variant="check"
      what={what}
      verified={item.verified}
      onConfirm={() => confirm(item.ids)}
      onRevoke={() => revoke(item.ids)}
      saving={savingCard === card && !item.verified}
    />
  );
  const confirmAll = (items: Confirmable[], card: string, title: string) => {
    const pending = items.filter((item) => !item.verified);
    return (
      pending.length > 1 && (
        <ConfirmAllButton
          count={pending.length}
          card={title}
          onConfirm={() => confirm(pending.flatMap((item) => item.ids))}
          onSavingChange={(saving) => setSavingCard(saving ? card : null)}
        />
      )
    );
  };

  const { allergies, meds, anamnesis, labs } = profile;
  const allergyItems: ProfileItem[] = profile.allergiesNoneItem ? [profile.allergiesNoneItem] : allergies.items;
  const labItems: Confirmable[] = labs.map((lab) => ({ ids: [lab.id], verified: lab.verified }));
  const everything: Confirmable[] = [...allergyItems, ...labItems, ...meds.items, ...anamnesis.items];
  const done = everything.filter((item) => item.verified).length;
  // Klik otevře zprávu, ze které údaj je. Když AI ví, kde přesně na fotce je, svítí tam.
  const showSource = (item: ProfileItem) => item.documentId && onShowSource(item.id, item.documentId);

  return (
    <DetailSection
      title="Vytěženo z dokumentů"
      info="Vytěžila AI z dokumentů, které patří pacientovi (sedí jméno a rodné číslo). Klikněte na hodnotu a ukáže se na originálu. Každou položku potvrzuje lékař nebo sestra zvlášť."
      aside={everything.length > 0 && <span className="whitespace-nowrap tabular-nums">Potvrzeno {done} z {everything.length}</span>}
    >
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive lg:col-span-2">
            {error}
          </p>
        )}

        <ListCard title="Alergie" badge={<AITag />} aside={confirmAll(allergyItems, "allergies", "Alergie")}>
          {!profile.allergiesNone && allergies.items.length > 0 ? (
            allergies.items.map((allergy) => (
              <SourceRow
                key={allergy.id}
                item={allergy}
                focused={focus === allergy.id}
                onPick={() => showSource(allergy)}
                icon={<WarningIcon className="size-5 shrink-0 text-red-600" />}
                label={<span className="font-semibold text-red-700">{allergy.text}</span>}
                trailing={check(allergy, `alergii ${allergy.text}`, "allergies")}
              />
            ))
          ) : profile.allergiesNoneItem ? (
            <SourceRow
              item={profile.allergiesNoneItem}
              focused={focus === profile.allergiesNoneItem.id}
              onPick={() => profile.allergiesNoneItem && showSource(profile.allergiesNoneItem)}
              label="Neguje"
              trailing={check(profile.allergiesNoneItem, "že pacient alergie neguje", "allergies")}
            />
          ) : (
            <ListRow
              icon={<QuestionIcon className="size-5 shrink-0 text-amber-600" />}
              label="Ve zprávách neuvedeno"
              sub="Zeptejte se pacienta na konzultaci."
            />
          )}
        </ListCard>

        <ListCard title="Laboratoř" badge={<AITag />} count={labs.length || undefined} aside={confirmAll(labItems, "labs", "Laboratoř")}>
          {labs.length === 0 ? (
            <ListRow label={<span className="text-muted-foreground">Žádné hodnoty</span>} />
          ) : (
            labs.map((lab) => (
              <LabItem
                key={lab.id}
                lab={lab}
                focused={focus === lab.id}
                onShowSource={() => lab.documentId && onShowSource(lab.id, lab.documentId)}
                verify={check({ ids: [lab.id], verified: lab.verified }, `${lab.label.toLowerCase()} ${displayValue(lab.value)}`, "labs")}
              />
            ))
          )}
        </ListCard>

        <ListCard title="Léky" badge={<AITag />} count={meds.items.length || undefined} aside={confirmAll(meds.items, "meds", "Léky")}>
          {meds.items.length === 0 ? (
            <ListRow icon={<QuestionIcon className="size-5 shrink-0 text-amber-600" />} label="Ve zprávách neuvedeny" />
          ) : (
            meds.items.map((med) => (
              <SourceRow
                key={med.id}
                item={med}
                focused={focus === med.id}
                onPick={() => showSource(med)}
                label={med.name}
                sub={med.dose && <span className="tabular-nums">{med.dose}</span>}
                trailing={check(med, `lék ${med.name}`, "meds")}
              />
            ))
          )}
        </ListCard>

        {anamnesis.items.length > 0 && (
          <Anamnesis
            items={anamnesis.items}
            focus={focus}
            onPick={showSource}
            check={(item) => check(item, item.text, "anamnesis")}
            confirmAll={confirmAll(anamnesis.items, "anamnesis", "Osobní anamnéza")}
          />
        )}
      </div>
    </DetailSection>
  );
}

const displayValue = (value: string) => value.replace("10^9", "10⁹");

// Řádek údaje ze zprávy, stejný jako na stránce dokumentu: celý řádek je tlačítko a najetí ho podbarví celý až
// k potvrzení (žádný podtržený text ani blok v bloku). Klik otevře zprávu, ze které údaj je, a když AI ví, kde přesně
// na fotce je, svítí tam. Vybraný má fialový proužek vlevo. Údaj bez zprávy (zadaný ručně) je jen text.
function SourceRow({
  item,
  focused,
  onPick,
  icon,
  label,
  sub,
  value,
  trailing,
}: {
  item: { documentId: string | null };
  focused: boolean;
  onPick: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  value?: React.ReactNode;
  trailing: React.ReactNode;
}) {
  const clickable = Boolean(item.documentId);
  const area = "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left";
  const content = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base wrap-anywhere">{label}</span>
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
      </span>
      {value}
    </>
  );
  return (
    <li className={cn("relative flex items-center gap-1 py-1 pr-2 pl-2 transition-colors duration-200 motion-safe:ease-smooth", focused ? "bg-ai/8" : clickable && "hover:bg-muted/60")}>
      {focused && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-ai" />}
      {clickable ? (
        <button type="button" onClick={onPick} title="Ukázat v dokumentu" className={cn(area, "press outline-none select-none focus-visible:ring-2 focus-visible:ring-ring")}>
          {content}
        </button>
      ) : (
        <div className={area}>{content}</div>
      )}
      {trailing}
    </li>
  );
}

// Hodnota vpravo velká, pod názvem datum odběru. Klik na řádek ji ukáže na originálu.
function LabItem({ lab, focused, onShowSource, verify }: { lab: LabRow; focused: boolean; onShowSource: () => void; verify: React.ReactNode }) {
  const uncertain = lab.check.status === "uncertain" && !lab.verified;
  const Arrow = lab.flag === "L" ? ArrowDown : ArrowUp;
  return (
    <SourceRow
      item={lab}
      focused={focused}
      onPick={onShowSource}
      label={lab.label}
      sub={
        <>
          <span className={cn("block", !lab.sampleDate && "text-amber-700")}>{lab.sampleDate ? `Odběr ${lab.sampleDate}` : "Bez data odběru"}</span>
          {uncertain && (
            <span className="flex items-start gap-1 text-amber-700">
              <QuestionIcon className="mt-0.5 size-4 shrink-0" />
              {lab.check.reasons.join(", ")}
            </span>
          )}
        </>
      }
      value={
        <span className={cn("flex shrink-0 items-center gap-1 text-lg font-semibold tabular-nums whitespace-nowrap", lab.flag && "text-red-700")}>
          {displayValue(lab.value)}
          {lab.flag && (
            <>
              <Arrow className="size-4" aria-hidden />
              <span className="sr-only">{lab.flag === "L" ? "pod normou" : "nad normou"}</span>
            </>
          )}
        </span>
      }
      trailing={verify}
    />
  );
}

// Dlouhá anamnéza se zkrátí na prvních pár řádků, zbytek po rozbalení.
function Anamnesis({
  items,
  focus,
  onPick,
  check,
  confirmAll,
}: {
  items: ProfileItem[];
  focus: string | null;
  onPick: (item: ProfileItem) => void;
  check: (item: ProfileItem) => React.ReactNode;
  confirmAll: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const visible = open ? items : items.slice(0, ANAMNESIS_PREVIEW);
  const hidden = items.length - visible.length;
  return (
    <ListCard title="Osobní anamnéza" badge={<AITag />} count={items.length} aside={confirmAll}>
      {visible.map((item) => (
        <SourceRow key={item.id} item={item} focused={focus === item.id} onPick={() => onPick(item)} label={item.text} trailing={check(item)} />
      ))}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="press flex min-h-12 w-full items-center px-5 text-base font-medium outline-none select-none hover:bg-muted/50 focus-visible:bg-muted"
          >
            Zobrazit další {hidden}
          </button>
        </li>
      )}
    </ListCard>
  );
}
