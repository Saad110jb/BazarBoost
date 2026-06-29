# --- Stage 1: Build & Dependencies ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# --- Stage 2: Production Runtime ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install PM2 globally for process clustering
RUN npm install -g pm2

# Copy built node_modules and codebase
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Create volume/uploads directories
RUN mkdir -p src/uploads

EXPOSE 5000
# Run backend with PM2 in cluster mode to distribute load across processor cores
CMD ["pm2-runtime", "start", "src/server.js", "-i", "max"]
