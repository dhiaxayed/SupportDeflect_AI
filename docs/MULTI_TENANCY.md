# Multi-Tenancy

One platform serves many organizations. A tenant is an Organization, not a separate Compose stack.

## Ownership

Documents, vector chunks, conversations, ingestion jobs, support cases and tenant users carry
org_id. The widget uses a public company_id solely to find the organization and its origin policy.
Authenticated tenant endpoints derive organization from the current database user.
Public company IDs are identifiers, not authorization tokens.

## Access Matrix

| Operation | Super Admin | Tenant Admin | Support Agent | Visitor |
|---|---|---|---|---|
| Platform aggregate/plan/status/audit/health | yes | no | no | no |
| Documents, Playground, analytics, settings | no | own org | no | no |
| Team list | no | own org | own org | no |
| Team create/update/deactivate | no | own org | no | no |
| Inbox list/detail/assign/note/resolve | no | own org | own org | no |
| Widget settings/chat | via public origin policy | via public origin policy | via public origin policy | approved origin |

Platform admins have null org_id and are not implicit members of any tenant.
A tenant user cannot promote anyone to platform admin or select a different org_id.

## Enforcement

- Reusable role dependencies are in backend/app/deps.py.
- Resource lookup combines ID with org_id before reading or mutating.
- Assignment requires an active support user from the case's organization.
- Retrieval filters org_id before similarity ranking; deletion also filters tenant/document IDs.
- The case's conversation is created by the same tenant-scoped transaction.
- Frontend caches are cleared on authentication changes.
- Audit scope distinguishes tenant actions from platform operations.

Application-level scoping is the main boundary; the database does not implement RLS.
Composite cross-table tenant foreign keys are not universally present, so direct SQL access
must remain restricted to operators. New API paths must always enforce ownership.

## Verification

Fast tests create two tenants and exercise foreign document, case, team and assignment denial.
The separate pgvector integration test inserts identical vectors for two tenants and verifies
that similarity retrieval returns only the requested organization's row.
A mock/memory test alone is not proof of real PostgreSQL vector isolation.
