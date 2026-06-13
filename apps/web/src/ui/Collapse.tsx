import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/** Height-animated disclosure for progressive detail (reduced-motion safe). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
