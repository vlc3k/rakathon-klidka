import { cn } from "@/lib/utils";

// Ikony značky Klidka: tenká inkoustová linka (currentColor) a v každé ikoně jeden korálový detail,
// stejně jako tečka v logu. Korál je jen doplněk, ikona se čte i bez něj (např. při vynucených barvách).
// Jen dekorace vedle textu: aria-hidden, význam nese popisek.

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-6 shrink-0", className)}
      aria-hidden
    >
      {children}
    </svg>
  );
}

// Korálový detail lze vypnout třídou `[--icon-accent:currentColor]`: kde ikona nese stav (zelené „v pořádku“),
// má být celá v barvě stavu, jinak by korál vedle zelené četl jako chyba.
const ACCENT = "var(--icon-accent, var(--brand-dot))";

/** Vyfotit: fotoaparát, korálový blesk */
export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
      <circle cx="17.5" cy="9.5" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Zpráva od lékaře: papír s korálovým zvýrazněným řádkem */
export function ReportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 12.5h6" stroke={ACCENT} strokeWidth={2.5} />
      <path d="M9 16h4" />
    </Icon>
  );
}

/** Odběr krve: kapka, spodek korálový */
export function DropIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5c3.5 4.2 6 7.6 6 10.7a6 6 0 0 1-12 0c0-3.1 2.5-6.5 6-10.7z" />
      <path d="M8.6 15.2a3.6 3.6 0 0 0 6.8 0z" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Podpis souhlasu: pero a korálová klikatice */
export function SignIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 4.5l5 5-8 8H6.5v-5z" />
      <path d="M3.5 20.5c1.5-1.5 2.5-1.5 3.5 0s2 1.5 3.5 0 2.5-1.5 3.5 0" stroke={ACCENT} />
    </Icon>
  );
}

/** Ukázat pusu: úsměv s korálovým jazykem */
export function MouthIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10c2.5 6.5 13.5 6.5 16 0" />
      <path d="M4 10c4.5-1.5 11.5-1.5 16 0" />
      <path d="M10 14.2c0 2 1 3.3 2 3.3s2-1.3 2-3.3" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Zavolat: sluchátko s korálovými vlnami */
export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 6 1.5 1.5 0 0 1 5 4.5z" />
      <path d="M15 4.5a5 5 0 0 1 4.5 4.5M15 7.5a2 2 0 0 1 1.5 1.5" stroke={ACCENT} />
    </Icon>
  );
}

/** Poslat rodině: dva lidé, korálové srdce mezi nimi */
export function FamilyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="7.5" r="2.5" />
      <path d="M3 19.5c0-3 2-5 4.5-5s4.5 2 4.5 5M12 19.5c0-3 2-5 4.5-5s4.5 2 4.5 5" />
      <path d="M12 13.2l-1.2-1.1a.9.9 0 0 1 1.2-1.3.9.9 0 0 1 1.2 1.3z" fill={ACCENT} stroke={ACCENT} strokeWidth={1.2} />
    </Icon>
  );
}

/** Nemám ho: papír s korálovým otazníkem */
export function MissingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h8l4 4v13H6z" strokeDasharray="2.5 2.5" />
      <path d="M10.3 11a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4" stroke={ACCENT} />
      <circle cx="12" cy="16.6" r="0.6" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Štafetový kolík (srolovaná zpráva) s korálovými čárami pohybu: předáno */
export function BatonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 17.5l9-9a2.1 2.1 0 0 1 3 3l-9 9a2.1 2.1 0 0 1-3-3z" />
      <path d="M10 16l3 3" />
      <path d="M3.5 13.5h4M2.5 17h3.5M4.5 9.5h3" stroke={ACCENT} />
    </Icon>
  );
}

/** Hlasová zpráva: mikrofon s korálovou vlnou */
export function VoiceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
      <path d="M2.5 9.5v4M21.5 9.5v4" stroke={ACCENT} />
    </Icon>
  );
}

