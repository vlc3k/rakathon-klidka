"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/app/components/shared/InfoTip";
import { ActivitySkeleton } from "@/app/components/shared/LoadingStates";
import { ACTIVITY_CATEGORIES, activityLevel, activityWeeks, categoryOf, type ActivityCategory } from "@/lib/activity";
import { useApi } from "@/lib/api/useApi";
import type { ActivityEvent, CaseActivity } from "@/lib/api/types";
import { daysWord, eventsWord } from "@/lib/plural";
import { cn } from "@/lib/utils";

// Záložka Aktivita v detailu zákroku: kalendář ve stylu GitHubu (GET /api/v1/cases/:caseId/activity).
// Sloupec je týden od pondělí, čtvereček den s číslem dne. Čím tmavší, tím víc se ten den stalo (nahrání, zobrazení,
// čtení AI, potvrzení, úkoly…). Korálový den je naplánovaný zákrok. Najetí ukáže, co se ten den stalo,
// klepnutí den vybere a vypíše pod kalendářem (na telefonu hover není). Filtr vpravo nahoře (rozbalovací nabídka) barví jen jeden druh.

type Filter = ActivityCategory | "all";

const LONG_DATE = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("cs-CZ", { month: "long", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);
// Jak daleko je den od dneška: „dnes“, „včera“, „za 12 dní“, „před 3 dny“.
const relative = (day: string, today: string) => {
  const diff = Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
  if (diff === 0) return "dnes";
  if (diff === 1) return "zítra";
  if (diff === -1) return "včera";
  return diff > 0 ? `za ${diff} ${daysWord(diff)}` : `před ${-diff} dny`;
};
const longDate = (day: string) => {
  const text = LONG_DATE.format(dayDate(day));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Síla barvy dne: prázdný den světlý, pak inkoust od 15 % do plné. Na tmavých dnech je číslo bílé.
const LEVEL = ["bg-muted", "bg-primary/15", "bg-primary/35", "bg-primary/65", "bg-primary"] as const;
const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export function ActivityCalendar({ caseId }: { caseId: string }) {
  const { data, error, reload } = useApi<CaseActivity>(`/api/v1/cases/${caseId}/activity`, { refreshMs: 30_000 });
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);

  if (error && !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-background p-6">
        <p className="text-base">{error.message}</p>
        <Button variant="secondary" className="h-11 rounded-full px-5" onClick={() => reload()}>
          Zkusit znovu
        </Button>
      </div>
    );
  }
  if (!data) return <ActivitySkeleton />;

  // Na začátku poslední den, kdy se něco stalo (nebo dnešek).
  const day = picked ?? data.events[0]?.day ?? data.today;
  return (
    <div className="flex flex-col gap-8">
      <Calendar data={data} filter={filter} onFilter={setFilter} selected={day} onSelect={setPicked} />
      <DayDetail data={data} filter={filter} day={day} />
    </div>
  );
}

type Hover = { day: string; left: number; top: number; below: boolean };

