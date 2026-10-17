"use client";

import { SidebarCloseIcon, SidebarOpenIcon } from "@/app/components/shared/icons/KlidkaIcons";
import { SIDEBAR_KEY } from "@/lib/sidebar";

// Sbalit a rozbalit boční panel. Stav nedrží React, ale atribut na <html> (lib/sidebar.ts), takže ho skript
// nastaví už před vykreslením. Proto dvě tlačítka a CSS ukáže to, které právě platí.
export function SidebarToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const closing = root.dataset.sidebar !== "closed";
    if (closing) root.dataset.sidebar = "closed";
    else delete root.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, closing ? "closed" : "open");
    } catch {
      // Bez úložiště (anonymní okno) se panel jen nezapamatuje.
    }
  };
  const button =
    "press size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <>
      <button type="button" onClick={toggle} aria-label="Sbalit panel" aria-controls="sidebar" aria-expanded className={`${button} flex collapsed:hidden`}>
        <SidebarCloseIcon className="size-5" />
      </button>
      <button type="button" onClick={toggle} aria-label="Rozbalit panel" aria-controls="sidebar" aria-expanded={false} className={`${button} hidden collapsed:flex`}>
        <SidebarOpenIcon className="size-5" />
      </button>
    </>
  );
}
