#!/bin/bash

# Eburon AI ASR - Auto Deploy Script
# This script sets up and starts everything automatically

set -e

echo "🚀 Starting Eburon AI ASR deployment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    # Try docker compose (v2 plugin)
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
    else
        echo "❌ Docker Compose not found. Please install it."
        exit 1
    fi
else
    COMPOSE_CMD="docker-compose"
fi

echo -e "${GREEN}✓ Docker and Docker Compose found${NC}"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p data models uploads

# Download model if not exists
if [ ! -f models/ggml-base.en.bin ]; then
    echo "📥 Downloading whisper model (base.en)..."
    curl -L -o models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
    echo -e "${GREEN}✓ Model downloaded${NC}"
else
    echo -e "${GREEN}✓ Model already exists${NC}"
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
$COMPOSE_CMD down 2>/dev/null || true

# Build and start containers
echo "🔨 Building and starting containers..."
$COMPOSE_CMD up -d --build

# Wait for backend to be healthy
echo "⏳ Waiting for backend to be ready..."
sleep 10

# Check health
for i in {1..30}; do
    if curl -s http://localhost:3002/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is ready!${NC}"
        break
    fi
    echo "Waiting for backend... ($i/30)"
    sleep 5
done

# Show status
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}🎉 Eburon AI ASR is now running!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Frontend: http://localhost:8080"
echo "Backend API: http://localhost:3002"
echo "API Docs: http://localhost:3002/docs"
echo ""
echo "To view logs: $COMPOSE_CMD logs -f"
echo "To stop: $COMPOSE_CMD down"
echo ""

# Open browser (optional)
read -p "Open in browser? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    open http://localhost:8080
fi