function Calendar({
  data,
  filter,
  onFilter,
  selected,
  onSelect,
}: {
  data: CaseActivity;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  selected: string;
  onSelect: (day: string) => void;
}) {
  const weeks = useMemo(() => activityWeeks(data.from, data.to), [data.from, data.to]);
  const days = useMemo(() => weeks.flat(), [weeks]);
  const counts = useMemo(() => countByDay(data.events), [data.events]);
  const total = (day: string) => (filter === "all" ? (counts.get(day)?.total ?? 0) : (counts.get(day)?.[filter] ?? 0));
  const max = Math.max(0, ...days.map(total));
  const shown = days.reduce((sum, day) => sum + total(day), 0);

  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focusDay, setFocusDay] = useState(selected);

  // Na úzké obrazovce se kalendář posouvá: dnešek zhruba do dvou třetin, ať je vidět i cesta až k zákroku.
  useEffect(() => {
    const el = scroller.current;
    const today = el?.querySelector<HTMLElement>(`[data-day="${data.today}"]`);
    if (!el || !today || el.scrollWidth <= el.clientWidth) return;
    const offset = today.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    el.scrollLeft = Math.max(0, offset - el.clientWidth * 0.65);
  }, [data.today]);

  const showTip = (target: HTMLElement) => {
    const day = target.dataset.day;
    if (!day) return;
    const rect = target.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150);
    const below = rect.top < 200;
    setHover({ day, left, top: below ? rect.bottom + 8 : rect.top - 8, below });
  };

  // Šipky mezi dny (nahoru a dolů den, doleva a doprava týden), do kalendáře se tabulátorem vchází jednou.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = days[days.indexOf(focusDay) + step];
    if (!next) return;
    setFocusDay(next);
    const cell = scroller.current?.querySelector<HTMLElement>(`[data-day="${next}"]`);
    cell?.focus();
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <section aria-labelledby="aktivita" className="flex flex-col gap-5 rounded-2xl bg-background p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 id="aktivita" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {shown} {eventsWord(shown)}
          <InfoTip>
            Všechno, co se v zákroku stalo, po dnech: co pacient nahrál a viděl, co přečetla AI, co ambulance potvrdila a úkoly. Korálový den je naplánovaný
            zákrok.
          </InfoTip>
        </h2>
        <Filters data={data} filter={filter} onFilter={onFilter} />
      </div>

      <div className="flex gap-2" onMouseLeave={() => setHover(null)}>
        {/* Dny v týdnu stojí mimo posuvnou část, takže zůstanou vlevo, i když se kalendář na telefonu posune. */}
        <div aria-hidden className="flex shrink-0 flex-col gap-1 pt-8 text-xs text-muted-foreground">
          {WEEKDAYS.map((label) => (
            <span key={label} className="flex h-9 items-center">
              {label}
            </span>
          ))}
        </div>
        <div ref={scroller} className="scrollbar-none -mr-4 min-w-0 overflow-x-auto py-1 pr-4 sm:-mr-6 sm:pr-6 lg:-mr-8 lg:pr-8">
          <div role="group" aria-label="Aktivita po dnech" onKeyDown={onKeyDown} className="flex w-fit gap-1">
            {weeks.map((week, w) => {
              // Název měsíce nad týdnem, ve kterém měsíc začíná (a nad prvním týdnem).
              const month = w === 0 ? week[0] : week.find((day) => day.endsWith("-01"));
              return (
                <div key={week[0]} className="flex flex-col gap-1">
                  <span aria-hidden className="h-6 w-9 overflow-visible text-sm whitespace-nowrap text-muted-foreground">
                    {month ? MONTH.format(dayDate(month)) : ""}
                  </span>
                  {week.map((day) => {
                    const count = total(day);
                    const surgery = data.surgery?.date === day;
                    const future = day > data.today;
                    const level = activityLevel(count, max);
                    return (
                      <button
                        key={day}
                        type="button"
                        data-day={day}
                        tabIndex={day === focusDay ? 0 : -1}
                        aria-pressed={day === selected}
                        aria-label={`${day === data.today ? "Dnes, " : ""}${longDate(day)}: ${count} ${eventsWord(count)}${surgery ? ", naplánovaný zákrok" : ""}`}
                        onClick={() => (onSelect(day), setFocusDay(day))}
                        onMouseEnter={(event) => showTip(event.currentTarget)}
                        onFocus={(event) => showTip(event.currentTarget)}
                        onBlur={() => setHover(null)}
                        className={cn(
                          "relative flex size-9 shrink-0 items-center justify-center rounded-md text-xs tabular-nums outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          // Proběhlé dny jsou plné, nadcházející jen čárkovaný obrys: hned je vidět, kde je dnešek.
                          surgery
                            ? "bg-brand-dot font-semibold text-white"
                            : future
                              ? "border border-dashed border-foreground/25 text-muted-foreground"
                              : level >= 3
                                ? cn(LEVEL[level], "text-primary-foreground")
                                : level > 0
                                  ? cn(LEVEL[level], "text-foreground")
                                  : "bg-muted text-muted-foreground",
                          day === data.today && "font-bold",
                          day === selected && "outline-2 outline-offset-2 outline-foreground",
                        )}
                      >
                        {Number(day.slice(8))}
                        {/* Dnešek: tečka pod číslem jako v kalendáři na iPhonu. Funguje na světlém i tmavém dni a nesplývá s výběrem (obrys). */}
                        {day === data.today && (
                          <span aria-hidden className={cn("absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full", level >= 3 || surgery ? "bg-primary-foreground" : "bg-foreground")} />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Legend surgery={data.surgery !== null} />
      {hover && <DayTip hover={hover} data={data} />}
    </section>
  );
}

// Filtr druhu událostí jako rozbalovací nabídka: tlačítko s vybraným druhem a počtem, v nabídce všechny druhy
// s počty (prázdné se nenabízí), vybraný má fajfku. Filtr přebarví kalendář a zúží seznam dne.
function Filters({ data, filter, onFilter }: { data: CaseActivity; filter: Filter; onFilter: (filter: Filter) => void }) {
  const count = (category: ActivityCategory) => data.events.filter((event) => categoryOf(event.type) === category).length;
  const options: { id: Filter; label: string; count: number; hint?: string }[] = [
    { id: "all", label: "Vše", count: data.events.length },
    ...ACTIVITY_CATEGORIES.map((category) => ({ id: category.id, label: category.label, count: count(category.id), hint: category.hint })).filter((option) => option.count > 0),
  ];
  const current = options.find((option) => option.id === filter) ?? options[0];
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Druh událostí: ${current.label}`}
        className="press flex h-11 items-center gap-2 rounded-full bg-muted px-4 text-sm font-medium outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted/70"
      >
        <span className="font-normal text-muted-foreground">Zobrazit:</span>
        {current.label}
        <span className="font-normal text-muted-foreground tabular-nums">{current.count}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="flex min-w-60 origin-(--transform-origin) flex-col rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none motion-safe:transition motion-safe:duration-150 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.RadioGroup value={filter} onValueChange={(value) => onFilter(value as Filter)}>
              {options.map((option) => (
                <Menu.RadioItem
                  key={option.id}
                  value={option.id}
                  title={option.hint}
                  className="flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-base outline-none select-none data-highlighted:bg-muted"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <Menu.RadioItemIndicator>
                      <Check className="size-4 text-primary" strokeWidth={2.5} />
                    </Menu.RadioItemIndicator>
                  </span>
                  <span className="flex-1">{option.label}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">{option.count}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Legend({ surgery }: { surgery: boolean }) {
  return (
    <div aria-hidden className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        Méně
        {LEVEL.map((level) => (
          <span key={level} className={cn("size-3 rounded-sm", level)} />
        ))}
        Více
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-foreground/40" />
        Nadcházející
      </span>
      {surgery && (
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-brand-dot" />
          Zákrok
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="relative size-3 rounded-sm bg-muted">
          <span className="absolute bottom-0.5 left-1/2 size-0.5 -translate-x-1/2 rounded-full bg-foreground" />
        </span>
        Dnes
      </span>
    </div>
  );
}

// Bublina nad dnem: datum, zákrok a kdo co udělal, po lidech („Pacient: Jana Nová“, pod tím Nahrání 2 · Zobrazení 1).
// Vždy všechny druhy, filtr mění jen barvu kalendáře.
function DayTip({ hover, data }: { hover: Hover; data: CaseActivity }) {
  const surgery = data.surgery?.date === hover.day ? data.surgery : null;
  const people = byPerson(data.events.filter((event) => event.day === hover.day));
  return (
    <div
      role="tooltip"
      style={{ left: hover.left, top: hover.top }}
      className={cn(
        "pointer-events-none fixed z-50 flex w-80 -translate-x-1/2 flex-col gap-3 rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10",
        !hover.below && "-translate-y-full",
      )}
    >
      <div>
        <p className="text-base font-semibold">{longDate(hover.day)}</p>
        <p className="text-muted-foreground">{hover.day > data.today ? `Nadcházející, ${relative(hover.day, data.today)}` : relative(hover.day, data.today)}</p>
      </div>
      {surgery && (
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-1 size-3 shrink-0 rounded-sm bg-brand-dot" />
          <div>
            <p className="font-medium">Naplánovaný zákrok</p>
            {surgery.procedureName && <p className="text-muted-foreground">{surgery.procedureName}</p>}
          </div>
        </div>
      )}
      {people.map((person) => (
        <div key={person.key} className="flex flex-col gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <p>
            <span className="text-muted-foreground">{person.role}</span>
            {person.name && <span className="font-medium">: {person.name}</span>}
          </p>
          <p className="text-muted-foreground">{person.counts.map(({ label, count }) => `${label} ${count}`).join(" · ")}</p>
        </div>
      ))}
      {!surgery && people.length === 0 && <p className="text-muted-foreground">{hover.day > data.today ? "Zatím nic naplánováno" : "Nic se nestalo"}</p>}
    </div>
  );
}

// Kdo událost udělal: role slovem a jméno. Bez člověka je to systém (AI dočetla dokument, úkol se splnil nahráním).
const ROLE: Record<string, string> = { patient: "Pacient", helper: "Pomocník z rodiny", aa: "Lékař" };
function actorOf(event: ActivityEvent) {
  return event.actor ? { role: ROLE[event.actor.role] ?? "Uživatel", name: event.actor.displayName } : { role: "Systém", name: null };
}

// Události dne po lidech: nejdřív pacient a rodina, pak lékaři, nakonec systém. U každého kolik čeho.
function byPerson(events: ActivityEvent[]) {
  const people = new Map<string, { key: string; role: string; name: string | null; order: number; counts: Map<ActivityCategory, number> }>();
  for (const event of events) {
    const { role, name } = actorOf(event);
    const key = `${role}|${name ?? ""}`;
    const person = people.get(key) ?? { key, role, name, order: ["Pacient", "Pomocník z rodiny", "Lékař"].indexOf(role) + 1 || 9, counts: new Map() };
    const category = categoryOf(event.type);
    person.counts.set(category, (person.counts.get(category) ?? 0) + 1);
    people.set(key, person);
  }
  return [...people.values()]
    .sort((a, b) => a.order - b.order)
    .map((person) => ({
      ...person,
      counts: ACTIVITY_CATEGORIES.filter((category) => person.counts.has(category.id)).map((category) => ({ label: category.label, count: person.counts.get(category.id)! })),
    }));
}

// Vybraný den pod kalendářem: zákrok a události od nejnovější, s časem a kdo to udělal.
function DayDetail({ data, filter, day }: { data: CaseActivity; filter: Filter; day: string }) {
  const surgery = data.surgery?.date === day ? data.surgery : null;
  const list = data.events.filter((event) => event.day === day && (filter === "all" || categoryOf(event.type) === filter));
  return (
    <section aria-labelledby="vybrany-den" className="flex flex-col gap-3">
      <h2 id="vybrany-den" className="flex flex-wrap items-baseline gap-x-3 text-xl font-semibold tracking-tight">
        {longDate(day)}
        <span className="text-sm font-normal text-muted-foreground">
          {relative(day, data.today)} · {list.length} {eventsWord(list.length)}
        </span>
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-background">
        {surgery && (
          <Row marker={<span className="size-3 rounded-sm bg-brand-dot" />} title="Naplánovaný zákrok" sub={surgery.procedureName ?? "Výkon neuveden"} />
        )}
        {list.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
        {!surgery && list.length === 0 && (
          <li className="flex min-h-14 items-center px-5 py-3 text-base text-muted-foreground">{day > data.today ? "Na tento den nic naplánovaného" : "Tento den se nic nestalo"}</li>
        )}
      </ul>
    </section>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const category = ACTIVITY_CATEGORIES.find((c) => c.id === categoryOf(event.type))!;
  const { role, name } = actorOf(event);
  return (
    <Row
      marker={<span className="text-sm text-muted-foreground tabular-nums">{TIME.format(new Date(event.at))}</span>}
      title={event.summary}
      sub={`${category.label} · ${name ? `${role}: ${name}` : role}`}
    />
  );
}

function Row({ marker, title, sub }: { marker: React.ReactNode; title: string; sub: string }) {
  return (
    <li className="flex min-h-14 items-center gap-4 px-5 py-3">
      <span className="flex w-11 shrink-0 items-center">{marker}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{sub}</span>
      </span>
    </li>
  );
}

type DayCount = Record<ActivityCategory, number> & { total: number };

function countByDay(events: ActivityEvent[]) {
  const counts = new Map<string, DayCount>();
  for (const event of events) {
    const count = counts.get(event.day) ?? { total: 0, upload: 0, view: 0, ai: 0, data: 0, task: 0, other: 0 };
    count.total += 1;
    count[categoryOf(event.type)] += 1;
    counts.set(event.day, count);
  }
  return counts;
}
