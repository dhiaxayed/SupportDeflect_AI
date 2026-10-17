/** Public experience only. Tenant queries are excluded; the widget demo uses local sample responses. */
import { createFileRoute } from "@tanstack/react-router";
import { LandingExperience } from "@/components/marketing/landing-experience";
import { publicFontLinks } from "@/components/marketing/public-font";
import "@/landing.css";

export const Route = createFileRoute("/")({
  /** Supply public SEO metadata and preload the local display font during SSR. */
  head: () => ({
    links: [...publicFontLinks],
    meta: [
      { title: "SupportDeflect AI — Your knowledge. Their next answer." },
      {
        name: "description",
        content:
          "Turn your documentation into grounded customer support. Connect your knowledge, customize your assistant, and keep your team in the loop.",
      },
    ],
  }),
  component: LandingExperience,
});
