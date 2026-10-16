/**
 * @file TanStack router factory connecting the generated file-route tree to one React Query
 * client. The factory creates request-local state for SSR and browser navigation;
 * authentication events clear that client in the root route rather than sharing a global
 * tenant cache.
 */

import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Create a router and its QueryClient together, enable scroll restoration and let queries
 * manage freshness instead of retaining a separate preload lifetime.
 */
export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
