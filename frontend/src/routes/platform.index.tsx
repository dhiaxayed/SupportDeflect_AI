/**
 * @file Platform landing-route adapter for PlatformOverview in business mode. Reporting
 * filters, server BI queries, revenue/usage charts and risk displays are centralized in the
 * reusable component.
 */

import { createFileRoute } from "@tanstack/react-router";
import { PlatformOverview } from "@/components/platform-overview";
export const Route = createFileRoute("/platform/")({ component: PlatformOverview });
