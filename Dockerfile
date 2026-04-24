# syntax=docker/dockerfile:1.7
#
# Minimal production image for the RubberForm Prospecting Engine.
#
# IMPORTANT: No secret values are declared as ARG or ENV in this file.
# Railway injects every configured env var into the container's process.env
# at runtime — they never need to enter the build context, so they never
# land in an image layer where `docker inspect` or image-cache extraction
# could recover them. This replaces the Nixpacks-generated Dockerfile,
# which was baking ANTHROPIC_API_KEY / NETSUITE_* / SESSION_SECRET / etc.
# into layers and triggering BuildKit SecretsUsedInArgOrEnv warnings.

FROM node:22-slim

WORKDIR /app

# Dependency layer first, for cache reuse across code-only changes.
# --omit=optional skips playwright (only used for local browser tests).
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --no-audit --no-fund

# App source + committed data/config that the migrations read on first boot.
COPY . .

EXPOSE 3000

# Default CMD for local `docker run`. On Railway this is overridden by
# railway.json's deploy.startCommand, which runs migrations first.
CMD ["node", "src/web/server.js"]
