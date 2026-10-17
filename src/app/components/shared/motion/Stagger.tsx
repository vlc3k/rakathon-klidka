"use client";

import { motion, stagger, type Variants } from "motion/react";
import { reveal } from "@/lib/motion";

const containers = {
  div: motion.div,
  ul: motion.ul,
  dl: motion.dl,
  nav: motion.nav,
};

const items = {
  div: motion.div,
  li: motion.li,
  section: motion.section,
};

const container = (delay: number): Variants => ({
  hidden: {},
  visible: { transition: { delayChildren: stagger(0.04, { startDelay: delay }) } },
});

// Celé bloky (karty, sekce) naskočí krátce po sobě. Děti musí být `StaggerItem`.
// Řádky uvnitř karty se zvlášť neanimují.
export function Stagger({
  as = "div",
  delay = 0,
  className,
  children,
}: {
  as?: keyof typeof containers;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const Element = containers[as];
  return (
    <Element className={className} variants={container(delay)} initial="hidden" animate="visible">
      {children}
    </Element>
  );
}

export function StaggerItem({
  as = "div",
  id,
  className,
  children,
}: {
  as?: keyof typeof items;
  // Kotva, na kterou odkazuje souhrn v detailu zákroku.
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const Element = items[as];
  return (
    <Element id={id} className={className} variants={reveal}>
      {children}
    </Element>
  );
}
