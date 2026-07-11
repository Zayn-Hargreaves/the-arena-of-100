// ============================================================
// Shared custom metrics for the Đấu Trường 100 load test.
//
// Plan A A2 asks for: p50/p95/p99 latency (answer -> result echo),
// disconnect rate, messages/sec, error rate. These are the k6 series
// that back the README results table.
// ============================================================

import { Trend, Counter, Rate } from "k6/metrics";

// answer -> answer_result round-trip, measured client-side (ms).
// `true` => k6 treats it as a time metric (nice p95/p99 formatting).
export const answerLatency = new Trend("answer_result_latency_ms", true);

// Volume counters.
export const wsConnected = new Counter("ws_connected");
export const wsMessagesReceived = new Counter("ws_messages_received");
export const answersSubmitted = new Counter("answers_submitted");
export const roundStarted = new Counter("round_started_received");
export const matchFinished = new Counter("match_finished_received");

// Failure counters.
export const authErrors = new Counter("auth_errors");
export const setupErrors = new Counter("setup_flow_errors"); // auth/join handshake failed
export const serverErrors = new Counter("server_error_events"); // ServerEvent.ERROR frames
export const wsConnectErrors = new Counter("ws_connect_errors");
export const wsDisconnectErrors = new Counter("ws_disconnect_errors");

// App-level error rate: false on each successful handshake step, true on
// each failure. Threshold target is config.errorRateMax (Plan A: < 1%).
export const appErrorRate = new Rate("app_error_rate");
