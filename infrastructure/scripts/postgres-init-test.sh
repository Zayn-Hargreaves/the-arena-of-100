#!/usr/bin/env bash
# ============================================================
# PostgreSQL init script for the test DB container.
# Runs once on first container start. Creates the role that
# matches apps/api/.env.test.example so prisma push can connect
# with the well-known credentials.
# ============================================================
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Allow the test app role to do everything in this DB.
  ALTER USER arena_test CREATEDB;
EOSQL

echo "✅ arena_test DB initialised"
