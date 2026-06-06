// ============================================================
// Shared SSL configuration helper for PostgreSQL connections.
// Used by both `prisma.service.ts` (runtime) and `prisma/seed.ts`
// (CLI seed script) to keep behaviour identical.
// ============================================================

export interface SslConfigInputs {
  nodeEnv: string | undefined;
  useSSL: boolean;
  caCert?: string;
  allowSelfSigned: boolean;
}

export interface PgSslConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

export function buildSslConfig({
  nodeEnv,
  useSSL,
  caCert,
  allowSelfSigned,
}: SslConfigInputs): PgSslConfig | undefined {
  if (allowSelfSigned && (nodeEnv === "production" || nodeEnv === undefined)) {
    throw new Error(
      "PG_ALLOW_SELF_SIGNED=true is forbidden when NODE_ENV=production. " +
        "Provide PG_SSL_CA or remove PG_ALLOW_SELF_SIGNED.",
    );
  }

  if (!useSSL) {
    return undefined;
  }

  if (caCert) {
    return { rejectUnauthorized: true, ca: caCert };
  }

  if (allowSelfSigned && (nodeEnv === "development" || nodeEnv === "test")) {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}
