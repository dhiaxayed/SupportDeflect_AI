/** Responsive public navigation with section awareness and an accessible dismissible mobile menu. */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Menu, X } from "lucide-react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { BrandLogo } from "@/components/brand-logo";
import { useHydrated } from "@/hooks/use-hydrated";

const links = [
  ["Product", "features"],
  ["How it works", "how"],
  ["Live demo", "demo"],
  ["Pricing", "pricing"],
] as const;

/** Render the official brand and public anchors; clean up observers and menu listeners. */
export function MarketingNav() {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    /** Apply the header divider after leaving the top of the page. */
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-15% 0px -65% 0px" },
    );
    links.forEach(([, id]) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    const desktop = window.matchMedia("(min-width: 900px)");
    /** Close the mobile overlay when desktop navigation becomes available. */
    const onResize = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      desktop.removeEventListener("change", onResize);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    /** Dismiss with Escape and restore focus to the navigation toggle. */
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    /** Dismiss when an explicit pointer action occurs outside the menu and its toggle. */
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !toggle.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    /** Close the overlay when keyboard focus moves elsewhere in the page. */
    const leaveMenu = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !toggle.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", leaveMenu);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", leaveMenu);
    };
  }, [open]);
  return (
    <header className={`sd-nav${scrolled ? " is-scrolled" : ""}`}>
      <div className="sd-container sd-nav-inner">
        <Link to="/" className="sd-logo" aria-label="SupportDeflect AI home">
          <BrandLogo imageClassName="sd-logo-image" />
        </Link>
        <nav className="sd-desktop-links" aria-label="Main navigation">
          {links.map(([label, id]) => (
            <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="sd-nav-actions">
          <Link to="/login" className="sd-login-link">
            Log in <span aria-hidden="true">↗</span>
          </Link>
          <Link to="/register" className="sd-button sd-button-small">
            Start building <ArrowRight size={14} />
          </Link>
          <button
            ref={toggle}
            disabled={!hydrated}
            className="sd-menu-toggle"
            type="button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="public-mobile-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <m.nav
            ref={menu}
            id="public-mobile-nav"
            aria-label="Mobile navigation"
            className="sd-mobile-nav"
            initial={{ opacity: 0, y: reduce ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          >
            {links.map(([label, id], index) => (
              <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>
                <span className="sd-mono">0{index + 1}</span>
                {label}
                <ArrowRight size={16} />
              </a>
            ))}
            <Link to="/login" onClick={() => setOpen(false)}>
              Log in to your workspace <ArrowRight size={16} />
            </Link>
          </m.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
