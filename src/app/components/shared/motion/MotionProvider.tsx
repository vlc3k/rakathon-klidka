"use client";

import { MotionConfig } from "motion/react";
import { transition } from "@/lib/motion";

// Když má uživatel v systému omezený pohyb, posuny a přejezdy se vypnou.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={transition.enter}>
      {children}
    </MotionConfig>
  );
}
