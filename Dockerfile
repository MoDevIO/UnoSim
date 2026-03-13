# Multi-stage build using Node 25.2.1
FROM node:25.2.1 AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

########################################
# Production image
FROM node:25.2.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# WICHTIG: Setze die Variable auch im Container, damit der Pfad konsistent bleibt
ENV ARDUINO_CACHE_DIR=/app/server/arduino-cache

# Install Arduino CLI and required tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates tar xz-utils g++ \
    && curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh \
    && arduino-cli config init \
    && arduino-cli core update-index \
    && arduino-cli core install arduino:avr \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Erstelle die notwendigen Verzeichnisse für den Compiler-Cache und Storage
# Damit der Node-User (falls du einen nutzt) Schreibrechte hat
RUN mkdir -p /app/server/arduino-cache /app/storage/binaries /app/temp

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package metadata and install dependencies
COPY package.json package-lock.json* ./
# Da Vite zur Laufzeit gebraucht wird, bleiben wir bei --production=false
RUN npm install --legacy-peer-deps --production=false

EXPOSE 3000
CMD ["npm", "run", "start"]