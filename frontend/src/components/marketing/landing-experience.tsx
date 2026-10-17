/** Public product story, factual shared pricing and isolated demonstration; no tenant data queries. */
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  FileText,
  Globe,
  Layers,
  MessageSquare,
  Network,
  Palette,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { MarketingWidgetPreview } from "@/components/marketing-widget-preview";
import { subscriptionPlans } from "@/lib/subscription-plans";
import { PublicMotion } from "./public-motion";
import { MarketingNav } from "./marketing-nav";
import { KnowledgeVisual } from "./knowledge-visual";
import { useLandingMotion } from "./use-landing-motion";
import iconUrl from "@/assets/official-icon.png";
import { useHydrated } from "@/hooks/use-hydrated";

/** Label each narrative section with a consistent visual index. */
function Eyebrow({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <div className="sd-eyebrow">
      <span className="sd-section-number">{number}</span>
      <span>{children}</span>
    </div>
  );
}

/** Introduce document-grounded support and link to registration or the local widget demo. */
function Hero() {
  return (
    <section className="sd-hero" aria-labelledby="hero-heading">
      <div className="sd-container sd-hero-grid">
        <div className="sd-hero-copy">
          <div className="sd-hero-reveal sd-hero-eyebrow">
            <span className="sd-status-dot" /> YOUR KNOWLEDGE. NOW IN CONVERSATION.
          </div>
          <h1 id="hero-heading" className="sd-hero-reveal">
            Your knowledge.
            <br />
            <span>Their next answer.</span>
          </h1>
          <p className="sd-hero-reveal sd-hero-description">
            The answers are already in your docs.
            <br className="sd-desktop-break" /> Put them to work with an AI support assistant
            <br className="sd-desktop-break" /> that knows your product. And knows its limits.
          </p>
          <div className="sd-hero-reveal sd-hero-actions">
            <Link to="/register" className="sd-button">
              Start building <ArrowUpRight size={17} />
            </Link>
            <a className="sd-button sd-button-outline" href="#demo">
              <span className="sd-play-icon" aria-hidden="true">
                ▷
              </span>{" "}
              Explore the demo
            </a>
          </div>
          <div className="sd-hero-reveal sd-hero-note">
            <span>
              <Check size={12} /> 14-day trial
            </span>
            <span>
              <Check size={12} /> No credit card required
            </span>
          </div>
        </div>
        <KnowledgeVisual />
      </div>
      <div className="sd-container sd-hero-baseline">
        <span className="sd-mono">BUILT AROUND WHAT YOU ALREADY KNOW</span>
        <a href="#how">
          Follow the knowledge <ArrowDown size={14} />
        </a>
      </div>
      <div className="sd-source-strip">
        <div className="sd-container">
          <span>
            One knowledge layer.
            <br />
            <strong>Every useful source.</strong>
          </span>
          <div>
            <FileText size={19} /> Product docs
          </div>
          <div>
            <BookOpen size={19} /> FAQs & guides
          </div>
          <div>
            <Code2 size={19} /> Markdown
          </div>
          <div>
            <Globe size={19} /> Website URLs
          </div>
          <div>
            <Layers size={19} /> PDF & text
          </div>
        </div>
      </div>
    </section>
  );
}

