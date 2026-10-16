/**
 * @file Presentation-only class composition shared by UI primitives. Keep Tailwind conflict
 * resolution here so callers can override defaults predictably without duplicating merge
 * rules.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine conditional class inputs with clsx, then resolve conflicting Tailwind utilities so a
 * caller-supplied visual override wins coherently.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
