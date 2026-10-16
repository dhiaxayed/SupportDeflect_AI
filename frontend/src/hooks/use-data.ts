/**
 * @file Tenant React Query hooks sharing stable keys with upload, chat and settings mutations.
 * Browser hydration/token gates delay requests until authentication is available; subscription
 * data additionally requires the current tenant-admin role. Poll only data whose underlying
 * asynchronous work needs refresh.
 */

import { useQuery } from "@tanstack/react-query";
import {
  getAnalyticsSummary,
  getDocuments,
  getSubscriptionUsage,
  getWidgetSettings,
  hasToken,
  type AnalyticsSummary,
  type BackendDocument,
  type SubscriptionUsage,
  type WidgetSettings,
} from "@/lib/api";
import { useCurrentUser } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Read tenant document metadata and poll while at least one ingestion is queued or processing;
 * terminal results stop automatic polling.
 */
export function useDocuments() {
  const isClient = useHydrated();
  return useQuery<BackendDocument[]>({
    queryKey: ["documents"],
    queryFn: getDocuments,
    enabled: isClient && hasToken(),
    /**
     * Continue three-second document refreshes only while background ingestion can still
     * change a visible status.
     */
    refetchInterval: (query) =>
      query.state.data?.some((document) => ["pending", "processing"].includes(document.status))
        ? 3000
        : false,
  });
}

/**
 * Refresh tenant conversation aggregates every thirty seconds so Playground and Inbox activity
 * becomes visible in reports.
 */
export function useAnalytics() {
  const isClient = useHydrated();
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics", "summary"],
    queryFn: getAnalyticsSummary,
    refetchInterval: 30000,
    enabled: isClient && hasToken(),
  });
}

/**
 * Read the saved widget configuration under the same key that Studio updates after a
 * successful save.
 */
export function useWidgetSettings() {
  const isClient = useHydrated();
  return useQuery<WidgetSettings>({
    queryKey: ["settings", "widget"],
    queryFn: getWidgetSettings,
    enabled: isClient && hasToken(),
  });
}

/**
 * Fetch quotas for hydrated tenant administrators only; support agents and super admins do not
 * use tenant billing entitlements.
 */
export function useSubscriptionUsage() {
  const isClient = useHydrated();
  const { data: user } = useCurrentUser();
  return useQuery<SubscriptionUsage>({
    queryKey: ["settings", "subscription"],
    queryFn: getSubscriptionUsage,
    refetchInterval: 30000,
    enabled: isClient && hasToken() && user?.role === "tenant_admin",
  });
}
