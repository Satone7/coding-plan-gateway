#!/bin/bash

set -e

echo "=========================================="
echo "  Coding Plan Gateway - Initialization"
echo "=========================================="
echo ""

# Copy .env.example to .env
if [ -f ".env.example" ]; then
    if [ -f ".env" ]; then
        echo "⚠️  .env already exists, skipping..."
    else
        cp .env.example .env
        echo "✅ Created .env from .env.example"

        # Generate random ENCRYPTION_KEY
        ENCRYPTION_KEY=$(openssl rand -hex 32)
        sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" .env
        echo "✅ Generated random ENCRYPTION_KEY"
    fi
else
    echo "❌ .env.example not found"
    exit 1
fi

echo ""

# Copy config.yaml.example to config.yaml
if [ -f "config.yaml.example" ]; then
    if [ -f "config.yaml" ]; then
        echo "⚠️  config.yaml already exists, ensuring it is writable by the container..."
        chmod 666 config.yaml || echo "⚠️  Could not change permissions of config.yaml. Ensure it is writable by the container user (uid 1001)."
    else
        cp config.yaml.example config.yaml
        chmod 666 config.yaml
        echo "✅ Created config.yaml from config.yaml.example (permissions: 666)"
    fi
else
    echo "❌ config.yaml.example not found"
    exit 1
fi

echo ""
echo "=========================================="
echo "⚠️  Please configure your config.yaml"
echo "=========================================="
echo ""
echo "Required configuration:"
echo "  - Add your API keys to the plans"
echo "  - Configure model aliases if needed"
echo ""
echo "Run 'npm run dev' to start the server"
echo ""