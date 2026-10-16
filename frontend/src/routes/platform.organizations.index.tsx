/**
 * @file Platform directory-route adapter for OrganizationDirectory. Search/filter/pagination
 * and workspace creation live in the shared directory component, which is also reused for
 * subscription-oriented presentation.
 */

import { createFileRoute } from "@tanstack/react-router";
import { OrganizationDirectory } from "@/components/organization-directory";
export const Route = createFileRoute("/platform/organizations/")({
  component: OrganizationDirectory,
});
