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
    const useSSL = process.env.DATABASE_SSL === "true";
    const caCert = process.env.PG_SSL_CA;
    const allowSelfSigned = process.env.PG_ALLOW_SELF_SIGNED === "true";

    let sslConfig: { rejectUnauthorized: boolean; ca?: string } | undefined;
    if (useSSL) {
      if (caCert) {
        sslConfig = { rejectUnauthorized: true, ca: caCert };
      } else if (allowSelfSigned) {
        sslConfig = { rejectUnauthorized: false };
      } else {
        sslConfig = { rejectUnauthorized: true };
      }
    }

    const pool = new Pool({
      connectionString,
      ssl: sslConfig,
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
