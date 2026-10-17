"use client";

import { motion, useReducedMotion } from "motion/react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Korálová čára, která doběhne do tečky jako v logu: pohyb štafety (kampaň „Svůj úsek“).
// S `blip` má uprostřed jeden úder EKG, třeba u „Předáno“. Jen ozdoba, čtečka ji přeskočí.
// Kreslí se zleva doprava a pak naskočí tečka; s omezeným pohybem je hned celá.
const BLIP = "M0 8 H7 L10 2 L14 14 L17 8 H24";

export function RelayLine({ blip = false, delay = 0, className }: { blip?: boolean; delay?: number; className?: string }) {
  const still = useReducedMotion() ?? false;
  const draw = (at: number, duration: number) => (still ? { duration: 0 } : { duration, ease, delay: delay + at });
  const grow = still ? false : { scaleX: 0 };

  return (
    <span className={cn("flex h-4 items-center", className)} aria-hidden>
      <motion.span className="h-0.5 flex-1 origin-left rounded-full bg-brand-dot" initial={grow} animate={{ scaleX: 1 }} transition={draw(0, 0.5)} />
      {blip && (
        <>
          <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0 overflow-visible text-brand-dot" fill="none">
            <motion.path
              d={BLIP}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={still ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={draw(0.45, 0.3)}
            />
          </svg>
          <motion.span className="h-0.5 w-1/4 shrink-0 origin-left rounded-full bg-brand-dot" initial={grow} animate={{ scaleX: 1 }} transition={draw(0.7, 0.25)} />
        </>
      )}
      <motion.span
        className="ml-1 size-2 shrink-0 rounded-full bg-brand-dot"
        initial={still ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={draw(blip ? 0.9 : 0.45, 0.25)}
      />
    </span>
  );
}
