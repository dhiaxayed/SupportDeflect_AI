/**
 * @file React authentication subscriptions connecting browser token events to route guards and
 * React Query. Hydration gates prevent server renders from assuming a browser session. Roles
 * and invitation requirements come from /auth/me; clearing a token alone is not treated as
 * proof of server authorization.
 */

import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { getToken, subscribeSession, logout as apiLogout, me, type User } from "@/lib/api";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Subscribe to token changes and redirect hydrated anonymous views to /login. Return whether
 * the client currently has a token so protected components can withhold private content.
 */
export function useRequireAuth() {
  const navigate = useNavigate();
  const isClient = useHydrated();
  const token = useSyncExternalStore(subscribeSession, getToken, () => null);
  useEffect(() => {
    if (isClient && !token) {
      navigate({ to: "/login" });
    }
  }, [isClient, navigate, token]);
  return isClient && Boolean(token);
}

/**
 * Load the current server-resolved account under the shared me key; poll every minute, reuse
 * fresh results for five minutes and expose failures without retry loops.
 */
export function useCurrentUser() {
  const isClient = useHydrated();
  const token = useSyncExternalStore(subscribeSession, getToken, () => null);
  return useQuery<User>({
    queryKey: ["me"],
    queryFn: me,
    enabled: isClient && Boolean(token),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 60000,
    retry: false,
  });
}

/**
 * Return a click handler that clears the shared token and every cached query before navigating
 * to sign-in, preventing tenant data from surviving logout.
 */
export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return () => {
    apiLogout();
    queryClient.clear();
    navigate({ to: "/login" });
  };
}
