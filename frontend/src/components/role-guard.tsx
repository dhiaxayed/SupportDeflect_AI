/**
 * @file Client rendering gate around tenant and platform route shells. Combine reactive token
 * presence with /auth/me so roles and required password changes come from the database. It
 * hides private descendants during loading/redirects and offers retry for recoverable account
 * failures; backend dependencies remain the authorization boundary.
 */

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCurrentUser, useRequireAuth } from "@/hooks/use-auth";
import { homeForRole, type User } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * Render children only for an authenticated allowed role with no pending password change.
 * Redirect other valid accounts to their permitted destination and preserve the token on
 * temporary account-service errors.
 */
export function RoleGuard({ roles, children }: { roles: User["role"][]; children: ReactNode }) {
  const authed = useRequireAuth();
  const query = useCurrentUser();
  const navigate = useNavigate();
  const user = query.data;
  const allowed = user && roles.includes(user.role) && !user.must_change_password;
  useEffect(() => {
    if (user?.must_change_password) void navigate({ to: "/change-password" });
    else if (user && !allowed) void navigate({ to: homeForRole(user.role) });
  }, [user, allowed, navigate]);
  if (authed && query.isError)
    return (
      <div className="p-8 space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  if (!authed || !allowed)
    return (
      <div role="status" className="p-8 text-sm">
        Loading account...
      </div>
    );
  return <>{children}</>;
}
