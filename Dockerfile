# syntax=docker/dockerfile:1

FROM node:18-alpine AS builder
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HEALTH_ENABLED=true

# Only production deps
COPY package*.json ./
RUN npm install --omit=dev \
    && apk add --no-cache curl

# App artifacts
COPY --from=builder /app/dist ./dist
COPY .env.example ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD sh -c 'if [ "$HEALTH_ENABLED" != "true" ]; then exit 0; fi; curl -fsS http://localhost:${PORT:-3000}/health >/dev/null || exit 1'

CMD ["node", "dist/index.js"]
