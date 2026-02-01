# Multi-stage build using Node 25.2.1
FROM node:25.2.1 AS builder
WORKDIR /app

# Install dependencies (including devDeps for build)
COPY package.json package-lock.json* ./
RUN npm install

# Copy sources and build (client + server)
COPY . .
RUN npm run build

########################################
# Production image
FROM node:25.2.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install Arduino CLI and required tools
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates tar xz-utils g++ \
	&& curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR=/usr/local/bin sh \
	&& arduino-cli config init \
	&& arduino-cli core update-index \
	&& arduino-cli core install arduino:avr \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package metadata and install all dependencies
# (vite is marked as external in esbuild but needed at runtime for middleware mode)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --production=false

EXPOSE 3000
CMD ["npm", "run", "start"]
