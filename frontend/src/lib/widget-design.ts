/**
 * @file Versioned widget design contract used by Studio form controls, saved settings and the
 * shared backend renderer. Defaults fill older configurations without creating a second
 * preview implementation. Numeric/color/asset validation remains enforced by backend schemas
 * and the standalone widget.
 */

/**
 * Persisted design version 1: dimensions/offsets are CSS pixels, opening delay is seconds,
 * logo_path references a local validated PNG, and theme/identity/open_behavior are constrained
 * choices.
 */
export interface WidgetDesign {
  version: 1;
  width: number;
  height: number;
  launcher_size: number;
  position: "bottom-right" | "bottom-left";
  offset_x: number;
  offset_y: number;
  radius: number;
  theme: "light" | "dark" | "system";
  background_color: string;
  text_color: string;
  placeholder: string;
  subtitle: string;
  identity: "default" | "robot" | "custom";
  logo_path: string | null;
  logo_size: number;
  open_behavior: "closed" | "open" | "delayed";
  open_delay_seconds: number;
}

export const defaultDesign: WidgetDesign = {
  version: 1,
  width: 380,
  height: 560,
  launcher_size: 56,
  position: "bottom-right",
  offset_x: 20,
  offset_y: 20,
  radius: 16,
  theme: "light",
  background_color: "#f4f4f4",
  text_color: "#161616",
  placeholder: "Ask a question...",
  subtitle: "AI assistant",
  identity: "default",
  logo_path: null,
  logo_size: 32,
  open_behavior: "closed",
  open_delay_seconds: 5,
};
