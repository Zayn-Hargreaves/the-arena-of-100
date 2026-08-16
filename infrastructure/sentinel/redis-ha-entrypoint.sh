#!/bin/sh
# ============================================================
# Redis node bootstrap for Sentinel HA (master + replicas).
#
# Env:
#   REDIS_NODE_NAME         Compose service name (e.g. redis-master)
#   REDIS_CONTAINER_NAME    container_name (e.g. arena-redis-master)
#   REDIS_BOOTSTRAP_PRIMARY If "1", may start as primary when Sentinel
#                           has no master yet or is unreachable (cold start).
#                           Replicas must leave this unset/0 — fail-fast.
#   MASTER_NAME             Sentinel monitor name (default: mymaster)
#   SENTINEL_HOSTS          Space-separated Sentinel hostnames
#   SENTINEL_PORT           Default 26379
#   DISCOVERY_ATTEMPTS      Default 30 (~60s with sleep 2)
#   DISCOVERY_SLEEP_SECS    Default 2
#   BOOTSTRAP_NO_SENTINEL_AFTER  Attempts with zero reachable Sentinels
#                           before bootstrap primary (default 3)
# ============================================================
set -eu

MASTER_NAME="${MASTER_NAME:-mymaster}"
SENTINEL_HOSTS="${SENTINEL_HOSTS:-redis-sentinel-1 redis-sentinel-2 redis-sentinel-3}"
SENTINEL_PORT="${SENTINEL_PORT:-26379}"
DISCOVERY_ATTEMPTS="${DISCOVERY_ATTEMPTS:-30}"
DISCOVERY_SLEEP_SECS="${DISCOVERY_SLEEP_SECS:-2}"
BOOTSTRAP_NO_SENTINEL_AFTER="${BOOTSTRAP_NO_SENTINEL_AFTER:-1}"
BOOTSTRAP="${REDIS_BOOTSTRAP_PRIMARY:-0}"

MASTER_HOST=""
MASTER_PORT=""
SENTINEL_SEEN=0

is_self() {
  _host="$1"
  _my_ip="$(hostname -i 2>/dev/null | awk '{print $1}')"
  _my_host="$(hostname 2>/dev/null)"

  [ -n "$_my_host" ] && [ "$_host" = "$_my_host" ] && return 0
  [ -n "$_my_ip" ] && [ "$_host" = "$_my_ip" ] && return 0
  [ -n "${REDIS_NODE_NAME:-}" ] && [ "$_host" = "$REDIS_NODE_NAME" ] && return 0
  [ -n "${REDIS_CONTAINER_NAME:-}" ] && [ "$_host" = "$REDIS_CONTAINER_NAME" ] && return 0
  return 1
}

valid_port() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# Wall-clock cap: redis-cli -t does not cover DNS hangs for down hosts.
CLI_TIMEOUT="${REDIS_CLI_TIMEOUT:-1}"
cli() {
  # busybox timeout: exit 143/124 on kill
  timeout "$CLI_TIMEOUT" redis-cli -t "$CLI_TIMEOUT" "$@"
}

i=1
while [ "$i" -le "$DISCOVERY_ATTEMPTS" ]; do
  for sentinel in $SENTINEL_HOSTS; do
    if ! cli -h "$sentinel" -p "$SENTINEL_PORT" ping >/dev/null 2>&1; then
      continue
    fi
    SENTINEL_SEEN=1

    # shellcheck disable=SC2046
    set -- $(cli -h "$sentinel" -p "$SENTINEL_PORT" SENTINEL get-master-addr-by-name "$MASTER_NAME" 2>/dev/null || true)
    if [ "$#" -eq 2 ] \
      && [ "$1" != "(nil)" ] && [ "$1" != "nil" ] \
      && [ -n "$1" ] && valid_port "$2"; then
      MASTER_HOST="$1"
      MASTER_PORT="$2"
      break 2
    fi
  done

  # Cold start: bootstrap primary must not wait on Sentinels that depend on it.
  if [ "$BOOTSTRAP" = "1" ] && [ "$SENTINEL_SEEN" -eq 0 ] && [ "$i" -ge "$BOOTSTRAP_NO_SENTINEL_AFTER" ]; then
    echo "redis-ha: no Sentinel reachable after ${i} attempts; bootstrapping as primary" >&2
    exec redis-server --appendonly yes
  fi

  echo "redis-ha: waiting for Sentinel master '${MASTER_NAME}' (attempt ${i}/${DISCOVERY_ATTEMPTS})..." >&2
  sleep "$DISCOVERY_SLEEP_SECS"
  i=$((i + 1))
done

if [ -z "$MASTER_HOST" ] || [ -z "$MASTER_PORT" ]; then
  if [ "$BOOTSTRAP" = "1" ]; then
    echo "redis-ha: Sentinel reachable but no master yet; bootstrapping as primary" >&2
    exec redis-server --appendonly yes
  fi
  echo "redis-ha: ERROR: could not discover master from Sentinel after ${DISCOVERY_ATTEMPTS} attempts; refusing guessed topology" >&2
  exit 1
fi

if is_self "$MASTER_HOST"; then
  echo "redis-ha: this node is current master (${MASTER_HOST}); starting as primary" >&2
  exec redis-server --appendonly yes
fi

echo "redis-ha: starting as replica of ${MASTER_HOST}:${MASTER_PORT}" >&2
exec redis-server --appendonly yes --replicaof "$MASTER_HOST" "$MASTER_PORT"
