# Build the isolated SMTP worker from the repository root build context.
# Install only locked runtime dependencies; no application secrets enter this image.
FROM node:24-bookworm-slim
WORKDIR /app/mailer
COPY mailer/package*.json ./
RUN npm ci --omit=dev
COPY mailer/*.mjs ./
# Templates resolve this sibling path and attach the logo through a stable CID.
COPY widget/supportdeflect-logo.png /app/widget/supportdeflect-logo.png
# The worker needs no root permissions; Compose supplies runtime settings and health checks.
USER node
CMD ["node", "worker.mjs"]
