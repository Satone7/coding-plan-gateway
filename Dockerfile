# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user with ability to read mounted config files
# Add gateway to nodejs group so it can read files owned by node (from build stage)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gateway -u 1001 -G nodejs

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy CLI executable
COPY bin/cpg ./bin/cpg
RUN chmod +x bin/cpg

# Create data and config directories with proper permissions
# Create placeholder config with read permission for all users (will be mounted over)
RUN mkdir -p /app/config /app/data && \
    touch /app/config.yaml && \
    chmod 644 /app/config.yaml && \
    chown -R gateway:nodejs /app

# Add CLI to PATH
ENV PATH="/app/bin:${PATH}"

# Switch to non-root user
USER gateway

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]