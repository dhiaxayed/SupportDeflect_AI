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
import { useIsClient } from "@/hooks/use-auth";

export function useDocuments() {
  const isClient = useIsClient();
  return useQuery<BackendDocument[]>({
    queryKey: ["documents"],
    queryFn: getDocuments,
    enabled: isClient && hasToken(),
    refetchInterval: (query) =>
      query.state.data?.some((document) => ["pending", "processing"].includes(document.status))
        ? 3000
        : false,
  });
}

export function useAnalytics() {
  const isClient = useIsClient();
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics", "summary"],
    queryFn: getAnalyticsSummary,
    enabled: isClient && hasToken(),
  });
}

export function useWidgetSettings() {
  const isClient = useIsClient();
  return useQuery<WidgetSettings>({
    queryKey: ["settings", "widget"],
    queryFn: getWidgetSettings,
    enabled: isClient && hasToken(),
  });
}

export function useSubscriptionUsage() {
  const isClient = useIsClient();
  return useQuery<SubscriptionUsage>({
    queryKey: ["settings", "subscription"],
    queryFn: getSubscriptionUsage,
    enabled: isClient && hasToken(),
  });
}
