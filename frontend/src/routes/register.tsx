/**
 * @file Public organization registration form. Submit workspace/email/password to the backend,
 * which creates the tenant and initial administrator with trial defaults. Hydration gating
 * protects form interaction; accepted registration seeds a fresh account cache before opening
 * the tenant dashboard.
 */

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/marketing/auth-shell";
import { publicFontLinks } from "@/components/marketing/public-font";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/register")({
  /**
   * Set the registration page title without duplicating the root shell's shared metadata.
   */
  head: () => ({ meta: [{ title: "Sign up — SupportDeflect AI" }], links: [...publicFontLinks] }),
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
    <AuthShell mode="register">
      <span className="sd-auth-form-eyebrow sd-mono">A NEW HOME FOR YOUR KNOWLEDGE</span>
      <h1>Create your workspace</h1>
      <p className="sd-auth-description">14-day trial. No credit card required.</p>
      <form onSubmit={onSubmit}>
        <fieldset disabled={!hydrated || loading}>
          <div className="sd-auth-field">
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
          <div className="sd-auth-field">
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
          <div className="sd-auth-field">
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
          <Button type="submit" className="sd-button sd-auth-submit" disabled={loading}>
            {loading ? (
              <>
                Creating… <LoaderCircle size={17} className="sd-submit-spinner" />
              </>
            ) : (
              <>
                Create workspace <ArrowUpRight size={17} />
              </>
            )}
          </Button>
        </fieldset>
      </form>
      <p className="sd-auth-switch">
        Already have an account?{" "}
        <Link to="/login">
          Sign in <ArrowUpRight size={13} />
        </Link>
      </p>
      <div className="sd-auth-form-note">
        <span className="sd-status-dot" /> One workspace. Your knowledge. A more helpful experience.
      </div>
    </AuthShell>
  );
}
