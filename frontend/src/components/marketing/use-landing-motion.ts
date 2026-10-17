/** Scoped GSAP hero/scroll choreography with automatic cleanup and reduced-motion media queries. */
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP);

/** GSAP owns hero choreography and scroll storytelling, never demo UI transforms. */
export function useLandingMotion() {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia();
      media.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          gsap
            .timeline({ defaults: { duration: 0.65, ease: "power3.out" } })
            .from(
              ".sd-hero-reveal",
              { y: 12, opacity: 0.9, stagger: 0.06, clearProps: "transform,opacity" },
              0,
            )
            .from(
              ".sd-answer-composition",
              { y: 18, opacity: 0.35, clearProps: "transform,opacity" },
              0.12,
            )
            .from(".sd-source-paper", { y: 14, rotation: -2, clearProps: "transform" }, 0.2)
            .from(
              ".sd-evidence-highlight",
              { scaleX: 0, duration: 0.7, ease: "power2.inOut", clearProps: "transform" },
              0.45,
            )
            .from(
              ".sd-answer-paper",
              { y: 22, opacity: 0.3, clearProps: "transform,opacity" },
              0.75,
            );
          gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
            gsap.from(element, {
              y: 12,
              opacity: 0.9,
              duration: 0.75,
              ease: "power2.out",
              clearProps: "transform,opacity",
              scrollTrigger: { trigger: element, start: "top 94%", once: true },
            });
          });
          gsap.fromTo(
            ".sd-page-progress",
            { scaleX: 0 },
            {
              scaleX: 1,
              ease: "none",
              scrollTrigger: {
                trigger: scope.current,
                start: "top top",
                end: "bottom bottom",
                scrub: true,
              },
            },
          );
        },
        scope,
      );
      media.add(
        "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
        () => {
          const flow = gsap.timeline({
            scrollTrigger: {
              trigger: ".sd-workflow",
              start: "top 75%",
              end: "bottom 55%",
              scrub: 0.7,
            },
          });
          flow.fromTo(
            ".sd-flow-rail-fill",
            { scaleX: 0 },
            { scaleX: 1, ease: "none", duration: 3 },
            0,
          );
          flow.fromTo(
            ".sd-step-marker",
            { borderColor: "#d1e1f7", backgroundColor: "#edf4ff", color: "#356aa8" },
            {
              borderColor: "#2167e8",
              backgroundColor: "#2167e8",
              color: "#ffffff",
              duration: 0.3,
              stagger: 1,
            },
            0,
          );
        },
        scope,
      );
      return () => media.revert();
    },
    { scope },
  );
  return scope;
}
