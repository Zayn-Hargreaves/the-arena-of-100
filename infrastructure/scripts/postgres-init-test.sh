#!/usr/bin/env bash
# ============================================================
# PostgreSQL init script for the test DB container.
# Runs once on first container start. Idempotently creates the
# arena_test role (matching apps/api/.env.test) and grants
# CREATEDB so prisma push can connect with the well-known
# credentials.
# ============================================================
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
  -- Idempotent role creation. CREATE ROLE IF NOT EXISTS is not
  -- supported in PostgreSQL, so we guard with a DO block.
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arena_test') THEN
      CREATE ROLE arena_test WITH LOGIN PASSWORD 'arena_test';
    END IF;
  END
  $$;

  -- Allow the test app role to do everything in this DB.
  ALTER USER arena_test CREATEDB;
EOSQL

echo "✅ arena_test role + DB initialised"
