// ============================================================
// User & Stats - Shared Contracts & Zod Schemas
// User summary and profile stats contracts shared across API and Web.
// ============================================================

import { z } from "zod";
import { rankTierSchema } from "./elo";

export const userSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  avatar: z.string(),
  role: z.enum(["GUEST", "ADMIN"]),
  elo: z.number().int().nonnegative().default(1200),
  rankTier: rankTierSchema.default("SILVER"),
  createdAt: z
    .string()
    .datetime({ offset: true, message: "must be an ISO-8601 datetime" })
    .optional(),
});

export type UserSummary = z.infer<typeof userSummarySchema>;
