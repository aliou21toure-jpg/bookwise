import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server rendering and before hydration, true afterwards. Submit buttons stay
 * disabled until React handles the form, so an early click can never fall back to a native
 * submission (which would put form fields such as the password into the URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
