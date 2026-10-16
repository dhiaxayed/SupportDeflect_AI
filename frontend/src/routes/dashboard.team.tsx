/**
 * @file Thin tenant route registration for the shared Team component. Member roles,
 * invitations, activation and delivery-state behavior are implemented once in
 * team-management.tsx under the administrator-only dashboard guard.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Team } from "@/components/team-management";

export const Route = createFileRoute("/dashboard/team")({ component: Team });
