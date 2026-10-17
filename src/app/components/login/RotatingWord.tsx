"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Slovo v nadpisu se po chvíli vymění jako na odjezdové tabuli: písmena po sobě odjedou nahoru
// a nová přijedou zespodu, s krátkým rozostřením. Čtečka přečte jen první slovo,
// střídání je jen pro oko. Při omezeném pohybu zůstane první slovo.
export function RotatingWord({ words, interval = 2800, className }: { words: string[]; interval?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(timer);
  }, [reduce, words.length, interval]);

  const word = words[index];
  return (
    <span className={cn("relative inline-flex overflow-hidden py-2 -my-2", className)}>
      <span className="sr-only">{words[0]}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={word} className="inline-flex whitespace-pre" aria-hidden>
          {Array.from(word).map((char, i) => (
            <motion.span
              key={i}
              className="inline-block"
              initial={{ y: "110%", opacity: 0, filter: "blur(8px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)", transition: { duration: 0.6, ease, delay: 0.1 + i * 0.03 } }}
              exit={{ y: "-110%", opacity: 0, filter: "blur(8px)", transition: { duration: 0.35, ease, delay: i * 0.02 } }}
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
