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
ENV ARDUINO_CACHE_DIR=/app/server/arduino-cache

# Install Arduino CLI, Docker CLI, and required tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl ca-certificates tar xz-utils g++ gnupg lsb-release \
    # Install Arduino CLI
    && curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh \
    && arduino-cli config init \
    && arduino-cli core update-index \
    && arduino-cli core install arduino:avr \
    # Install Docker CLI
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian buster stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/server/arduino-cache /app/storage/binaries /app/temp

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package metadata and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --production=false

EXPOSE 3000
CMD ["npm", "run", "start"]
