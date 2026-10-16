/**
 * @file Platform subscription listing reusing the same OrganizationDirectory query and account
 * links as the general organization list. Subscription mode changes visible commercial columns
 * and expiry filters without introducing a second source of account state.
 */

import { createFileRoute } from "@tanstack/react-router";
import { OrganizationDirectory } from "@/components/organization-directory";
export const Route = createFileRoute("/platform/subscriptions")({
  /**
   * Mount the shared directory in subscription mode so commercial filters/columns reuse the
   * established organization workflow.
   */
  component: () => <OrganizationDirectory subscriptions />,
});
