import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log in — SupportDeflect AI" }] }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate({ to: "/dashboard" });
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
                <a href="#" className="text-xs text-primary hover:underline">
                  Forgot?
                </a>
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
          </form>
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>
      <div
        className="hidden lg:flex items-center justify-center p-12"
        style={{ background: "var(--gradient-subtle)" }}
      >
        <div className="max-w-md space-y-6 text-center">
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-elegant)" }}
          >
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <blockquote className="text-lg font-medium tracking-tight">
            "We deflected 64% of tier-1 tickets in the first month. Our team finally has time for
            real work."
          </blockquote>
          <div className="text-sm text-muted-foreground">— Head of Support, Acme Inc.</div>
        </div>
      </div>
    </div>
  );
}
