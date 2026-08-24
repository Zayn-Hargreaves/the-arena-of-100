// ============================================================
// Daily Challenge API client — consumes the three endpoints
// added by 1a (PR #84). Type definitions live in
// `@/types/daily` so the web tree doesn't depend on the API
// tree directly. The mirrors here are intentionally local:
// promoting them to @arena/shared is Phase 2 scope.
//
// Endpoints (base = NEXT_PUBLIC_API_URL, prefix = /api/v1):
//   GET  /daily/today
//   POST /daily/submit  (auth required)
//   GET  /daily/leaderboard?dateKey=&limit=
// ============================================================

import { apiGetJson, apiSendJson } from "@/lib/api-client";
import type {
  DailyLeaderboardQuery,
  DailyLeaderboardResponse,
  DailySubmitInput,
  DailySubmitResponse,
  DailyTodayResponse,
} from "@/types/daily";

export async function getDailyToday(
  token?: string,
): Promise<DailyTodayResponse> {
  return apiGetJson<DailyTodayResponse>("/api/v1/daily/today", token);
}

export async function submitDaily(
  body: DailySubmitInput,
  token: string,
): Promise<DailySubmitResponse> {
  return apiSendJson<DailySubmitResponse>(
    "/api/v1/daily/submit",
    "POST",
    body,
    token,
  );
}

/** Bounds mirror `dailyLeaderboardQuerySchema` on the API side. */
const LEADERBOARD_LIMIT_MIN = 1;
const LEADERBOARD_LIMIT_MAX = 100;

/**
 * Builds the leaderboard querystring, omitting empty/undefined
 * values so we never send `dateKey=` (which would fail the
 * YYYY-MM-DD DTO check).
 */
function buildLeaderboardQuery(query: DailyLeaderboardQuery): string {
  const search = new URLSearchParams();

  const dateKey = query.dateKey?.trim();
  if (dateKey) search.set("dateKey", dateKey);

  // Only serialize a limit the backend will actually accept. Anything
  // else (NaN, Infinity, fractions, out-of-range) is dropped so the
  // server applies its own default instead of 400-ing the request.
  // `Number.isInteger` rejects NaN, ±Infinity and non-integers at once.
  const { limit } = query;
  if (
    limit !== undefined &&
    Number.isInteger(limit) &&
    limit >= LEADERBOARD_LIMIT_MIN &&
    limit <= LEADERBOARD_LIMIT_MAX
  ) {
    search.set("limit", String(limit));
  }

  return search.toString();
}

export async function getDailyLeaderboard(
  query: DailyLeaderboardQuery = {},
): Promise<DailyLeaderboardResponse> {
  const qs = buildLeaderboardQuery(query);
  const path = qs
    ? `/api/v1/daily/leaderboard?${qs}`
    : "/api/v1/daily/leaderboard";
  return apiGetJson<DailyLeaderboardResponse>(path);
}
