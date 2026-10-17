/** Shared public Motion boundary with locally hosted Instrument Sans and user motion preferences. */
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";
import "@fontsource-variable/instrument-sans";

/** Public routes own their motion configuration; authenticated UI is unaffected. */
export function PublicMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
