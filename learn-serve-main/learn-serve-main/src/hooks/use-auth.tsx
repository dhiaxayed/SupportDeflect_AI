import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { hasToken, logout as apiLogout, me, type User } from "@/lib/api";

/** Returns true once the component has mounted on the client. */
export function useIsClient() {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  return isClient;
}

/** Redirects to /login when no auth token is present (client-side only). */
export function useRequireAuth() {
  const navigate = useNavigate();
  const isClient = useIsClient();
  useEffect(() => {
    if (isClient && !hasToken()) {
      navigate({ to: "/login" });
    }
  }, [isClient, navigate]);
  return isClient && hasToken();
}

/** Fetches the currently authenticated user. */
export function useCurrentUser() {
  const isClient = useIsClient();
  return useQuery<User>({
    queryKey: ["me"],
    queryFn: me,
    enabled: isClient && hasToken(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useLogout() {
  const navigate = useNavigate();
  return () => {
    apiLogout();
    navigate({ to: "/login" });
  };
}
