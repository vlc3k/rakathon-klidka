import type { Transition, Variants } from "motion/react";

// Jedna křivka pro celou aplikaci: rychlý start, dlouhé jemné dobrzdění.
// Stejná je v CSS jako `ease-smooth` (app/globals.css).
export const ease = [0.16, 1, 0.3, 1] as const;

export const transition = {
  // Prvek přichází na obrazovku.
  enter: { duration: 0.4, ease },
  // Odezva na akci uživatele (výběr, přepnutí).
  quick: { duration: 0.18, ease },
  // Zvýraznění přejíždí mezi položkami.
  slide: { type: "spring", visualDuration: 0.3, bounce: 0 },
  // Číslo nebo ukazatel nabíhá ke své hodnotě.
  count: { duration: 0.8, ease },
} satisfies Record<string, Transition>;

// Vyjede o 8 px a zaostří se. Filtr se po dojetí zruší,
// jinak by rozbil `position: fixed` u potomků.
export const reveal: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { ...transition.enter, delay },
    transitionEnd: { filter: "none" },
  }),
};

// Řádek seznamu nebo tabulky: jen 4 px a bez rozostření, ať je to svižné.
// Řádky naskočí po sobě s krokem 20 ms, od 10. řádku už bez čekání.
export const rowIn: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease, delay: Math.min(index, 10) * 0.02 },
  }),
};
