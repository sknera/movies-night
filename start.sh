#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🎬 Movie Night — starting with Docker..."
echo ""

cd "$PROJECT_DIR"
docker compose up --build

echo ""
echo "Stopped."
