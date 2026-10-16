# Frontend container: install locked build tools, compile TanStack SSR/client assets, then
# serve only runtime dependencies and generated output as the unprivileged Node user.
# Traefik owns public routing; server.mjs owns static-file and Fetch-handler adaptation.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Vite embeds this public API path at build time; secrets do not belong in VITE_* values.
FROM deps AS build
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN npm run build

# Keep compilers/test tooling out of the runtime image while retaining SSR imports.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server.mjs ./server.mjs
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
