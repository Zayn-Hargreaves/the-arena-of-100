// ============================================================
// RedisIoAdapter — cross-node Socket.IO fan-out
//
// The default in-memory Socket.IO adapter only delivers a
// `server.to(room).emit(...)` to sockets connected to THIS node. Once
// the API runs as more than one instance (see infrastructure/
// docker-compose.multi.yml), players and spectators in the same match
// land on different nodes, so a room broadcast fired on node A would
// never reach a socket held by node B.
//
// `@socket.io/redis-adapter` fixes every room-scoped broadcast at once:
// it publishes each emit onto a Redis pub/sub channel that all nodes
// subscribe to, so `server.to(getRoomChannel(id)).emit(...)` fans out
// to the whole cluster with no changes at the ~15 emit sites.
//
// Wiring: main.ts calls `connectToRedis()` then
// `app.useWebSocketAdapter(this)` BEFORE `app.listen()`, so the
// gateway's Server is constructed through this adapter. The Fastify
// HTTP path is untouched — Socket.IO still binds to the same underlying
// http.Server via `super.createIOServer()`.
// ============================================================

import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { ServerOptions, Server } from "socket.io";
import Redis, { type RedisOptions } from "ioredis";
import { INestApplicationContext, Logger } from "@nestjs/common";
import { parseRedisConnectionOptions } from "../modules/redis/redis.core";

export const REDIS_QUIT_TIMEOUT_MS = 5000;
export const REDIS_READY_TIMEOUT_MS = 15000;

