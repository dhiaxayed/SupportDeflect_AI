# Browser Evidence

Browser assertions and representative captures were refreshed on 16 October 2026 by the
twelve passing Playwright scenarios. The earlier manual visual inspection is historical;
the current run verifies route rendering, theme, viewport bounds and functional assertions.
All organizations, revenue and questions shown here are isolated test fixtures, not real customers.
The widget screenshots use the explicit test-only LLM. Actual Groq was verified separately through
the real widget API, with local MiniLM and a temporary synthetic policy (see ../TESTING.md).
No password, token, invitation body or API key is included.

| Scenario | Desktop | Mobile |
|---|---|---|
| Administrative BI | [Overview](overview-desktop.png) | [Overview](overview-mobile.png) |
| Organization subscription | [Organization](admin-organization-desktop.png) | [Organization](admin-organization-mobile.png) |
| Administrative communications | [Communications](admin-communications-desktop.png) | [Communications](admin-communications-mobile.png) |
| Widget Design Studio | [Studio](studio-desktop.png) | [Studio](studio-mobile.png) |
| Independent hostile-CSS client site | [Embedded widget](client-desktop.png) | [Embedded widget](client-mobile.png) |
| Public landing page | [Landing](landing-desktop.png) | [Landing](landing-mobile.png) |
| Customer overview | [Overview](customer-overview-desktop.png) | [Overview](customer-overview-mobile.png) |
| Customer analytics | [Analytics](customer-analytics-desktop.png) | [Analytics](customer-analytics-mobile.png) |
| Support playground | [Playground](customer-playground-desktop.png) | [Playground](customer-playground-mobile.png) |
| Account settings | [Settings](customer-settings-desktop.png) | [Settings](customer-settings-mobile.png) |
| Subscription and usage | [Billing](customer-billing-desktop.png) | [Billing](customer-billing-mobile.png) |
| Team management | [Team](customer-team-desktop.png) | [Team](customer-team-mobile.png) |
| Support inbox | [Inbox](customer-inbox-desktop.png) | [Inbox](customer-inbox-mobile.png) |

Authentication screens: [login](login-desktop.png), [registration](register-desktop.png).
The customer visual reference and preserved functional contracts are documented in
[Frontend Design](../FRONTEND_DESIGN.md). All eleven tenant views are exercised at
1440, 1024, 768, 390 and 320 pixels, as are the eight administrative views and organization
detail tabs. This directory keeps a representative subset.

Widget identity details: [official mark at 40px](launcher-default-40.png),
[official mark at 88px](launcher-default-88.png), [line robot icon](launcher-robot-88.png),
and [saved default identity on the independent client](client-default.png).
Logos are contained in circular backplates; custom marks keep their full aspect ratio.

The full test also verifies saved configuration after reload, actual logo loading, source text,
support-case creation, scoped human reply after reload, notes remaining private and mobile bounds.
Screenshots supplement assertions; they do not prove Docker, VM deployment or actual customer revenue.