/** Explain the repetitive-support problem without invented customer metrics. */
function ProblemSolution() {
  return (
    <section className="sd-light sd-problem">
      <div className="sd-container sd-problem-grid">
        <div data-reveal>
          <Eyebrow number="01">A BETTER WAY TO SUPPORT</Eyebrow>
          <h2>
            Less repetition.
            <br />
            <span>More resolution.</span>
          </h2>
          <p>
            Your team shouldn’t have to be a search engine for your documentation. Connect what you
            know to the people who need it, and give your team room for the work that needs a human.
          </p>
          <a href="#how" className="sd-text-link">
            Meet your new knowledge layer <ArrowRight size={16} />
          </a>
        </div>
        <div className="sd-before-after" data-reveal>
          <div className="sd-before">
            <span className="sd-mono">THE FAMILIAR LOOP</span>
            <div className="sd-repeat-question">
              <MessageSquare size={15} /> How do I customize the widget?<span>Again.</span>
            </div>
            <div className="sd-repeat-question">
              <MessageSquare size={15} /> Where can I find the setup guide?<span>Again.</span>
            </div>
            <div className="sd-fragmented">
              <span>Search the docs</span>
              <ArrowRight size={13} />
              <span>Ask a teammate</span>
              <ArrowRight size={13} />
              <span>Repeat</span>
            </div>
          </div>
          <div className="sd-after">
            <span className="sd-mono">
              <i className="sd-status-dot" /> THE CONNECTED ANSWER
            </span>
            <p>
              The right knowledge.
              <br />A clear answer. A source to follow.
            </p>
            <div>
              <span>
                <FileText size={13} /> Your documentation
              </span>
              <ArrowRight size={14} />
              <span>
                <Check size={13} /> Your customer, helped
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Illustrate ingestion, retrieval and embedding the assistant with a scroll-driven progress rail. */
function WorkflowSection() {
  const steps = [
    {
      title: "Connect what you know.",
      description:
        "Bring in your documents, FAQs and supported website URLs. Your existing knowledge becomes the starting point.",
      icon: FileText,
    },
    {
      title: "Find what matters.",
      description:
        "Your assistant finds relevant passages in your knowledge and uses them to answer, with sources to check.",
      icon: Network,
    },
    {
      title: "Be there with an answer.",
      description:
        "Embed your branded assistant. Help customers find answers, with a path to your team when they need more.",
      icon: MessageSquare,
    },
  ];
  return (
    <section id="how" className="sd-section sd-workflow">
      <div className="sd-container">
        <div className="sd-section-heading" data-reveal>
          <div>
            <Eyebrow number="02">FROM KNOWLEDGE TO CONVERSATION</Eyebrow>
            <h2>
              Everything connects.
              <br />
              <span>Nothing starts from scratch.</span>
            </h2>
          </div>
          <p>
            Your documentation does the groundwork.
            <br />
            Your assistant makes it accessible.
          </p>
        </div>
        <div className="sd-workflow-grid">
          <div className="sd-flow-rail" aria-hidden="true">
            <div className="sd-flow-rail-fill" />
          </div>
          {steps.map((step, index) => (
            <article className="sd-workflow-step" key={step.title}>
              <div className="sd-step-top">
                <span className="sd-step-marker">
                  <step.icon size={17} />
                </span>
                <span className="sd-mono">
                  0{index + 1} / {index === 0 ? "CONNECT" : index === 1 ? "UNDERSTAND" : "ASSIST"}
                </span>
              </div>
              <div
                className={`sd-workflow-visual sd-workflow-visual-${index + 1}`}
                aria-hidden="true"
              >
                {index === 0 ? (
                  <>
                    <div>
                      <FileText size={14} />
                      <span>product-guide.md</span>
                      <Check size={12} />
                    </div>
                    <div>
                      <Globe size={14} />
                      <span>your-site.com/help</span>
                      <Check size={12} />
                    </div>
                    <div>
                      <FileText size={14} />
                      <span>getting-started.pdf</span>
                      <Check size={12} />
                    </div>
                  </>
                ) : index === 1 ? (
                  <>
                    <div className="sd-semantic-nodes">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <span>
                        <Network size={27} />
                      </span>
                    </div>
                    <span className="sd-mono">INDEX → RETRIEVE → GROUND</span>
                  </>
                ) : (
                  <>
                    <div className="sd-mini-chat">
                      <span>
                        <img src={iconUrl} alt="" /> Your assistant
                      </span>
                      <p>Here’s what your guide says…</p>
                      <small>
                        <FileText size={10} /> Source included
                      </small>
                    </div>
                    <Code2 size={22} />
                  </>
                )}
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Describe verified knowledge, branding and human-support capabilities. */
function FeaturesSection() {
  const features = [
    {
      icon: BookOpen,
      title: "Your knowledge.",
      description:
        "Give answers a reliable starting point. Connect your documents and website content, with source references visitors can open.",
      detail: "PDF · Markdown · Text · Website URLs",
      number: "01",
    },
    {
      icon: Palette,
      title: "Your identity.",
      description:
        "Make support feel like part of your product. Set the logo, color, greeting, dimensions and placement in Widget Design Studio.",
      detail: "Logo · Color · Greeting · Layout",
      number: "02",
    },
    {
      icon: Users,
      title: "Your people.",
      description:
        "Keep a person within reach. Review escalations with conversation context in your support inbox and reply when your team needs to step in.",
      detail: "Conversation · Review · Human reply",
      number: "03",
    },
  ];
  return (
    <section id="features" className="sd-section sd-capabilities">
      <div className="sd-container">
        <div className="sd-section-heading" data-reveal>
          <div>
            <Eyebrow number="03">BUILT TO BELONG</Eyebrow>
            <h2>
              Good support.
              <br />
              <span>In your own words.</span>
            </h2>
          </div>
          <p>
            Your expertise. Your visual identity.
            <br />
            Your team, when it matters.
          </p>
        </div>
        <div className="sd-capability-grid">
          {features.map((feature) => (
            <article key={feature.number} data-reveal>
              <div className="sd-capability-top">
                <feature.icon size={30} strokeWidth={1.3} />
                <span>{feature.number}</span>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <div className="sd-capability-detail">{feature.detail}</div>
            </article>
          ))}
        </div>
        <a className="sd-capability-link" href="#demo">
          See it in the actual widget <ArrowRight size={17} />
        </a>
      </div>
    </section>
  );
}

/** Introduce the actual widget renderer with clearly identified scripted conversations. */
function DemoSection() {
  return (
    <section id="demo" className="sd-section sd-demo-section">
      <div className="sd-container">
        <div className="sd-section-heading" data-reveal>
          <div>
            <Eyebrow number="04">TAKE THE CONVERSATION FOR A SPIN</Eyebrow>
            <h2>
              Take a closer look.
              <br />
              <span>This is your assistant.</span>
            </h2>
          </div>
          <p>
            Three ways a conversation can unfold.
            <br />
            No account. Just a little curiosity.
          </p>
        </div>
        <MarketingWidgetPreview />
        <div className="sd-demo-caption">
          <span className="sd-mono">YOUR KNOWLEDGE → THEIR ANSWER</span>
          <span>The actual embedded widget, with scripted example conversations.</span>
        </div>
      </div>
    </section>
  );
}

const useCases = [
  {
    icon: MessageSquare,
    title: "SaaS & product teams",
    description: "Turn product knowledge into everyday support.",
    question: "How do I get started with this feature?",
    answer:
      "Make setup guides, product FAQs and feature documentation available through one assistant. Escalate the questions that need your team’s expertise.",
  },
  {
    icon: Code2,
    title: "Developer tools",
    description: "Bring technical documentation into the conversation.",
    question: "Where is the configuration guide?",
    answer:
      "Connect developer guides and technical documentation so visitors can find relevant instructions and follow source references back to your docs.",
  },
  {
    icon: Globe,
    title: "Commerce & help centers",
    description: "Make your published policies easier to find.",
    question: "What does your returns policy say?",
    answer:
      "Use your published shipping, return and product guides to answer common questions. Account-specific requests still have a path to human support.",
  },
];

/** Switch keyboard-accessible examples in overlapping grid cells to preserve section height. */
function UseCasesSection() {
  const hydrated = useHydrated();
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const reduce = useReducedMotion();
  return (
    <section id="usecases" className="sd-light sd-usecases">
      <div className="sd-container sd-usecases-grid">
        <div data-reveal>
          <Eyebrow number="05">DIFFERENT TEAMS. SHARED KNOWLEDGE.</Eyebrow>
          <h2>
            Wherever questions
            <br />
            find you.
          </h2>
          <p>
            A product guide. A help center. A technical reference. Put your knowledge closer to the
            next question.
          </p>
          <span className="sd-usecase-footnote">
            <Workflow size={16} /> Built around your documentation.
          </span>
        </div>
        <div className="sd-usecase-list">
          <div
            className="sd-usecase-tabs"
            role="tablist"
            aria-label="Support use cases"
            aria-orientation="vertical"
          >
            {useCases.map((item, index) => (
              <button
                key={item.title}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                id={`usecase-tab-${index}`}
                className="sd-usecase-tab"
                role="tab"
                type="button"
                disabled={!hydrated}
                aria-selected={active === index}
                tabIndex={active === index ? 0 : -1}
                aria-controls={`usecase-${index}`}
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % useCases.length
                      : event.key === "ArrowUp"
                        ? (index + useCases.length - 1) % useCases.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? useCases.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    setActive(next);
                    tabs.current[next]?.focus();
                  }
                }}
              >
                <item.icon size={21} />
                <span>
                  {item.title}
                  <small>{item.description}</small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
          <div className="sd-usecase-panel-slot">
            {useCases.map((item, index) => (
              <m.div
                key={item.title}
                id={`usecase-${index}`}
                role="tabpanel"
                aria-labelledby={`usecase-tab-${index}`}
                aria-hidden={active !== index}
                inert={active !== index}
                className={`sd-usecase-detail${active === index ? " is-active" : ""}`}
                initial={false}
                animate={{ opacity: active === index ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.16 }}
              >
                <span>“{item.question}”</span>
                <p>{item.answer}</p>
                <a href="#demo">
                  Explore a sample conversation <ArrowUpRight size={13} />
                </a>
              </m.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Explain tenant separation, source attribution and human follow-up boundaries. */
function TrustSection() {
  return (
    <section className="sd-trust">
      <div className="sd-container">
        <div className="sd-trust-title" data-reveal>
          <ShieldCheck size={24} />
          <h2>Built on clear boundaries.</h2>
          <p>Confidence comes from knowing how your support works.</p>
        </div>
        <div className="sd-trust-grid">
          {[
            {
              icon: ShieldCheck,
              title: "Your workspace. Your knowledge.",
              text: "Organization-level isolation keeps each workspace’s knowledge separate.",
            },
            {
              icon: BookOpen,
              title: "Sources behind the answer.",
              text: "Retrieval grounds answers in the documentation you connect.",
            },
            {
              icon: Users,
              title: "A human path, always.",
              text: "Escalations give your support team the context to take over.",
            },
          ].map((item) => (
            <div key={item.title} data-reveal>
              <item.icon size={17} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Render plan names, prices and limits from the existing shared subscription source. */
function PricingSection() {
  return (
    <section id="pricing" className="sd-light sd-section sd-pricing">
      <div className="sd-container">
        <div className="sd-section-heading" data-reveal>
          <div>
            <Eyebrow number="06">ROOM TO GROW</Eyebrow>
            <h2>
              The right scale
              <br />
              <span>for your knowledge.</span>
            </h2>
          </div>
          <p>
            Start with a 14-day trial.
            <br />
            Plan pricing is arranged for your organization.
          </p>
        </div>
        <div className="sd-pricing-grid">
          {subscriptionPlans.map((plan, index) => (
            <article
              key={plan.name}
              className={`sd-plan${plan.featured ? " sd-plan-featured" : ""}`}
              data-reveal
            >
              <div className="sd-plan-top">
                <span className="sd-mono">
                  0{index + 1} / {plan.name.toUpperCase()}
                </span>
                {plan.featured && <span className="sd-plan-badge">GROWING TEAMS</span>}
              </div>
              <h3>{plan.name}</h3>
              <p className="sd-plan-description">{plan.desc}</p>
              <div className="sd-plan-price">{plan.price}</div>
              <span className="sd-plan-price-note">Tailored to your organization</span>
              <Link to="/register" className={`sd-button ${plan.featured ? "" : "sd-button-plan"}`}>
                Get started <ArrowUpRight size={15} />
              </Link>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={14} />
                    {feature}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="sd-pricing-note">
          <Check size={13} /> No online payment required to create a trial workspace. Subscription
          management is handled by the platform team.
        </div>
      </div>
    </section>
  );
}

/** Offer the final registration action and genuine public navigation links. */
function ClosingSection() {
  return (
    <>
      <section className="sd-closing">
        <div className="sd-container">
          <div className="sd-closing-mark" aria-hidden="true">
            <img src={iconUrl} alt="" />
          </div>
          <div data-reveal>
            <span className="sd-mono">THE NEXT ANSWER STARTS WITH YOU</span>
            <h2>
              Put your knowledge
              <br />
              <span>into the conversation.</span>
            </h2>
            <p>Your docs have a lot to offer. Give them a voice.</p>
            <Link to="/register" className="sd-button">
              Create your workspace <ArrowUpRight size={17} />
            </Link>
            <span className="sd-closing-note">14-day trial · No credit card required</span>
          </div>
        </div>
      </section>
      <footer className="sd-footer">
        <div className="sd-container">
          <div>
            <Link to="/" className="sd-logo" aria-label="SupportDeflect AI home">
              <BrandLogo imageClassName="sd-logo-image" />
            </Link>
            <p>Good knowledge deserves a good conversation.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#features">Product</a>
            <a href="#demo">Demo</a>
            <a href="#pricing">Plans</a>
            <Link to="/login">
              Log in <ArrowUpRight size={12} />
            </Link>
          </nav>
        </div>
        <div className="sd-container sd-footer-bottom">
          <span>© 2026 SupportDeflect AI</span>
          <span className="sd-mono">KNOWLEDGE IN. CLARITY OUT.</span>
          <a href="#main-content">
            Back to top <ArrowUpRight size={12} />
          </a>
        </div>
      </footer>
    </>
  );
}

/** Compose the public page inside scoped typography, Motion and GSAP lifecycle boundaries. */
export function LandingExperience() {
  const scope = useLandingMotion();
  return (
    <PublicMotion>
      <div className="public-site sd-public" ref={scope}>
        <a className="sd-skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="sd-page-progress" aria-hidden="true" />
        <MarketingNav />
        <main id="main-content" tabIndex={-1}>
          <Hero />
          <ProblemSolution />
          <WorkflowSection />
          <FeaturesSection />
          <DemoSection />
          <UseCasesSection />
          <TrustSection />
          <PricingSection />
          <ClosingSection />
        </main>
      </div>
    </PublicMotion>
  );
}
