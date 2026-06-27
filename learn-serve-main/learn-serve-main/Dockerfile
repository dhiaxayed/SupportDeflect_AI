FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-alpine AS build

WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs

EXPOSE 3000
CMD ["node", "server.mjs"]
