/**
 * @file Thin tenant file-route adapter for the reusable subscription Billing view. Plan
 * entitlements, expiry/usage presentation and manual-upgrade guidance stay in
 * subscription-usage.tsx; commercial mutations remain reserved for platform administration.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Billing } from "@/components/subscription-usage";

export const Route = createFileRoute("/dashboard/billing")({ component: Billing });
