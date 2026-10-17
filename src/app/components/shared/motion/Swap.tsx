"use client";

import { AnimatePresence, motion } from "motion/react";
import { transition } from "@/lib/motion";

// Když se změní `swapKey`, starý obsah rychle zmizí a nový se objeví.
// `instant`: nový obsah je v DOM hned (starý mizí nad ním), třeba když se k němu má hned přejet.
// Rodič pak potřebuje `relative`.
export function Swap({
  swapKey,
  className,
  instant = false,
  children,
}: {
  swapKey: string;
  className?: string;
  instant?: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence mode={instant ? "popLayout" : "wait"} initial={false}>
      <motion.div
        key={swapKey}
        className={className}
        initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: transition.quick }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
