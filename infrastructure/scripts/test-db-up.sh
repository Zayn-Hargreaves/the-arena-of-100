#!/usr/bin/env bash
# ============================================================
# Spin up the isolated E2E test PostgreSQL, push the Prisma
# schema, and seed questions + demo data so e2e specs can
# exercise the real DB and Redis-backed cache layer.
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="infrastructure/docker-compose.test.yml"
TEST_DB_URL="postgresql://arena_test:arena_test@localhost:5434/arena_test"

echo "🐳 Starting test PostgreSQL on :5434..."

# Start the test container (idempotent; docker compose is a no-op if it's already up).
docker compose -f "$COMPOSE_FILE" up -d arena-postgres-test

# Wait for healthy
echo "⏳ Waiting for postgres-test to become healthy..."
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' arena-postgres-test 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    echo "✅ postgres-test is healthy"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "❌ postgres-test failed to become healthy in 90s"
    docker compose -f "$COMPOSE_FILE" logs
    exit 1
  fi
  sleep 3
done

# Push schema (idempotent: same schema, no destructive)
echo "📐 Pushing Prisma schema to test DB..."
pnpm --filter @arena/api exec prisma db push --url "$TEST_DB_URL"

# Seed questions (lookup data) + demo (sample data) in sequence.
# Questions MUST exist before the demo seed (the demo seed asserts
# questionCount > 0).
echo "🌱 Seeding questions (dev dataset)..."
DATABASE_URL="$TEST_DB_URL" \
  pnpm --filter @arena/api run prisma:seed:dev

echo "🌱 Seeding demo users + matches..."
DATABASE_URL="$TEST_DB_URL" \
  pnpm --filter @arena/api run prisma:seed:demo

echo "✅ Test DB ready at $TEST_DB_URL"
echo "💡 Next: pnpm --filter @arena/api test:e2e"
