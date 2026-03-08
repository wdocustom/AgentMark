#!/bin/bash
set -e

echo "========================================"
echo "  AgentMark - Setup Script"
echo "========================================"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install from https://docker.com"; exit 1; }

NODE_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Node.js 20+ is required. Current: $(node -v)"
  exit 1
fi

echo "Prerequisites check passed."

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env from template..."
  cp .env.example .env
  # Generate random JWT secret
  JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
  sed -i "s/your_jwt_secret_here_min_32_chars/$JWT_SECRET/" .env 2>/dev/null || true
  echo ".env file created. Please review and update values."
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Start infrastructure
echo "Starting PostgreSQL and Redis..."
docker compose up -d postgres redis

# Wait for services
echo "Waiting for services to be ready..."
sleep 5

# Run migrations
echo "Running database migrations..."
npm run db:migrate

echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "  Start development:"
echo "    npm run dev"
echo ""
echo "  API:  http://localhost:4000"
echo "  Web:  http://localhost:3000"
echo ""
echo "  Full stack with Docker:"
echo "    docker compose up --build"
echo ""
