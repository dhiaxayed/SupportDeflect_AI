/**
 * @file Authenticated password-replacement route shared by invited and existing users.
 * /auth/me determines whether the change is mandatory. The backend mutation revokes old
 * sessions, so successful replacement is followed by a fresh login; if that reauthentication
 * fails, the user is sent to sign-in without being asked to repeat an already successful
 * password change.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser, useLogout, useRequireAuth } from "@/hooks/use-auth";
import {
  apiRequest,
  homeForRole,
  login,
  logout as clearSession,
  SessionChangedError,
} from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/change-password")({ component: ChangePassword });
/**
 * Render account-loading/error states and the controlled password form outside tenant/platform
 * shells so mandatory invited-user replacement is always reachable.
 */
function ChangePassword() {
  const authenticated = useRequireAuth();
  const account = useCurrentUser();
  const { data: user } = account;
  const logout = useLogout();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  /**
   * Check confirmation and password reuse locally, submit the change, then establish a fresh
   * session/cache and role home. Distinguish mutation failure from later login failure to
   * avoid retrying with invalid old credentials.
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (password !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    if (password === current) {
      setError("Choose a different password.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: password }),
      });
      try {
        const result = await login(user.email, password);
        cache.clear();
        cache.setQueryData(["me"], result.user);
        void navigate({ to: homeForRole(result.user.role) });
      } catch (err) {
        if (err instanceof SessionChangedError) return;
        // The password mutation already succeeded; never ask to repeat it with invalid old credentials.
        clearSession();
        cache.clear();
        toast.success("Password changed. Sign in with your new password.");
        void navigate({ to: "/login" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setPending(false);
    }
  }
  if (account.isError)
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background">
        <section className="w-full max-w-md space-y-5">
          <BrandLogo imageClassName="h-9" />
          <h1 className="text-2xl font-medium">Account access unavailable</h1>
          <p role="alert" className="text-sm text-destructive">
            {account.error instanceof Error
              ? account.error.message
              : "Sign in again or ask your administrator to renew the invitation."}
          </p>
          <Button onClick={logout}>Back to sign in</Button>
        </section>
      </main>
    );
  if (!authenticated || !user)
    return (
      <div role="status" className="p-8">
        Loading account...
      </div>
    );
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <section className="w-full max-w-md p-8 rounded-xl border bg-card shadow-[var(--shadow-elegant)]">
        <BrandLogo imageClassName="h-9 mb-8" />
        <ShieldCheck className="text-primary mb-4" size={28} />
        <h1 className="text-2xl font-medium">
          {user.must_change_password ? "Set your own password" : "Change your password"}
        </h1>
        <p className="text-sm text-muted-foreground mt-3 mb-6">
          {user.must_change_password
            ? "Replace your initial password to activate access to your workspace."
            : "Changing your password signs out your other sessions."}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            Current password
            <Input
              className="mt-2"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            New password
            <Input
              className="mt-2"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Confirm new password
            <Input
              className="mt-2"
              type="password"
              required
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button disabled={pending} className="w-full">
            {pending ? "Updating..." : "Save new password"}
          </Button>
        </form>
        <button onClick={logout} className="text-sm text-muted-foreground mt-5 underline">
          Sign out
        </button>
      </section>
    </main>
  );
}
