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
  return apiGetJson<DailyTodayResponse>("/daily/today", token);
}

export async function submitDaily(
  body: DailySubmitInput,
  token: string,
): Promise<DailySubmitResponse> {
  return apiSendJson<DailySubmitResponse>("/daily/submit", "POST", body, token);
}

/**
 * Builds the leaderboard querystring, omitting empty/undefined
 * values so we never send `dateKey=` (which would fail the
 * YYYY-MM-DD DTO check).
 */
function buildLeaderboardQuery(query: DailyLeaderboardQuery): string {
  const search = new URLSearchParams();

  const dateKey = query.dateKey?.trim();
  if (dateKey) search.set("dateKey", dateKey);

  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }

  return search.toString();
}

export async function getDailyLeaderboard(
  query: DailyLeaderboardQuery = {},
): Promise<DailyLeaderboardResponse> {
  const qs = buildLeaderboardQuery(query);
  const path = qs ? `/daily/leaderboard?${qs}` : "/daily/leaderboard";
  return apiGetJson<DailyLeaderboardResponse>(path);
}
