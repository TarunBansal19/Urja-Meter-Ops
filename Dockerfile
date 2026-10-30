# Multi-stage Docker build for Urja Meter Ops API Service
FROM node:22-alpine AS runner

WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code and assets
COPY src/ ./src/
COPY public/ ./public/
COPY openapi.json ./
COPY .env.example ./

# Set environment defaults
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Run as non-root user for security
USER node

CMD ["node", "src/server.js"]