/** Zákrok: kalendář s korálovým dnem */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <circle cx="15.5" cy="15" r="1.6" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Hotovo: kroužek s fajfkou, fajfka korálová */
export function DoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 12.3l2.6 2.6 5-5.3" stroke={ACCENT} strokeWidth={2.25} />
    </Icon>
  );
}

/** Čekáme: přerušovaný kroužek, korálová tečka uprostřed (ještě nehotovo) */
export function WaitingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3.2" />
      <circle cx="12" cy="12" r="1.3" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Nahrát: přihrádka a šipka nahoru, korálový hrot */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 15V4.5" />
      <path d="M7.5 9L12 4.5 16.5 9" stroke={ACCENT} />
    </Icon>
  );
}

/** Stáhnout: přihrádka a šipka dolů, korálový hrot */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 4.5V15" />
      <path d="M7.5 10.5L12 15l4.5-4.5" stroke={ACCENT} />
    </Icon>
  );
}

/** Pozor: trojúhelník s vykřičníkem, korálová tečka */
export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v3.8" />
      <circle cx="12" cy="16.6" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Doplnit: kroužek s vykřičníkem, korálová tečka */
export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v4.8" />
      <circle cx="12" cy="15.9" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Vysvětlení: kroužek s „i“, korálová tečka nahoře */
export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2" />
      <circle cx="12" cy="7.9" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Nejisté: kroužek s otazníkem, korálová tečka */
export function QuestionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.8-.9 1.4v.3" />
      <circle cx="12" cy="16.4" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Člověk: hlava a ramena, korálová tečka jako v logu */
export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
      <circle cx="18.5" cy="5.5" r="1" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Upravit pacienta: člověk a korálová tužka */
export function UserEditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.6 2.9-6 6.5-6 1.2 0 2.3.3 3.2.8" />
      <path d="M14.5 20.5v-2l4.8-4.8a1.4 1.4 0 0 1 2 2l-4.8 4.8z" stroke={ACCENT} />
    </Icon>
  );
}

/** Upravit: list a tužka, korálová objímka tužky */
export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 4.5H6a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h11.5a2 2 0 0 0 2-2v-5" />
      <path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
      <path d="M15.5 5.5l3 3" stroke={ACCENT} />
    </Icon>
  );
}

/** Hledat / lupa: korálový odlesk ve skle */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
      <path d="M7.8 9.2a3 3 0 0 1 2.2-2" stroke={ACCENT} />
    </Icon>
  );
}

/** Vytisknout: tiskárna, korálový řádek na papíru */
export function PrintIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 9V4.5h10V9" />
      <path d="M6.5 17.5H5a1.5 1.5 0 0 1-1.5-1.5v-5.5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 1-1.5 1.5h-1.5" />
      <path d="M7 14h10v6H7z" />
      <path d="M9.5 17h5" stroke={ACCENT} />
    </Icon>
  );
}

/** Videohovor: kamera, korálová tečka nahrávání */
export function VideoCallIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2" />
      <path d="M15.5 10.5l5-3v9l-5-3" />
      <circle cx="7" cy="10" r="1" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Přečíst si: otevřená kniha, korálová záložka */
export function BookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6.5c-2-1.5-4.8-2-8-1.8v13c3.2-.2 6 .3 8 1.8 2-1.5 4.8-2 8-1.8v-13c-3.2-.2-6 .3-8 1.8zM12 6.5v13" />
      <path d="M15.5 5.4v4.8l1.4-1 1.4 1V4.9" stroke={ACCENT} />
    </Icon>
  );
}

/** Od AI: jiskra, malé korálové plus vedle */
export function SparkleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3.5c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6z" />
      <path d="M18 15.5v4M16 17.5h4" stroke={ACCENT} />
    </Icon>
  );
}

/** Odhlásit: dveře a šipka ven, korálový hrot */
export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4M10 12h10" />
      <path d="M16.5 8.5L20 12l-3.5 3.5" stroke={ACCENT} />
    </Icon>
  );
}

