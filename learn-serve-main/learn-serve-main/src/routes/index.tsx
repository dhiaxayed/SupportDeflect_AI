import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Sparkles,
  MessageSquare,
  FileText,
  Shield,
  BarChart3,
  Code2,
  Globe,
  Zap,
  Users,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WidgetPreview } from "@/components/widget-preview";
import { BrandLogo } from "@/components/brand-logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SupportDeflect AI — Turn your docs into an AI support widget" },
      {
        name: "description",
        content:
          "RAG-powered support assistant for B2B SaaS. Upload your docs, embed a widget, deflect support tickets.",
      },
    ],
  }),
  component: Landing,
});

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <BrandLogo imageClassName="h-9 max-w-[190px]" />
        </Link>
        <nav className="hidden gap-6 md:flex text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="#usecases" className="hover:text-foreground">
            Use cases
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">Start building</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute left-1/2 top-0 h-[600px] w-[1100px] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
            style={{ background: "var(--gradient-primary)" }}
          />
        </div>
        <div className="mx-auto max-w-7xl px-6 pt-20 pb-16 text-center">
          <Badge
            variant="outline"
            className="mb-6 gap-1.5 border-primary/30 bg-primary/5 text-primary"
          >
            <Sparkles className="h-3 w-3" /> RAG-powered support assistant
          </Badge>
          <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-tight md:text-6xl">
            AI support widget powered by{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              your own documentation
            </span>
            .
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            SupportDeflect AI turns product docs, FAQs, release notes and help center articles into
            a secure RAG-powered support assistant you can embed on any website.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-6">
              <Link to="/register">
                Start building <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <Link to="/dashboard/playground">View demo</Link>
            </Button>
          </div>
          <div className="mt-16 mx-auto max-w-5xl">
            <div className="rounded-2xl border bg-card p-2 shadow-2xl">
              <div className="rounded-xl bg-gradient-to-br from-muted/40 to-background p-8">
                <WidgetPreview />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM/SOLUTION */}
      <section className="border-t bg-muted/20 py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 md:grid-cols-2">
          <div>
            <Badge variant="outline" className="mb-3">
              The problem
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">
              Your team answers the same 5 questions every day.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Support teams burn 60% of their time on questions already answered in the docs.
              Customers can't find the answer, ticket queues balloon, CSAT drops.
            </p>
          </div>
          <div>
            <Badge variant="outline" className="mb-3 border-success/30 bg-success/5 text-success">
              The solution
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">
              An assistant that knows your product cold.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Index your docs once. Embed one snippet. Visitors get instant, grounded answers — and
              your team only sees what really needs a human.
            </p>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              From docs to widget in 3 steps
            </h2>
            <p className="mt-3 text-muted-foreground">
              No ML expertise needed. Connect, embed, deflect.
            </p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "01",
                icon: FileText,
                title: "Upload your docs",
                desc: "PDFs, Markdown, FAQs, help center URLs — all in one place.",
              },
              {
                n: "02",
                icon: Sparkles,
                title: "We index & embed",
                desc: "Automatic chunking, embedding and storage in your private vector store.",
              },
              {
                n: "03",
                icon: Code2,
                title: "Embed the widget",
                desc: "Drop one script tag. Customize the brand. Go live in minutes.",
              },
            ].map((s) => (
              <div key={s.n} className="relative rounded-xl border bg-card p-6">
                <div className="text-xs font-mono text-primary">{s.n}</div>
                <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-t bg-muted/20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Everything a B2B support team needs
            </h2>
            <p className="mt-3 text-muted-foreground">
              Built for SaaS companies that take support seriously.
            </p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: MessageSquare,
                t: "Embeddable AI widget",
                d: "Drop-in JS snippet for any site.",
              },
              {
                icon: FileText,
                t: "RAG over your docs",
                d: "Answers grounded in your sources only.",
              },
              {
                icon: Shield,
                t: "Multi-tenant isolation",
                d: "Strict knowledge boundaries per org.",
              },
              { icon: Globe, t: "Upload PDFs & URLs", d: "Crawl help centers or upload files." },
              { icon: BarChart3, t: "Unresolved analytics", d: "See what your docs are missing." },
              { icon: Users, t: "Human escalation", d: "Hand off to your team in one click." },
              { icon: Sparkles, t: "Widget branding", d: "Colors, position, welcome message." },
              { icon: Zap, t: "Answer only from docs", d: "Strict mode prevents hallucinations." },
            ].map((f) => (
              <div key={f.t} className="rounded-xl border bg-card p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-4 w-4" />
                </div>
                <h3 className="mt-4 text-sm font-semibold">{f.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section id="usecases" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Built for teams of every shape
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              { t: "SaaS support", d: "Deflect tier-1 tickets, surface knowledge gaps." },
              { t: "Developer tools", d: "Answer API questions grounded in your docs site." },
              { t: "E-commerce", d: "Refunds, shipping, sizing — answered 24/7." },
            ].map((u) => (
              <div
                key={u.t}
                className="rounded-xl border bg-gradient-to-br from-card to-muted/30 p-6"
              >
                <h3 className="font-semibold">{u.t}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{u.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t bg-muted/20 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-3 text-muted-foreground">Start free, scale as you grow.</p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              {
                name: "Starter",
                price: "$0",
                desc: "For trying out",
                features: ["1,000 conversations / mo", "5 documents", "Community support"],
              },
              {
                name: "Pro",
                price: "$99",
                desc: "For growing teams",
                features: [
                  "50,000 conversations / mo",
                  "Unlimited documents",
                  "Widget branding",
                  "Email support",
                ],
                featured: true,
              },
              {
                name: "Enterprise",
                price: "Custom",
                desc: "For scale",
                features: ["Custom volumes", "SSO & audit logs", "SLA & DPA", "Dedicated CSM"],
              },
            ].map((p) => (
              <div
                key={p.name}
                className={`rounded-xl border bg-card p-6 ${p.featured ? "ring-2 ring-primary shadow-[var(--shadow-elegant)]" : ""}`}
              >
                {p.featured && <Badge className="mb-3">Most popular</Badge>}
                <h3 className="font-semibold">{p.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{p.price}</span>
                  {p.price !== "Custom" && (
                    <span className="text-sm text-muted-foreground">/ mo</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
                <ul className="mt-5 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-success" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  asChild
                  className="mt-6 w-full"
                  variant={p.featured ? "default" : "outline"}
                >
                  <Link to="/register">Get started</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="rounded-2xl border bg-card p-12 text-center shadow-[var(--shadow-elegant)]">
            <h2 className="text-3xl font-semibold tracking-tight">
              Ready to deflect 60% of your tickets?
            </h2>
            <p className="mt-3 text-muted-foreground">Set up your assistant in under 10 minutes.</p>
            <Button asChild size="lg" className="mt-6 h-12 px-6">
              <Link to="/register">
                Start building <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <BrandLogo imageClassName="h-6 max-w-[150px]" />
            <span>© 2026</span>
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground">
              Terms
            </a>
            <a href="#" className="hover:text-foreground">
              Security
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
