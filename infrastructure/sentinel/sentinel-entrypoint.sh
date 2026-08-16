#!/bin/sh
# ============================================================
# Sentinel bootstrap.
#
# Runtime state lives in the named volume at /data/sentinel.conf so
# failover-updated master addresses survive restarts.
#
# Seed template is copied only when the volume file is missing.
# After editing ./sentinel/sentinel.conf, reset Sentinel volumes to
# re-seed, e.g.:
#   docker compose -f infrastructure/docker-compose.sentinel.yml down
#   docker volume rm the-arena-of-100_redis_sentinel1_data \
#     the-arena-of-100_redis_sentinel2_data \
#     the-arena-of-100_redis_sentinel3_data
# (volume names may include a project prefix — check `docker volume ls`)
# ============================================================
set -eu

if [ ! -f /data/sentinel.conf ]; then
  echo "sentinel: seeding /data/sentinel.conf from mounted template" >&2
  cp /etc/redis/sentinel.conf /data/sentinel.conf
fi

exec redis-sentinel /data/sentinel.conf
