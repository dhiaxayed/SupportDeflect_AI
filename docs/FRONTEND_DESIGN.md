# Frontend Design Reference

The shared visual reference is the original
[SupportDeflect_AI repository](https://github.com/dhiaxayed/SupportDeflect_AI),
commit 22e490e463daa61825ac8f530be63e06519c4147, and its
[deployed interface](https://supportdeflect-web.onrender.com/).
The reference source originally lived in learn-serve-main/learn-serve-main/src;
the maintained application now lives in frontend/src.

## Visual Boundaries

| Surface | Design ownership | Files |
|---|---|---|
| Landing | White/blue editorial layout, Instrument Sans, document-to-answer hero, factual features/plans and native widget demo | routes/index.tsx, landing.css, components/marketing/, components/marketing-widget-preview.tsx |
| Login and registration | White/blue responsive composition using the public font and unchanged form/session handlers | routes/login.tsx, routes/register.tsx, components/marketing/auth-shell.tsx |
| Customer workspace | Inter, original color tokens, rounded controls/cards, navigation and header | styles.css, components/app-sidebar.tsx, components/dashboard-header.tsx |
| New customer features | Same customer tokens and shared Card/Button/Input components | routes/dashboard.team.tsx, routes/dashboard.inbox.tsx, routes/dashboard.billing.tsx, routes/dashboard.settings.tsx |
| Widget Design Studio | Customer theme around the real shared renderer; no change to saved customer designs | routes/dashboard.widget.tsx, widget-studio.css, components/widget-preview.tsx |
| Super Admin | Same Inter font, brand tokens, rounded navigation/controls and chart palette; dense administrative layout | admin.css, routes/platform*.tsx, components/admin-ui.tsx, components/platform-overview.tsx |

Paths in the last column are relative to frontend/src.
Inter remains bundled locally for authenticated routes. Public routes preload locally hosted
Instrument Sans; neither surface requests Google Fonts or changes the other's font tokens.
Super Admin inherits styles.css tokens rather than maintaining a second theme.
Do not apply administrative layout rules globally to the customer workspace.

## Preserve Functional Improvements

Visual restoration is not a rollback of authentication, tenant isolation, endpoint contracts,
real metrics, local storage, email delivery or the widget configuration schema.
The header's document search actually filters the documents route; its inbox shortcut opens
the support inbox. Account security opens the real password-change workflow.

The landing embeds a byte-for-byte copy of `backend/app/static/widget.js`, preserving its
Shadow DOM, header, launcher, composer, source disclosure and human-support status. The copy
at `frontend/public/demo/widget/script.js` keeps the frontend Docker context self-contained;
`node scripts/sync-marketing-widget.mjs --check` rejects drift. The production renderer is
unchanged. The public iframe permits scripts/forms, has an opaque origin and cannot access
browser storage. Its parent validates message source/origin and supplies only local sample
answers. Three external sample-question controls submit the widget's native form; unknown
questions receive an explicit scripted-demo explanation. No API, LLM or real ticket is involved.
The authenticated Studio and customer embed retain their existing backend communication.

GSAP owns the one-shot hero reveal and scroll-connected workflow. Motion owns menu and
use-case transitions; native CSS handles hover/focus and the widget's own entrance. The hero
uses readable HTML with a highlighted source passage rather than WebGL. Reduced-motion
preferences disable the choreography. Section-five panels share one grid cell so switching
examples cannot collapse the layout. Mobile navigation is an overlay below the header.

Sparkle decorations are replaced with context-specific Lucide icons (support, analytics,
indexing and branding). The optional robot identity also uses the Lucide Bot line icon,
not an OS-dependent emoji; the existing saved `robot` value remains compatible.
The widget logo has a circular white backplate in both its launcher and header.
Custom images use object-fit: contain inside an inscribed square, preserving their complete
mark and aspect ratio. The official icon uses its existing optical margin, without changing
the brand asset. A failed custom image falls back to the same circular official identity.

Old unsupported marketing claims, fabricated testimonials and inactive actions were not restored.
Plan presentation comes from lib/subscription-plans.ts and reflects the implemented quotas.
Prices remain manually agreed with the administrator, not a fictional checkout.

## Verification

Run the commands in TESTING.md. Browser coverage includes:

- Public route stays public, official logo and locally loaded font, working login/register links.
- All three public pages at 320, 375, 390, 768, 1024, 1440 and 1920px.
- Native widget scenarios, typed input, source disclosure, color changes, reset and keyboard behavior without API/storage access.
- Automated WCAG AA checks for all public routes and a separate audit of the opaque iframe's actual Shadow DOM.
- Reduced-motion/no-canvas operation and stable use-case/demo/menu geometry.
- Eleven tenant routes at 1440px, 1024px, 768px, 390px and 320px, with screenshots and overflow checks.
- Eight administrative views, all three organization detail tabs, creation dialog and account security at the same five widths.
- Shared admin/customer theme token assertions, loaded Inter font and rounded active navigation.
- Default/robot identities at 40px and 88px, custom logo fit, persistence and independent client rendering.

The administrative navigation delegates active matching to the router, with an exact match
for the overview. Tables retain readable minimum widths inside local scroll containers;
positioned accessibility labels cannot expand the page. Status tints blend in sRGB to retain
their green, amber and red meanings when mixed with neutral theme colors.
- Working document search, inbox navigation, case assignment and human resolution.
- Existing administrative, invitation/SMTP and shared-renderer external-widget workflows.

Screenshots in evidence/ use only isolated fixture accounts. These are layout evidence,
not real customer activity or pixel-perfect snapshot assertions.
