/** Public-route font preload metadata, separate from authenticated workspace typography. */
import fontUrl from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";

/** Preload only on public routes to avoid late font swaps and leave workspace fonts alone. */
export const publicFontLinks = [
  { rel: "preload", href: fontUrl, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
] as const;
