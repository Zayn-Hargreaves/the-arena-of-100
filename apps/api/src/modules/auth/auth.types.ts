// ============================================================
// Auth Types - Shared Fastify request augmentation
// ============================================================

import type { FastifyRequest } from "fastify";
import type { TokenPayload } from "./auth.service";

export interface AuthenticatedRequest extends FastifyRequest {
  user: TokenPayload;
}
