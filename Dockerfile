# Multi-stage build using Node 25.2.1
FROM node:25.2.1 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY tsconfig.json tsconfig.eslint.json vite.config.ts postcss.config.js tailwind.config.ts components.json ./
COPY public ./public
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build

########################################
# Production image
FROM node:25.2.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV ARDUINO_CACHE_DIR=/app/server/arduino-cache

# 1. Installiere System-Tools UND Docker-CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tar \
    xz-utils \
    g++ \
    gnupg \
    lsb-release \
    && mkdir -p -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y docker-ce-cli \
    # 2. Arduino CLI Installation
    && curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh \
    && arduino-cli config init \
    && arduino-cli core update-index \
    && arduino-cli core install arduino:avr \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/server/arduino-cache /app/storage/binaries /app/temp

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package metadata and install dependencies
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --production=false \
    && chown -R node:node /app

# Run as non-root user for production
# node:slim already provides a 'node' user at UID 1000
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
