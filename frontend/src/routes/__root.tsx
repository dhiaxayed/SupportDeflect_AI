/**
 * @file Application document shell and shared providers for all file routes. Bundle
 * first-party icons/fonts/styles, render route-aware errors and expose one QueryClient to
 * descendants. Session notifications clear all private query data across logout/account
 * switches; the shell remains safe to render without browser authentication.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";

import iconUrl from "@/assets/official-icon.png";
import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { subscribeSession } from "@/lib/api";

/**
 * Render the application's unknown-route recovery page with a home link rather than exposing
 * routing internals.
 */
function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Report a client route failure locally and offer router invalidation/reset or home
 * navigation; the visible message excludes raw exception details.
 */
function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    console.error("Root route error boundary", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /**
   * Declare shared document encoding, responsive viewport, product metadata and bundled
   * stylesheet/icon links for SSR and client navigation.
   */
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SupportDeflect AI — AI support widget powered by your docs" },
      {
        name: "description",
        content:
          "Turn your documentation into an embeddable AI support widget. RAG-powered, multi-tenant, secure.",
      },
      {
        property: "og:title",
        content: "SupportDeflect AI — AI support widget powered by your docs",
      },
      {
        property: "og:description",
        content:
          "Turn your documentation into an embeddable AI support widget. RAG-powered, multi-tenant, secure.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "SupportDeflect AI — AI support widget powered by your docs",
      },
      {
        name: "twitter:description",
        content:
          "Turn your documentation into an embeddable AI support widget. RAG-powered, multi-tenant, secure.",
      },
    ],
    links: [
      { rel: "icon", href: iconUrl },
      { rel: "apple-touch-icon", href: iconUrl },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/**
 * Compose the semantic HTML document with TanStack-managed head tags and scripts so SSR output
 * can hydrate on the client.
 */
function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Provide the route's QueryClient and notification host, and subscribe to token changes so
 * previous-account data cannot remain cached.
 */
function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Private data cannot survive logout or an account switch in another tab.
  useEffect(() => subscribeSession(() => queryClient.clear()), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