function isEnvRecord(
  config: unknown,
): config is Record<string, string | undefined> {
  if (!config || typeof config !== "object") return false;
  if (config === process.env) return true;
  return Object.keys(config).some((k) => k.startsWith("REDIS_"));
}

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;
  private serverCreated = false;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /**
   * Open the two dedicated Redis connections the adapter needs. `subClient`
   * enters subscriber mode, so it MUST be a separate connection from the
   * publish/command one (and from the app's shared RedisService client).
   * `maxRetriesPerRequest: null` is required by the adapter's blocking
   * subscribe — the default (3) would make it throw under a transient blip.
   */
  async connectToRedis(
    redisConfigOrUrl?:
      | string
      | RedisOptions
      | Record<string, string | undefined>,
    keyPrefix?: string,
  ): Promise<void> {
    // Re-entry would silently overwrite the refs below and leak the live
    // (or still-connecting) pair. A reconnect must go through disconnect(),
    // which quits the clients and clears all three refs.
    if (this.pubClient || this.subClient) {
      throw new Error(
        "RedisIoAdapter is already connected or connecting; call disconnect() before reconnecting",
      );
    }
    // Reconnect support ends once a Socket.IO server exists: server.adapter()
    // only takes effect at creation time, so namespaces made before a
    // reconnect would keep RedisAdapter instances bound to the quit clients
    // and nothing rebinds them — fan-out would break silently.
    if (this.serverCreated) {
      throw new Error(
        "RedisIoAdapter cannot reconnect after createIOServer(): existing Socket.IO servers keep adapters bound to the closed Redis clients",
      );
    }

    let pubClient: Redis;
    let effectiveKeyPrefix = keyPrefix;

    const defaultReconnectOnError = (err: Error): boolean | 1 | 2 => {
      if (err?.message && err.message.includes("READONLY")) {
        return 2;
      }
      return false;
    };

    if (typeof redisConfigOrUrl === "string") {
      pubClient = new Redis(redisConfigOrUrl, {
        maxRetriesPerRequest: null,
        reconnectOnError: defaultReconnectOnError,
      });
    } else if (
      redisConfigOrUrl &&
      typeof redisConfigOrUrl === "object" &&
      !isEnvRecord(redisConfigOrUrl)
    ) {
      const userOpts = redisConfigOrUrl as RedisOptions;
      const opts: RedisOptions = {
        reconnectOnError: userOpts.reconnectOnError ?? defaultReconnectOnError,
        ...userOpts,
        maxRetriesPerRequest: null,
      };
      if (!effectiveKeyPrefix && opts.keyPrefix) {
        effectiveKeyPrefix = opts.keyPrefix;
      }
      pubClient = new Redis(opts);
    } else {
      const parsed = parseRedisConnectionOptions(
        (redisConfigOrUrl as Record<string, string | undefined>) ?? process.env,
      );
      if (!effectiveKeyPrefix && parsed.options.keyPrefix) {
        effectiveKeyPrefix = parsed.options.keyPrefix;
      }
      const adapterOpts: RedisOptions = {
        ...parsed.options,
        maxRetriesPerRequest: null,
      };
      if (parsed.mode === "sentinel") {
        pubClient = new Redis(adapterOpts);
      } else {
        pubClient = new Redis(parsed.url!, adapterOpts);
      }
    }

    const subClient = pubClient.duplicate();
    this.pubClient = pubClient;
    this.subClient = subClient;

    // Surface connection errors instead of letting them go silent — a
    // dead pub/sub connection means broadcasts stop crossing nodes.
    for (const [name, client] of [
      ["pub", pubClient],
      ["sub", subClient],
    ] as const) {
      client.on("error", (err) =>
        this.logger.error(`Redis adapter ${name} client error: ${err.message}`),
      );
    }

    // Only declare the adapter connected once both connections are actually
    // ready. Failing fast on the initial connection error (instead of letting
    // ioredis retry forever) keeps startup from hanging — and from advertising
    // a cross-node broadcast path that doesn't exist. Post-ready blips are
    // retried by ioredis and surfaced via the error listeners above.
    try {
      await Promise.all([
        this.waitForReady("pub", pubClient),
        this.waitForReady("sub", subClient),
      ]);
    } catch (error) {
      // A half-open pair would keep retrying forever (maxRetriesPerRequest:
      // null) and pin the event loop — tear both clients down (disconnect()
      // also clears the refs) before surfacing the startup failure.
      await this.disconnect();
      throw error;
    }

    // Namespace the adapter's own pub/sub channels so they never collide
    // with RedisService application keys. Align with REDIS_KEY_PREFIX when
    // one is configured so a shared Redis stays cleanly partitioned.
    // Assigned only after both clients are ready, so createIOServer() can
    // never wire a constructor over clients that failed startup.
    this.adapterConstructor = createAdapter(pubClient, subClient, {
      key: effectiveKeyPrefix ? `${effectiveKeyPrefix}:socket.io` : "socket.io",
    });

    this.logger.log("Socket.IO Redis adapter connected");
  }

  private waitForReady(name: "pub" | "sub", client: Redis): Promise<void> {
    if (client.status === "ready") return Promise.resolve();
    // An already-ended client will never emit "ready" (ioredis stops retrying
    // once it reaches "end") — reject up front instead of waiting on listeners
    // that can never fire.
    if (client.status === "end") {
      return Promise.reject(
        new Error(`Redis adapter ${name} client closed before becoming ready`),
      );
    }
    return new Promise<void>((resolve, reject) => {
      // Backstop for a connection that neither errors nor becomes ready
      // (e.g. a TCP accept with no Redis behind it): bound the wait so
      // startup can't hang past the point anyone would consider healthy.
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Redis adapter ${name} client not ready after ${REDIS_READY_TIMEOUT_MS}ms`,
          ),
        );
      }, REDIS_READY_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timeout);
        client.off("ready", onReady);
        client.off("error", onError);
        client.off("end", onEnd);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(
          new Error(
            `Redis adapter ${name} client failed to connect: ${err.message}`,
          ),
        );
      };
      const onEnd = () => {
        cleanup();
        reject(
          new Error(
            `Redis adapter ${name} client closed before becoming ready`,
          ),
        );
      };
      client.once("ready", onReady);
      client.once("error", onError);
      client.once("end", onEnd);
    });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterConstructor) {
      throw new Error(
        "RedisIoAdapter.connectToRedis() must be called before createIOServer()",
      );
    }
    // Binds Socket.IO to the same http.Server Fastify uses, then swaps in
    // the Redis adapter for cross-node fan-out.
    const server: Server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    this.serverCreated = true;
    return server;
  }

  /**
   * Quit both Redis clients. If a Socket.IO server was created, its
   * per-namespace RedisAdapters still publish/unsubscribe through these
   * clients — callers must close that server (app.close()) BEFORE calling
   * this, or broadcasts during the drain hit dead connections.
   */
  async disconnect(): Promise<void> {
    const quitWithTimeout = (name: "pub" | "sub", client?: Redis) => {
      if (!client) return Promise.resolve("OK");
      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.disconnect();
          reject(
            new Error(
              `${name} client quit() timed out after ${REDIS_QUIT_TIMEOUT_MS}ms`,
            ),
          );
        }, REDIS_QUIT_TIMEOUT_MS);

        void client.quit().then(
          (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          (error) => {
            clearTimeout(timeout);
            // quit() can reject while the socket is still up (e.g. a command
            // failure) — force-close so the client can't keep retrying.
            // ioredis disconnect() is synchronous, so the client is dead
            // before this settles.
            client.disconnect();
            reject(error);
          },
        );
      });
    };

    const results = await Promise.allSettled([
      quitWithTimeout("pub", this.pubClient),
      quitWithTimeout("sub", this.subClient),
    ]);
    for (const [name, result] of [
      ["pub", results[0]],
      ["sub", results[1]],
    ] as const) {
      if (result.status === "rejected") {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        this.logger.error(
          `Redis adapter ${name} client quit() failed: ${reason}`,
        );
      }
    }

    // Clear all refs so the adapter can't hand out a constructor over quit
    // clients, a repeat disconnect() is a no-op, and connectToRedis() may be
    // called again to reconnect — but only while no Socket.IO server was
    // created yet (see the serverCreated guard in connectToRedis).
    this.pubClient = undefined;
    this.subClient = undefined;
    this.adapterConstructor = undefined;
  }
}
