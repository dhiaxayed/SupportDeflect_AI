/**
 * @file Public plan descriptions used by the landing page and tenant subscription view. Limits
 * mirror backend subscription entitlements, while prices remain on-request because
 * organization fees are set manually by platform administration. This presentation list never
 * grants quotas.
 */

// Presentation of the plan limits defined by backend/app/services/subscriptions.py.
// Prices are negotiated per organization and must not be invented on public pages.
export const subscriptionPlans = [
  {
    name: "Starter",
    price: "On request",
    desc: "For teams getting started",
    features: [
      "2,000 questions / 30 days",
      "25 documents",
      "Widget branding",
      "Human support inbox",
    ],
    featured: false,
  },
  {
    name: "Pro",
    price: "On request",
    desc: "For growing support teams",
    features: ["25,000 questions / 30 days", "250 documents", "Usage analytics", "Widget branding"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    desc: "For larger knowledge bases",
    features: [
      "1,000,000 questions / 30 days",
      "10,000 documents",
      "Team access controls",
      "Manual subscription management",
    ],
    featured: false,
  },
];
