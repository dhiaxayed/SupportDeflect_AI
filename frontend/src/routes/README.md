# Routes

TanStack Start generates the route tree from this directory. Do not edit
`src/routeTree.gen.ts` manually. The application shell is `__root.tsx`.

| Route files | URLs / responsibility |
|---|---|
| `index.tsx` | Public landing at /, independent of authentication |
| `login.tsx`, `register.tsx` | Login and organization registration |
| `change-password.tsx` | Mandatory initial password replacement |
| `dashboard.tsx`, `dashboard.*.tsx` | Tenant layout, knowledge, Studio, analytics, team and Inbox |
| `platform.tsx`, `platform.*.tsx` | Super Admin layout, business, organizations, billing, mail, audit and health |
| `platform.organizations.$id.tsx` | Organization detail selected by its internal ID |

RoleGuard restricts navigation, while the backend independently enforces authorization and
organization ownership. Browser guards do not replace API security.

Reusable views and primitives live in `src/components/`; API contracts and transport live in
`src/lib/`; React Query and authentication hooks live in `src/hooks/`.
Keep one canonical route for each screen, and reuse the shared widget renderer for Studio
instead of introducing a separate visual implementation.
