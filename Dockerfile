# Pull Docker CLI binary from official image to avoid apt repo complexity
FROM docker:27-cli AS docker-cli

# Multi-stage build using the repository's pinned Node LTS.
FROM node:20.19.1 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.eslint.json vite.config.ts postcss.config.js tailwind.config.ts components.json ./
COPY public ./public
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build

########################################
# Production image
FROM node:20.19.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV ARDUINO_CACHE_DIR=/app/server/arduino-cache

# 1. Copy Docker CLI binary from official image (no apt repo setup needed)
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# 2. Install system tools and Arduino CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tar \
    xz-utils \
    g++ \
    && curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh \
    && mkdir -p /home/node/.arduino15 \
    && chown -R node:node /home/node/.arduino15 \
    && su node -c 'HOME=/home/node arduino-cli config init' \
    && su node -c 'HOME=/home/node arduino-cli core update-index' \
    && su node -c 'HOME=/home/node arduino-cli core install arduino:avr' \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/server/arduino-cache /app/storage/binaries /app/temp

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package metadata and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts \
    && chown -R node:node /app \
    && usermod -aG root node

# Run as non-root user for production
# node:slim already provides a 'node' user at UID 1000
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
