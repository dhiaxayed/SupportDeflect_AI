/**
 * @file Public sign-in form using the shared API session workflow. Inputs stay disabled until
 * React hydration attaches handlers; successful authentication clears prior queries, seeds the
 * authoritative account and chooses the required password-change or role-specific destination.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useHydrated } from "@/hooks/use-hydrated";
import { useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/marketing/auth-shell";
import { publicFontLinks } from "@/components/marketing/public-font";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, homeForRole } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/login")({
  /**
   * Set the sign-in document title while retaining root metadata and asset links.
   */
  head: () => ({ meta: [{ title: "Log in — SupportDeflect AI" }], links: [...publicFontLinks] }),
  component: Login,
});

/**
 * Own sign-in draft/pending state and accessible credential fields; surface API errors without
 * navigating into a protected workspace.
 */
function Login() {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  /**
   * Exchange submitted credentials, reset account-specific caches and seed the returned user
   * before navigation. On failure retain the draft and re-enable the form.
   */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      queryClient.clear();
      queryClient.setQueryData(["me"], result.user);
      navigate({
        to: result.user.must_change_password ? "/change-password" : homeForRole(result.user.role),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to sign in");
      setLoading(false);
    }
  };

  return (
    <AuthShell mode="login">
      <span className="sd-auth-form-eyebrow sd-mono">PICK UP WHERE YOU LEFT OFF</span>
      <h1>Welcome back</h1>
      <p className="sd-auth-description">Log in to your workspace to manage your assistant.</p>
      <form onSubmit={onSubmit}>
        <fieldset disabled={!hydrated || loading}>
          <div className="sd-auth-field">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="sd-auth-field">
            <Label htmlFor="pw">Password</Label>
            <Input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="sd-button sd-auth-submit" disabled={loading}>
            {loading ? (
              <>
                Signing in… <LoaderCircle size={17} className="sd-submit-spinner" />
              </>
            ) : (
              <>
                Sign in <ArrowUpRight size={17} />
              </>
            )}
          </Button>
        </fieldset>
      </form>
      <p className="sd-auth-switch">
        New here?{" "}
        <Link to="/register">
          Create an account <ArrowUpRight size={13} />
        </Link>
      </p>
      <div className="sd-auth-form-note">
        <span className="sd-status-dot" /> Your knowledge, ready for the next conversation.
      </div>
    </AuthShell>
  );
}