/** Vyšetření: psací podložka, korálový klip */
export function ClipboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 5.5H7A1.5 1.5 0 0 0 5.5 7v12A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 17 5.5h-1.5" />
      <path d="M9 12h6M9 15.5h4" />
      <rect x="8.5" y="3.5" width="7" height="3.5" rx="1" stroke={ACCENT} />
    </Icon>
  );
}

/** Srdce: obrys, korálový odlesk */
export function HeartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19.5s-7.5-4.4-7.5-9.5a4 4 0 0 1 7.5-2 4 4 0 0 1 7.5 2c0 5.1-7.5 9.5-7.5 9.5z" />
      <path d="M7.5 9.6a1.9 1.9 0 0 1 1.6-1.6" stroke={ACCENT} />
    </Icon>
  );
}

/** Zobrazit: oko, korálová zornice */
export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="1.1" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Vybrat z galerie: dvě fotky, korálové slunce */
export function ImagesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.5h11.5a2 2 0 0 1 2 2V15" />
      <rect x="3.5" y="8" width="13" height="11.5" rx="2" />
      <path d="M3.5 17l4-4 3.5 3.5 2-2 3.5 3.5" />
      <circle cx="12.5" cy="11.5" r="1.1" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Smazat: koš, korálové víko */
export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5" />
      <path d="M6 6.5l1 12a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9l1-12M10 10.5v6M14 10.5v6" />
      <path d="M4 6.5h16" stroke={ACCENT} />
    </Icon>
  );
}

/** Čas / čeká se: hodiny, korálová hodinová ručička */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12" />
      <path d="M12 12l3 2" stroke={ACCENT} />
    </Icon>
  );
}

/** Nemocniční systém: dva moduly serveru, korálová kontrolka */
export function ServerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="7" rx="1.75" />
      <rect x="4" y="13" width="16" height="7" rx="1.75" />
      <path d="M7.5 7.5h4M7.5 16.5h4" />
      <circle cx="16.5" cy="7.5" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Nastavení: dva posuvníky, jeden korálový jezdec */
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="9" cy="17" r="2" />
      <circle cx="15" cy="7" r="2" stroke={ACCENT} />
    </Icon>
  );
}

/** Přehled: seznam řádků, první odrážka korálová */
export function ListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 7h11M9 12h11M9 17h11" />
      <circle cx="4.75" cy="12" r="0.9" fill="currentColor" />
      <circle cx="4.75" cy="17" r="0.9" fill="currentColor" />
      <circle cx="4.75" cy="7" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Banka (BankID): budova se sloupy, korálová tečka ve štítu */
export function BankIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 9.5L12 4l8.5 5.5zM6 12.5v4.5M10 12.5v4.5M14 12.5v4.5M18 12.5v4.5M3.5 20h17" />
      <circle cx="12" cy="7.6" r="0.9" fill={ACCENT} stroke={ACCENT} />
    </Icon>
  );
}

/** Ověřit obličej: rámeček skenu, korálový úsměv */
export function FaceScanIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
      <path d="M9.5 9.5v1M14.5 9.5v1" />
      <path d="M9.5 14.5a3.5 3.5 0 0 0 5 0" stroke={ACCENT} />
    </Icon>
  );
}

/** Sbalit boční panel: okno s pruhem vlevo, korálová šipka doleva */
export function SidebarCloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9 4.5v15" />
      <path d="M15.5 9.5 13 12l2.5 2.5" stroke={ACCENT} strokeWidth={2} />
    </Icon>
  );
}

/** Rozbalit boční panel: okno s pruhem vlevo, korálová šipka doprava */
export function SidebarOpenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9 4.5v15" />
      <path d="M13 9.5l2.5 2.5-2.5 2.5" stroke={ACCENT} strokeWidth={2} />
    </Icon>
  );
}
