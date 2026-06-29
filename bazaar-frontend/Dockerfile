# --- Stage 1: Build Next.js Application ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install PM2 globally for clustering and process monitoring
RUN npm install -g pm2

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./

EXPOSE 3000
# Run Next.js production server with PM2
CMD ["pm2-runtime", "start", "npm", "--name", "bazaarboost-frontend-prod", "--", "start"]
