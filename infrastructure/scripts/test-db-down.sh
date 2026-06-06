#!/usr/bin/env bash
# ============================================================
# Tear down the isolated E2E test PostgreSQL.
# Removes the container AND the volume to guarantee a clean
# slate on the next `pnpm test:db:up`.
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "🛑 Tearing down test PostgreSQL..."
docker compose -f infrastructure/docker-compose.test.yml down -v
echo "✅ Test DB stopped and volume removed"
