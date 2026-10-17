"use client";

import { useEffect } from "react";
import Image from "next/image";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ease } from "@/lib/motion";
import pacient from "@/public/brand/adam-pacient.webp";
import ambulance from "@/public/brand/adam-ambulance.webp";

// Stvoření Adama se štafetou (kampaň „Svůj úsek“): ruka ambulance podává kolík ze srolované zprávy,
// ruka pacienta se ho skoro dotýká. Fotka je rozdělená v mezeře mezi prstem a kolíkem na dvě vrstvy,
// které se za kurzorem od sebe a k sobě posouvají a samy jemně dýchají. Pod nimi křivky atletické
// dráhy, nad nimi čára s jedním úderem EKG přesně nad předávkou. Jen dekorace, bez pohybu při omezeném pohybu.

const LANES = [0, 1, 2, 3, 4, 5, 6];

export function AdamParallax({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const lanesX = useTransform(sx, (v) => v * -10);
  const lanesY = useTransform(sy, (v) => v * -6);
  const leftX = useTransform(sx, (v) => v * -8);
  const rightX = useTransform(sx, (v) => v * 8);
  const handsY = useTransform(sy, (v) => v * 8);

  // Kurzor sledujeme na celém okně: panel je pod textem a přihlášením, vlastní události by nedostal.
  useEffect(() => {
    if (reduce) return;
    const onMove = (event: PointerEvent) => {
      px.set((event.clientX / window.innerWidth - 0.5) * 2);
      py.set((event.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, px, py]);

  // Ruce se k sobě pomalu přiblíží a zase oddálí, mezera mezi prstem a kolíkem dýchá.
  const drift = reduce ? undefined : { duration: 5, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const };

  return (
    <div className={className} aria-hidden>
      {/* Křivky dráhy: zatáčka stadionu, bílé čáry s nízkou krytí */}
      <motion.svg style={{ x: lanesX, y: lanesY }} viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" className="absolute inset-[-6%] h-[112%] w-[112%]">
        {LANES.map((lane) => (
          <path key={lane} d={`M-50,${1080 - lane * 70} C 250,${980 - lane * 70} 520,${720 - lane * 60} ${880},${200 - lane * 40}`} fill="none" stroke="white" strokeOpacity={0.16} strokeWidth={3} />
        ))}
      </motion.svg>

      {/* Čára s úderem EKG přes celý panel nad rukama, úder přesně nad předávkou. Nakreslí se jednou při načtení. */}
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="absolute inset-x-0 bottom-[44%] h-[14%] w-full">
        <motion.path
          d="M0,120 L455,120 L470,128 L484,40 L500,190 L514,96 L526,120 L1000,120"
          fill="none"
          stroke="white"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.2, delay: 0.3, ease }}
          strokeOpacity={0.7}
        />
      </svg>

      {/* Pás s rukama: jedna fotka rozdělená v mezeře mezi prstem a kolíkem, obě poloviny ve stejném měřítku.
          Pás je širší než panel, ať jsou ruce velké; předloktí se ztratí za okrajem. */}
      <motion.div
        style={{ y: handsY }}
        className="absolute bottom-[6%] left-1/2 aspect-[2048/783] w-[150%] -translate-x-1/2 [mask-image:linear-gradient(transparent,black_16%,black_84%,transparent)]"
      >
        <motion.div style={{ x: leftX }} className="absolute inset-y-0 left-0 w-[44.5%]">
          <motion.div className="relative h-full w-full" animate={drift && { x: [0, 6] }} transition={drift}>
            <Image src={pacient} alt="" fill priority sizes="60vw" className="object-fill" />
          </motion.div>
        </motion.div>
        <motion.div style={{ x: rightX }} className="absolute inset-y-0 left-[44.5%] w-[55.5%]">
          <motion.div className="relative h-full w-full" animate={drift && { x: [0, -6] }} transition={drift}>
            <Image src={ambulance} alt="" fill priority sizes="70vw" className="object-fill" />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
