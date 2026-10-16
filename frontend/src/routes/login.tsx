/**
 * @file Public sign-in form using the shared API session workflow. Inputs stay disabled until
 * React hydration attaches handlers; successful authentication clears prior queries, seeds the
 * authoritative account and chooses the required password-change or role-specific destination.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useHydrated } from "@/hooks/use-hydrated";
import { useState } from "react";
import { Headset } from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, homeForRole } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/login")({
  /**
   * Set the sign-in document title while retaining root metadata and asset links.
   */
  head: () => ({ meta: [{ title: "Log in — SupportDeflect AI" }] }),
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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <Link to="/" className="flex items-center gap-2">
            <BrandLogo imageClassName="h-9 max-w-[190px]" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Log in to your workspace to manage your assistant.
            </p>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <fieldset disabled={!hydrated || loading} className="space-y-4">
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="pw">Password</Label>
                </div>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </fieldset>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
      <aside
        className="hidden lg:flex items-center justify-center p-12"
        style={{ background: "var(--gradient-subtle)" }}
      >
        <div className="max-w-md space-y-6 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-elegant)" }}
          >
            <Headset className="h-6 w-6 text-white" />
          </div>
          <p className="text-lg font-medium">
            Answers grounded in your documentation. A support team ready for the questions that need
            a human touch.
          </p>
          <p className="text-sm text-muted-foreground">
            Your knowledge. Your brand. Your workspace.
          </p>
        </div>
      </aside>
    </div>
  );
}
