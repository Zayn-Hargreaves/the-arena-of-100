#!/usr/bin/env bash
# ============================================================
# Poll pg_stat_activity every 2s, append to JSONL.
# Fields: timestamp, total, idle, active, idle_in_txn, max_age_s,
#         by_state (json string), top_apps (json string)
#
# Used to prove "DB pool is NOT the bottleneck" during ceiling sweeps.
# ============================================================
set -euo pipefail

OUT="${1:?usage: poll-pg.sh <out.jsonl> <container> [interval_seconds]}"
CONTAINER="${2:-arena-multi-postgres}"
INTERVAL="${3:-2}"

touch "$OUT"
echo "pg poller started: $OUT, container=$CONTAINER, interval=${INTERVAL}s"

trap 'echo "pg poller stopped"' EXIT

while true; do
  TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  # Single docker exec → psql → emit JSON
  # Use unaligned, tuples-only output
  LINE="$(docker exec "$CONTAINER" \
    psql -U arena -d arena_of_100 -tA -F'|' -c "
      SELECT
        count(*) FILTER (WHERE state IS NULL OR state = ''),
        count(*) FILTER (WHERE state = 'idle'),
        count(*) FILTER (WHERE state = 'active'),
        count(*) FILTER (WHERE state = 'idle in transaction'),
        count(*) FILTER (WHERE state = 'idle in transaction (aborted)'),
        COALESCE(EXTRACT(EPOCH FROM (now() - min(state_change)))::int, 0)
      FROM pg_stat_activity
      WHERE application_name != 'psql';
    " 2>/dev/null || echo 'NA|NA|NA|NA|NA|NA')"
  echo "$TS|$LINE" >> "$OUT"
  sleep "$INTERVAL"
done