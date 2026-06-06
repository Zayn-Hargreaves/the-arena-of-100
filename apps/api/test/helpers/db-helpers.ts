// ============================================================
// Database helpers for e2e tests.
//
// Strategy: trust the demo seed (`prisma:seed:demo`) as the
// baseline fixture. The e2e suite asserts behavior on top of
// that dataset and never inserts its own users/matches — it
// only queries for ids by username so tests stay decoupled
// from internal cuid generation.
// ============================================================

import { PrismaClient, type User } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { buildSslConfig } from "../../src/common/database/ssl-config";

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL not set for e2e test");
  }
  pool = new Pool({
    connectionString,
    max: 3,
    ssl: buildSslConfig({
      nodeEnv: process.env.NODE_ENV,
      useSSL: process.env.DATABASE_SSL === "true",
      caCert: process.env.PG_SSL_CA,
      allowSelfSigned: process.env.PG_ALLOW_SELF_SIGNED === "true",
    }),
  });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Returns a deterministic demo user by their stable username.
export async function findDemoUser(username: string): Promise<User | null> {
  return getPrisma().user.findUnique({ where: { username } });
}

// Convenience: throws if the expected demo user is missing.
// Surfaces a clear error message instead of a confusing null deref.
export async function requireDemoUser(username: string): Promise<User> {
  const user = await findDemoUser(username);
  if (!user) {
    throw new Error(
      `Demo user '${username}' not found — did you run 'pnpm test:db:up'?`,
    );
  }
  return user;
}
