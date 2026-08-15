// ============================================================
// Matchmaking Queue Store - Redis Store for Matchmaking Tickets
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

export interface MatchmakingTicket {
  userId: string;
  username: string;
  elo: number;
  socketId: string;
  category?: string;
  joinedAt: number; // Unix timestamp in ms
}

export const MATCHMAKING_QUEUE_ZSET = "matchmaking:queue:zset";
export const MATCHMAKING_TICKET_PREFIX = "matchmaking:ticket:";
export const MATCHMAKING_TICKET_TTL_SEC = 300; // 5 minutes

@Injectable()
export class MatchmakingQueueStore {
  private readonly logger = new Logger(MatchmakingQueueStore.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Add or update a player's matchmaking ticket in Redis.
   */
  async addTicket(ticket: MatchmakingTicket): Promise<void> {
    const client = this.redis.getClient();
    const ticketKey = `${MATCHMAKING_TICKET_PREFIX}${ticket.userId}`;
    const payload = JSON.stringify(ticket);

    const pipeline = client.pipeline();
    pipeline.set(ticketKey, payload, "EX", MATCHMAKING_TICKET_TTL_SEC);
    pipeline.zadd(MATCHMAKING_QUEUE_ZSET, ticket.elo, ticket.userId);
    await pipeline.exec();
  }

  /**
   * Remove a player's ticket from the queue.
   * If socketId is provided, only removes if the stored ticket belongs to that socket.
   */
  async removeTicket(userId: string, socketId?: string): Promise<boolean> {
    const client = this.redis.getClient();
    const ticketKey = `${MATCHMAKING_TICKET_PREFIX}${userId}`;

    if (socketId) {
      const luaScript = `
        local raw = redis.call('GET', KEYS[1])
        if not raw then
          return 0
        end
        local ticket = cjson.decode(raw)
        if ticket.socketId ~= ARGV[2] then
          return 0
        end
        redis.call('DEL', KEYS[1])
        return redis.call('ZREM', KEYS[2], ARGV[1])
      `;
      try {
        const result = (await client.eval(
          luaScript,
          2,
          ticketKey,
          MATCHMAKING_QUEUE_ZSET,
          userId,
          socketId,
        )) as number;
        return Number(result) > 0;
      } catch (err) {
        this.logger.error("Failed to execute removeTicket Lua script", err);
        return false;
      }
    }

    const pipeline = client.pipeline();
    pipeline.del(ticketKey);
    pipeline.zrem(MATCHMAKING_QUEUE_ZSET, userId);
    const results = await pipeline.exec();

    // Check if the key was in the sorted set
    const zremResult = results?.[1]?.[1];
    return Number(zremResult) > 0;
  }

  /**
   * Retrieve a player's ticket if it exists.
   */
  async getTicket(userId: string): Promise<MatchmakingTicket | null> {
    const ticketKey = `${MATCHMAKING_TICKET_PREFIX}${userId}`;
    return this.redis.getJSON<MatchmakingTicket>(ticketKey);
  }

  /**
   * Get total number of players waiting in the queue.
   */
  async getQueueCount(): Promise<number> {
    const client = this.redis.getClient();
    return client.zcard(MATCHMAKING_QUEUE_ZSET);
  }

  /**
   * Get all active tickets in the queue sorted by ELO.
   * Auto-prunes stale entries whose ticket JSON expired.
   */
  async getAllTickets(): Promise<MatchmakingTicket[]> {
    const client = this.redis.getClient();
    const userIds = await client.zrange(MATCHMAKING_QUEUE_ZSET, 0, -1);
    if (!userIds || userIds.length === 0) {
      return [];
    }

    const ticketKeys = userIds.map((id) => `${MATCHMAKING_TICKET_PREFIX}${id}`);
    const payloads = await client.mget(...ticketKeys);

    const activeTickets: MatchmakingTicket[] = [];
    const staleUserIds: string[] = [];

    for (let i = 0; i < userIds.length; i++) {
      const raw = payloads[i];
      const userId = userIds[i];
      if (!raw) {
        staleUserIds.push(userId);
      } else {
        try {
          activeTickets.push(JSON.parse(raw) as MatchmakingTicket);
        } catch {
          staleUserIds.push(userId);
        }
      }
    }

    if (staleUserIds.length > 0) {
      await client.zrem(MATCHMAKING_QUEUE_ZSET, ...staleUserIds);
      this.logger.debug(
        `Pruned ${staleUserIds.length} stale tickets from matchmaking queue`,
      );
    }

    return activeTickets;
  }

  /**
   * Atomically pop a group of matched tickets from the queue.
   * Ensures that no concurrent worker or race condition can pop the same tickets twice.
   */
  async atomicPopTickets(userIds: string[]): Promise<MatchmakingTicket[]> {
    if (userIds.length === 0) return [];

    const client = this.redis.getClient();
    const ticketKeys = userIds.map((id) => `${MATCHMAKING_TICKET_PREFIX}${id}`);

    // Lua script: Checks existence of all tickets, fetches them, and atomically deletes them.
    const luaScript = `
      local popped = {}
      local foundAll = true
      for i, key in ipairs(KEYS) do
        local val = redis.call('GET', key)
        if val then
          table.insert(popped, val)
        else
          foundAll = false
        end
      end
      
      if not foundAll then
        for i, key in ipairs(KEYS) do
          local val = redis.call('GET', key)
          if not val then
            redis.call('ZREM', '${MATCHMAKING_QUEUE_ZSET}', ARGV[i])
          end
        end
        return {}
      end
      
      -- Remove from zset and delete keys
      for i, userId in ipairs(ARGV) do
        redis.call('ZREM', '${MATCHMAKING_QUEUE_ZSET}', userId)
        redis.call('DEL', '${MATCHMAKING_TICKET_PREFIX}' .. userId)
      end
      
      return popped
    `;

    try {
      const results = (await client.eval(
        luaScript,
        ticketKeys.length,
        ...ticketKeys,
        ...userIds,
      )) as string[];

      if (!results || !Array.isArray(results)) {
        return [];
      }

      return results.map((r) => JSON.parse(r) as MatchmakingTicket);
    } catch (err) {
      this.logger.error("Failed to execute atomicPopTickets Lua script", err);
      return [];
    }
  }
}
