// ============================================================
// Prisma Service - Database Connection
// ============================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { buildSslConfig } from "../../common/database/ssl-config";
import { positiveIntEnv } from "../../common/config/env";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is missing!");
    }

    const sslConfig = buildSslConfig({
      nodeEnv: process.env.NODE_ENV,
      useSSL: process.env.DATABASE_SSL === "true",
      caCert: process.env.PG_SSL_CA,
      allowSelfSigned: process.env.PG_ALLOW_SELF_SIGNED === "true",
    });

    // Per-instance pool size. `pg-pool` silently defaults to 10, which is the
    // real connection ceiling of the whole cluster (nodes x 10), NOT
    // Postgres's max_connections — a load test saturated all 10 per node
    // (every connection simultaneously active) while Postgres still had 3x
    // its connections free, with waiters queued inside node-postgres where
    // Postgres cannot see them. Size (instances x DB_POOL_MAX) under
    // `max_connections` minus reserved/admin slots; bigger is not
    // automatically better — each backend is a Postgres process, so past a
    // point more connections buy contention rather than throughput.
    const pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: positiveIntEnv(process.env.DB_POOL_MAX, 10),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log("✅ Database connected");
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
    this.logger.log("🔌 Database disconnected");
  }
}
