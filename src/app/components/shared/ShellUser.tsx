"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { LogoutIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { Bone } from "@/app/components/shared/LoadingStates";
import { useLogout } from "@/app/components/shared/Session";
import { useApi } from "@/lib/api/useApi";
import type { Session } from "@/lib/api/types";
import { cn } from "@/lib/utils";

// Položka menu účtu (i pro položky navíc přes `extra`).
export const MENU_ITEM = "flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-base outline-none select-none data-disabled:opacity-50 data-highlighted:bg-muted";

// Přihlášený člověk v liště (jméno a role). Klik otevře menu: kdo je přihlášený a Odhlásit.
// V bočním panelu celý řádek (ve sbaleném jen avatar), v horní liště na telefonu avatar. Session sdílí s SessionGate (stejná cesta, jeden požadavek).
// Pacient (bílý podklad, jméno z useSession, nic nenačítá): `patient` v horní liště na desktopu avatar se jménem,
// `dock` ve spodní liště na telefonu velký avatar a menu nahoru. `extra`: další položky menu nad Odhlásit.
export function ShellUser({
  role,
  variant,
  name: known,
  extra,
}: {
  role: string;
  variant: "sidebar" | "bar" | "patient" | "dock";
  name?: string;
  extra?: React.ReactNode;
}) {
  const { data } = useApi<Session>(known === undefined ? "/api/auth/session" : null);
  const { logout, busy } = useLogout();
  const name = known ?? data?.displayName ?? "";

  return (
    <Menu.Root>
      {variant === "dock" ? (
        <Menu.Trigger
          aria-label="Profil a odhlášení"
          className="press flex size-14 items-center justify-center rounded-full outline-none select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted/60"
        >
          <Avatar name={name} muted large />
        </Menu.Trigger>
      ) : variant === "patient" ? (
        <Menu.Trigger
          aria-label="Účet a odhlášení"
          className="press -mr-1 flex h-11 items-center gap-2 rounded-full p-1 outline-none select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted/60 lg:pr-3"
        >
          <Avatar name={name} muted />
          <span className="hidden max-w-48 truncate text-base font-medium lg:block">{name}</span>
          <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground lg:block" />
        </Menu.Trigger>
      ) : variant === "bar" ? (
        <Menu.Trigger
          aria-label="Účet a odhlášení"
          className="press -mr-1 flex size-11 items-center justify-center rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar name={name} />
        </Menu.Trigger>
      ) : (
        <Menu.Trigger className="press mt-auto flex w-full items-center gap-3 rounded-xl p-1.5 text-left outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted collapsed:justify-center">
          <Avatar name={name} />
          <span className="min-w-0 flex-1 collapsed:hidden">
            {name ? <span className="block truncate text-sm font-medium">{name}</span> : <Bone className="my-1 h-3.5 w-28" />}
            <span className="block truncate text-sm text-muted-foreground">{role}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground collapsed:hidden" />
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Positioner side={variant === "sidebar" || variant === "dock" ? "top" : "bottom"} align={variant === "sidebar" ? "start" : "end"} sideOffset={8} className="z-50">
          <Menu.Popup className="flex w-64 origin-(--transform-origin) flex-col rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none motion-safe:transition motion-safe:duration-150 motion-safe:ease-smooth data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <div className="flex flex-col px-3 py-2">
              <span className="truncate text-base font-medium">{name}</span>
              <span className="truncate text-sm text-muted-foreground">{role}</span>
            </div>
            <Menu.Separator className="mx-1.5 my-1 h-px bg-border" />
            {extra}
            <Menu.Item
              onClick={() => void logout()}
              disabled={busy}
              className={MENU_ITEM}
            >
              <LogoutIcon className="size-5" />
              Odhlásit
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// Iniciály v kolečku. Jen ozdoba: jméno nese tlačítko kolem. `muted`: šedé kolečko na bílém podkladu (pacient).
function Avatar({ name, muted = false, large = false }: { name: string; muted?: boolean; large?: boolean }) {
  const initials = name
    .split(" ")
    .filter((word) => !word.endsWith("."))
    .slice(-2)
    .map((word) => word[0])
    .join("");

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium",
        large ? "size-12 text-base" : "size-9 text-sm",
        muted ? "bg-muted" : "bg-background lg:bg-muted",
        // Než se jméno načte, kolečko jemně pulzuje jako ostatní kostry.
        !name && "text-transparent motion-safe:animate-pulse",
      )}
    >
      {initials}
    </span>
  );
}
