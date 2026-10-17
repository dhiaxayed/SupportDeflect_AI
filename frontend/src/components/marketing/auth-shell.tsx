/** Public authentication presentation; existing forms continue to own session and API behavior. */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  FileText,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import * as m from "motion/react-m";
import { useReducedMotion } from "motion/react";
import { BrandLogo } from "@/components/brand-logo";
import { useHydrated } from "@/hooks/use-hydrated";
import { PublicMotion } from "./public-motion";
import iconUrl from "@/assets/official-icon.png";
import "@/landing.css";

/** Present responsive branding and accessible form placement with reduced-motion support. */
function AuthContent({ children, mode }: { children: ReactNode; mode: "login" | "register" }) {
  const hydrated = useHydrated();
  const reduce = useReducedMotion();
  return (
    <div className={`sd-auth sd-auth-${mode}`}>
      <a className="sd-skip-link" href="#auth-form">
        Skip to form
      </a>
      <aside className="sd-auth-story" aria-label="About SupportDeflect AI">
        <Link to="/" className="sd-logo" aria-label="SupportDeflect AI home">
          <BrandLogo imageClassName="sd-logo-image" />
        </Link>
        <div className="sd-auth-story-copy">
          <span className="sd-eyebrow">
            <span className="sd-status-dot" /> KNOWLEDGE MEETS CONVERSATION
          </span>
          <h2>
            {mode === "login" ? (
              <>
                Good to have
                <br />
                you <span>back.</span>
              </>
            ) : (
              <>
                Your knowledge.
                <br />A new <span>beginning.</span>
              </>
            )}
          </h2>
          <p>Turn what your team knows into the answers your customers need.</p>
          <div className="sd-auth-diagram" aria-hidden="true">
            <div className="sd-auth-docs">
              <span>
                <FileText size={17} /> Product guides
              </span>
              <span>
                <BookOpen size={17} /> Your knowledge
              </span>
            </div>
            <div className="sd-auth-connector" />
            <div className="sd-auth-engine">
              <img src={iconUrl} alt="" />
            </div>
            <div className="sd-auth-connector" />
            <div className="sd-auth-answer">
              <MessageSquare size={18} />
              <span>
                A helpful answer.<small>Grounded in your docs.</small>
              </span>
              <Check size={14} />
            </div>
          </div>
          {mode === "register" ? (
            <ul className="sd-auth-benefits">
              {[
                "Your own branded support assistant",
                "Answers grounded in your documentation",
                "Human escalation and support inbox",
              ].map((item) => (
                <li key={item}>
                  <Check size={14} />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <div className="sd-auth-quote">
              <span className="sd-mono">A LITTLE LESS REPETITION. A LOT MORE CLARITY.</span>
              <p>
                Your knowledge. Your brand.
                <br />
                Your workspace.
              </p>
            </div>
          )}
        </div>
        <div className="sd-auth-story-footer">
          <ShieldCheck size={14} />
          <span>Knowledge connected. People supported.</span>
          <ArrowUpRight size={14} />
        </div>
      </aside>
      <main className="sd-auth-main" id="auth-form" tabIndex={-1}>
        <div className="sd-auth-top">
          <Link to="/" className="sd-auth-back">
            <ArrowLeft size={14} /> Back to website
          </Link>
          <span className="sd-mono">
            {mode === "login" ? "YOUR WORKSPACE AWAITS" : "LET’S BUILD SOMETHING HELPFUL"}
          </span>
        </div>
        <div className="sd-auth-mobile-brand">
          <Link to="/" aria-label="SupportDeflect AI home">
            <BrandLogo imageClassName="sd-logo-image" />
          </Link>
        </div>
        <m.div
          className="sd-auth-form-wrap"
          initial={false}
          animate={hydrated && !reduce ? { opacity: [0.8, 1], y: [12, 0] } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          {children}
        </m.div>
        <div className="sd-auth-bottom">
          <span>© 2026 SupportDeflect AI</span>
          <span>
            <ShieldCheck size={12} /> Your knowledge. Your workspace.
          </span>
        </div>
      </main>
    </div>
  );
}

/** Scope public typography and motion to the login/registration shell. */
export function AuthShell(props: { children: ReactNode; mode: "login" | "register" }) {
  return (
    <PublicMotion>
      <AuthContent {...props} />
    </PublicMotion>
  );
}
