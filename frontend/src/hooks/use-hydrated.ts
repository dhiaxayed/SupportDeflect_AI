/**
 * @file Single hydration boundary shared by browser-dependent forms and hooks. React uses the
 * false server snapshot for SSR/hydration and the true client snapshot after handlers attach;
 * this prevents interactive-looking forms from accepting input too early.
 */

import { useSyncExternalStore } from "react";

/**
 * Supply the no-op external-store subscription required by React; hydration itself changes the
 * snapshot, so no browser listener is needed.
 */
const subscribe = () => () => {};

// SSR forms must not accept input before React has attached their handlers.
/**
 * Return false for server rendering and true once React uses the client snapshot; callers gate
 * browser APIs or interactive controls with this value.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
