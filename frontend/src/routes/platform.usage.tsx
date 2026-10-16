/**
 * @file Platform product-usage route reusing PlatformOverview with usage-focused presentation.
 * The underlying BI endpoint and duration/channel/currency filters stay centralized rather
 * than rebuilding aggregates in this adapter.
 */

import { createFileRoute } from "@tanstack/react-router";
import { PlatformOverview } from "@/components/platform-overview";
export const Route = createFileRoute("/platform/usage")({
  /**
   * Mount the shared platform dashboard in usage mode, keeping charts and filter/cache
   * behavior identical to the business view.
   */
  component: () => <PlatformOverview usage />,
});
