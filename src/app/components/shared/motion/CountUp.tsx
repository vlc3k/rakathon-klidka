"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { transition } from "@/lib/motion";

// Číslo naběhne od nuly ke své hodnotě. Jen pro velká čísla.
export function CountUp({ value, className }: { value: number; className?: string }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest));
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, transition.count);
    return () => controls.stop();
  }, [count, value, reduceMotion]);

  return (
    <span className={className}>
      <motion.span aria-hidden>{rounded}</motion.span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
