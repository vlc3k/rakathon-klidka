"use client";

import { motion } from "motion/react";
import { reveal } from "@/lib/motion";

const elements = {
  div: motion.div,
  section: motion.section,
  header: motion.header,
  aside: motion.aside,
  ul: motion.ul,
  nav: motion.nav,
};

// Prvek se při zobrazení jemně objeví.
export function Reveal({
  as = "div",
  delay = 0,
  className,
  children,
}: {
  as?: keyof typeof elements;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const Element = elements[as];
  return (
    <Element
      className={className}
      variants={reveal}
      custom={delay}
      initial="hidden"
      animate="visible"
    >
      {children}
    </Element>
  );
}
