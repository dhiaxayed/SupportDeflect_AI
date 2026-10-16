/**
 * @file Public organization registration form. Submit workspace/email/password to the backend,
 * which creates the tenant and initial administrator with trial defaults. Hydration gating
 * protects form interaction; accepted registration seeds a fresh account cache before opening
 * the tenant dashboard.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useState } from "react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/register")({
  /**
   * Set the registration page title without duplicating the root shell's shared metadata.
   */
  head: () => ({ meta: [{ title: "Sign up — SupportDeflect AI" }] }),
  component: Register,
});

/**
 * Collect new workspace credentials, display the existing trial offer and keep pending/error
 * state local to registration.
 */
function Register() {
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  /**
   * Create the account through the shared API, clear earlier session data and seed the
   * returned tenant admin before navigating; rejected drafts remain editable.
   */
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await register({ organization_name: company, admin_email: email, password });
      queryClient.clear();
      queryClient.setQueryData(["me"], result.user);
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to create workspace");
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
            <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              14-day trial. No credit card required.
            </p>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <fieldset disabled={!hydrated || loading} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="company">Company name</Label>
                <Input
                  id="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Inc."
                  autoComplete="organization"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
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
                <Label htmlFor="pw">Password</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating…" : "Create workspace"}
              </Button>
            </fieldset>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
      <div
        className="hidden lg:flex items-center p-12"
        style={{ background: "var(--gradient-subtle)" }}
      >
        <div className="max-w-md space-y-5">
          <h3 className="text-xl font-semibold tracking-tight">What you get instantly</h3>
          <ul className="space-y-3 text-sm">
            {[
              "Embeddable AI widget for any site",
              "RAG over your private documentation",
              "Analytics on unresolved questions",
              "Branding & widget customization",
              "Human escalation built-in",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
