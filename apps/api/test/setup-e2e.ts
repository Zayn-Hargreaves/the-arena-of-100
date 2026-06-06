// ============================================================
// E2E test environment helpers.
//
// Each test file gets its own cloned PostgreSQL database and its
// own Redis key namespace so Vitest can run files in parallel
// without cross-file contamination.
// ============================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { buildSslConfig } from "../src/common/database/ssl-config";

interface TestEnvState {
  databaseName: string;
  databaseUrl: string;
  redisKeyPrefix: string;
}

const stateByFile = new Map<string, TestEnvState>();

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hashId(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function maskConnectionString(value: string): string {
  return value.replace(/:[^:@]+@/, ":***@");
}

function baseDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "";
}

function baseRedisUrl(): string {
  return process.env.REDIS_URL ?? "";
}

function assertBaseTestEnv(): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const databaseUrl = baseDatabaseUrl();

  if (nodeEnv === "production") {
    throw new Error(
      "❌ E2E tests cannot run with NODE_ENV=production. Refusing to start.",
    );
  }

  const looksLikeTestDb = [":5434/", "/arena_test"].some((hint) =>
    databaseUrl.includes(hint),
  );
  if (!looksLikeTestDb) {
    throw new Error(
      "❌ E2E tests require DATABASE_URL pointing at the test DB " +
        "(port 5434 or db 'arena_test'). " +
        `Got: ${maskConnectionString(databaseUrl)}`,
    );
  }

  if (!baseRedisUrl().includes("/1")) {
    throw new Error(
      "❌ E2E tests require REDIS_URL to target DB index 1. " +
        "Set REDIS_URL=redis://localhost:6379/1.",
    );
  }
}

function buildState(importMetaUrl: string): TestEnvState {
  const filePath = fileURLToPath(importMetaUrl);
  const workerId = sanitizeId(
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "0",
  );
  const baseName = sanitizeId(path.basename(filePath, path.extname(filePath)));
  const uniqueSuffix = hashId(filePath).slice(0, 6);
  const databaseName =
    `arena_test_${baseName}_${workerId}_${uniqueSuffix}`.slice(0, 63);
  const databaseUrl = new URL(baseDatabaseUrl());
  databaseUrl.pathname = `/${databaseName}`;

  return {
    databaseName,
    databaseUrl: databaseUrl.toString(),
    redisKeyPrefix: `e2e:${workerId}:${baseName}:${uniqueSuffix}:`,
  };
}

async function withAdminClient<T>(
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const adminUrl = new URL(baseDatabaseUrl());
  adminUrl.pathname = "/postgres";

  const client = new Client({
    connectionString: adminUrl.toString(),
    ssl: buildSslConfig({
      nodeEnv: process.env.NODE_ENV,
      useSSL: process.env.DATABASE_SSL === "true",
      caCert: process.env.PG_SSL_CA,
      allowSelfSigned: process.env.PG_ALLOW_SELF_SIGNED === "true",
    }),
  });

  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function recreateTestDatabase(targetDatabaseName: string): Promise<void> {
  const templateDatabaseName = new URL(baseDatabaseUrl()).pathname.slice(1);

  await withAdminClient(async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [targetDatabaseName],
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabaseName)}`,
    );
    await client.query(
      `CREATE DATABASE ${quoteIdentifier(targetDatabaseName)} TEMPLATE ${quoteIdentifier(templateDatabaseName)}`,
    );
  });
}

async function dropTestDatabase(targetDatabaseName: string): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [targetDatabaseName],
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabaseName)}`,
    );
  });
}

export async function prepareE2ETestEnv(importMetaUrl: string): Promise<void> {
  assertBaseTestEnv();

  const existing = stateByFile.get(importMetaUrl);
  if (existing) {
    process.env.DATABASE_URL = existing.databaseUrl;
    process.env.REDIS_KEY_PREFIX = existing.redisKeyPrefix;
    return;
  }

  const state = buildState(importMetaUrl);
  await recreateTestDatabase(state.databaseName);

  process.env.DATABASE_URL = state.databaseUrl;
  process.env.REDIS_KEY_PREFIX = state.redisKeyPrefix;
  stateByFile.set(importMetaUrl, state);
}

export async function cleanupE2ETestEnv(importMetaUrl: string): Promise<void> {
  const state = stateByFile.get(importMetaUrl);
  if (!state) {
    return;
  }

  await dropTestDatabase(state.databaseName);
  stateByFile.delete(importMetaUrl);
}
