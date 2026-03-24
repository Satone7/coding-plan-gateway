# Claude Code Container for E2E Testing
# This Dockerfile creates a container with Claude Code CLI installed

FROM node:20-bookworm-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash claude

# Set working directory
WORKDIR /workspace

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Switch to non-root user
USER claude

# Set environment variables for Claude Code
ENV ANTHROPIC_BASE_URL=http://gateway:8080
ENV ANTHROPIC_MODEL=kimi-k2.5

# Default command
CMD ["claude"]