# Pull Docker CLI binary from official image to avoid apt repo complexity
FROM docker:27-cli AS docker-cli

# Multi-stage build using the repository's pinned Node LTS.
FROM node:24.20.0 AS builder
WORKDIR /app
# No .git in the build context; skip the husky `prepare` hook.
ENV HUSKY=0
COPY package.json package-lock.json ./
# npm workspaces: every workspace manifest must exist before npm ci.
COPY packages/avr-emulator/package.json ./packages/avr-emulator/package.json
RUN npm ci
# Provision the same verified local renderer used in development/tests; no request-time downloads.
COPY scripts/provision-tutor-uml.mjs scripts/tutor-uml-runtime.lock.json ./scripts/
RUN npm run provision:tutor-uml && rm -f cache/tutor-uml/*-jre.tar.gz cache/tutor-uml/fonts.tar.bz2
COPY tsconfig.json tsconfig.eslint.json vite.config.ts postcss.config.js tailwind.config.ts components.json ./
COPY scripts/check-bundle-budget.mjs ./scripts/check-bundle-budget.mjs
COPY public ./public
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY packages ./packages
COPY docs/examples/tutor-uml ./docs/examples/tutor-uml
COPY scripts/check-tutor-uml-runtime.ts ./scripts/
RUN npm run check:tutor-uml-runtime
RUN npm run build

########################################
# Production image
FROM node:24.20.0-slim AS runner
WORKDIR /app
# Build-time only (ARG, not ENV) so it does not persist in the runtime image.
ARG DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV ARDUINO_CACHE_DIR=/app/server/arduino-cache

# 1. Copy Docker CLI binary from official image (no apt repo setup needed)
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# 2. System tools. No compiler: the Docker profile compiles every sketch in a
# container of Dockerfile.compile-sandbox (arduino-cli, plan P2.4) and runs the
# host mock in Dockerfile.sandbox (g++); this image only starts them.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    fontconfig libfreetype6 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/server/arduino-cache /app/storage/binaries /app/temp

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/cache/tutor-uml ./cache/tutor-uml
COPY --from=builder /app/docs/examples/tutor-uml/*.puml ./docs/examples/tutor-uml/

# Copy package metadata and install dependencies
COPY package.json package-lock.json ./
COPY packages/avr-emulator/package.json ./packages/avr-emulator/package.json
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts \
    && chown -R node:node /app \
    && usermod -aG root node

# Run as non-root user for production
# node:slim already provides a 'node' user at UID 1000
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]
