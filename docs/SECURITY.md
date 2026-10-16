# Security

## Identity and Tenant Boundaries

Authenticated routes reload the current active user, role, tenant and token version from the DB.
Resource lookups combine ID and org_id. Platform accounts have no tenant and cannot impersonate
one. Team mutations cannot create platform users. Self-deactivation/demotion is blocked.
Passwords are BCrypt hashes; input over 72 UTF-8 bytes is rejected instead of silently truncated.
Password/role/activity changes revoke previous versioned JWTs. Invitations expire in seven days
and force replacement before protected work. Bootstrap has no public HTTP endpoint.

Browser session JWTs are in localStorage. Logout clears local state but does not independently
revoke a copied token; password change or account deactivation does. XSS prevention remains
essential. MFA and a per-device session-management UI are not implemented.

The browser rejects authenticated responses if the stored session changes while the request or
JSON/CSV body decoding is pending. An old account's successful mutation therefore cannot refill
the next account's cache. Server-side tenant authorization remains the authority for each request.
Concurrent creation of the same email is resolved by the database uniqueness constraint and
translated to the existing HTTP 409 contract after rollback; incomplete organizations/outboxes
are not retained. Other database integrity failures retain their original failure path.

## Public Widget

Public company IDs are not credentials. Allowed-host policy checks required HTTP(S) Origin
on configuration/chat/case polling, including preflights. Empty allowlists deny access.
Configured hosts include their dot-delimited subdomains, not lookalike suffixes; ports are
not distinguished. Public script/logo assets are intentionally cacheable/public.
CORS is a browser restriction, not authenticated visitor identity. Rate limits and quotas are
additional controls, not a guarantee against every nonbrowser abusive caller.

Case replies use a separate audience-bound, organization/case-scoped signed capability with a
seven-day expiry. It is submitted in a POST body and cannot authenticate as an application user.
The response deliberately serializes only status and human answer, never notes or staff details.
Pending capabilities live in the customer's localStorage; scripts running on that same host are
part of the visitor's trust boundary. Shadow DOM provides CSS isolation, not a security sandbox
against a malicious embedding website.

Logo uploads accept decoded PNG/JPEG/WebP with byte/pixel limits and tenant ownership checks.
Files are re-encoded without metadata under random names; SVG and arbitrary external URLs are denied.

## Imports and Resource Limits

URL ingestion accepts only public HTTP(S) destinations, no credentials. Every redirect is
revalidated. DNS results must all be public. The HTTP request connects to a validated IP with the
original Host header and TLS SNI, closing the validation/second-DNS-lookup rebinding gap.
Environment proxies are disabled for this fetcher. Redirect count, timeout and streamed response
size are bounded; compressed URL responses are refused to avoid unbounded decompression.
Host-level egress policy remains useful defense in depth.

Imported source URLs are returned in visitor-visible citations, including their query strings.
Import public, non-token URLs; a private share URL is not made confidential by ingestion.

Uploads are bounded by plan/global size. Document, question and chunk admission serialize their
read/check/write transaction using PostgreSQL row locks or a SQLite write reservation. Question
reservations include in-flight generation and are released/consumed after the request. Manual
refunds serialize the remaining balance; payment/refund key races replay the committed winner.
SQLite concurrency has executable local coverage; PostgreSQL locking still needs its integration
environment. Pathological PDF parser CPU/memory remains a resource-isolation concern. Parsing
and inference run in API worker threads; this is not a hostile-file sandbox.
Deleted/nonindexed documents cannot participate in retrieval.

## Network and Secrets

Traefik is the sole host-published service. Its file provider does not mount the Docker socket.
Only its configured address is trusted for forwarded headers. TrustedHostMiddleware is enabled
in Compose. Networks are not an outbound firewall. HTTP is an isolated-lab baseline; the TLS
overlay is required for untrusted-network credentials and HTTPS-site embedding.
Mailpit UI has separate authentication and no outbound relay; remote email CSS/fonts are blocked.

Real .env, private certificates, data, logs and backups are ignored by Git and excluded from build
contexts. Use distinct random secrets. Keep PostgreSQL password URL-safe because Compose builds
the connection URL. Never publish expanded compose config, docker inspect environments or full
invitation captures. Validate with config --quiet.

## Mail, AI and Privacy

The database outbox encrypts invitation passwords and scrubs them after accepted delivery,
cancellation or expiry. The mailbox still contains the invitation, so protect its UI, data volume
and backups. The mailer has a separate long service token, claim leases and stable message IDs.
SMTP acknowledgement ambiguity is handled conservatively, not advertised as exactly-once delivery.
The worker refuses HTTP redirects on its authenticated internal API calls so proxy redirects
cannot forward its service token or invitation acknowledgement payload to another origin.
Invitation expiration also applies to an existing JWT, not only the login form. The initial
password grants only account inspection/password replacement until acceptance. User mutation and
invitation claims lock the member before changing or validating credentials on PostgreSQL.
The worker validates the invitation generation before decrypting it. Invalid ciphertext is
failed and scrubbed without blocking the entire queue. Private claim receipts permit identical
acknowledgement retries but reject conflicting results. Tenant-facing delivery metadata excludes
credentials, claim receipts, mail bodies and cross-tenant mailbox links.

Only selected tenant context and the question go to Groq. Prompt grounding/risk checks are
heuristics, not a proof against hallucination or prompt injection. Provider outages return an
explicit unavailable reason rather than creating a fictional missing-knowledge support case;
normal runtime rejects mock generation and fake embeddings. Local knowledge/logs/cases/mail
can contain personal data. Define retention/export/deletion policy before use with real customers.
Audit metadata excludes secrets and avoids copying human answers/private notes.
The same UTC safe formatter/redaction filter covers application and Uvicorn error/access
handlers. Uncaught exception logs retain types and call sites without exception values or source
code lines; sensitive access-query messages are redacted. SDK debug payload logging is restricted.

## Release Checks

Run authorization/tenant/capability tests, URL/upload tests, frontend and dependency audits,
container image scans and the target-VM restore drill. Local package checks are point-in-time
evidence, not a penetration-test certification. See AUDIT.md for exact outstanding proof gates.
