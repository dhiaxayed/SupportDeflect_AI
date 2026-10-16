/**
 * @file Vite/TanStack Start build and development composition. Register file-route SSR, React
 * and Tailwind plugins; resolve the source aliases from tsconfig. Local /api requests proxy to
 * DEV_API_URL so the browser uses the same relative API contract as Traefik production.
 */

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    cors: false,
    proxy: {
      "/api": { target: process.env.DEV_API_URL ?? "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
    tailwindcss(),
  ],
});
