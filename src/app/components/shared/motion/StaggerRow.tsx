"use client";

import { motion } from "motion/react";
import { rowIn } from "@/lib/motion";

// Řádek tabulky nebo seznamu, který při zobrazení rychle naskočí (`index` určí pořadí).
// Řádky přidané později (třeba po změně filtru) naskočí samy, přeřazené se nehýbou.
export function StaggerRow({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.li className={className} variants={rowIn} custom={index} initial="hidden" animate="visible">
      {children}
    </motion.li>
  );
}
