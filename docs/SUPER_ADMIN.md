# Super Admin

## Access

Sign in at /login; a database role of super_admin opens /platform.
Tenant registration cannot grant this role. Bootstrap on the configured deployment:

```bash
docker compose exec backend python scripts/create_super_admin.py
```

For native development, run python scripts/create_super_admin.py from backend with its virtual
environment. The command securely prompts, hashes the password, creates org_id=NULL and audits
creation. Existing platform credentials stay unchanged; an existing tenant email is never promoted.
There is no default password or public bootstrap endpoint.

## Workspace

| View | Real operations |
|---|---|
| Business overview | MRR/ARR, collected revenue, question volume, trends, status/plan mix, operational risks |
| Organizations | Search/filter/page; create organization and administrator invitation; edit metadata/plan/fees; archive/restore |
| Organization detail | Usage, subscription state, billing information, administrative notes and period adjustment with reason |
| Subscriptions | Trial/active/expired/suspended review, explicit period extensions/reductions |
| Revenue & payments | Manual receipts, capped linked refunds, currency/period filters, CSV export |
| Communications | One/all organization audience preview, idempotent campaign queue, automations, delivery status and retry |
| Usage | Real database aggregates, no synthetic production chart series |
| System health | Database/vector/provider checks and failed ingestion job retry |
| Audit | Filtered actor/action/organization history |

The workspace uses the same SupportDeflect AI brand as the landing and customer application:
locally bundled Inter, shared blue accents, soft neutral surfaces and rounded controls.
Charts use the shared semantic palette. The administrative layout remains compact and
data-focused; it does not override the global theme or change business permissions.

## Business Semantics

MRR is current contracted monthly fees, not cash received. ARR annualizes it. Cash metrics use
recorded payments minus refunds; currencies are kept separate. The ledger records externally
received funds; clicking Record payment does not charge a bank card.
Archive is reversible deletion that preserves financial and audit history.
Subscription extensions require a reason and update the actual enforced expiry.

Invitations send a temporary password, expire after seven days and require replacement.
Password/role/activity changes invalidate old versioned JWTs. The local mail baseline displays
captured status and delivers only into Mailpit, not Gmail. The sender alias is configured with SMTP_FROM.
External SMTP would require an explicitly authorized exception to the current local-only rule.

Platform metadata and aggregates do not grant unrestricted access to tenant document bodies
or impersonation. Recovery and host administration remain trusted operator responsibilities.
