// ============================================================
// ClusterService — this node's identity + local runtime view
//
// Holds the stable per-instance `nodeId` (used from Stage B on as the
// value of the Redis owner-lease `match:owner:<matchId>`), a reference
// to the Socket.IO server for a LOCAL socket count, and a read of which
// matches this node currently owns.
//
// `getOwnedMatchIds()` is a Stage-A placeholder that SCANs
// `match:owner:*` and filters by this node's id. Stage B introduces
// `MatchOwnershipService` with an in-memory owned set and will supersede
// this scan (no owner keys exist yet, so today it returns []).
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import os from "os";
import type { Namespace, Server } from "socket.io";
import { RedisService } from "../redis/redis.service";

const OWNER_KEY_PREFIX = "match:owner:";

@Injectable()
export class ClusterService {
  private readonly logger = new Logger(ClusterService.name);
  /** Stable identity for this process. In the multi-instance topology
   *  INSTANCE_ID is set per replica (api-1/2/3); falls back to hostname. */
  readonly nodeId = process.env.INSTANCE_ID || os.hostname();

  // A namespaced gateway (@WebSocketGateway({ namespace: "/game" })) hands
  // afterInit the /game Namespace, not the root Server — same object
  // presence/gameLoop receive and call `.to(room).emit()` on.
  private server?: Namespace | Server;

  constructor(private readonly redis: RedisService) {}

  /** Wired from GameGateway.afterInit, mirroring presence/gameLoop.setServer. */
  setServer(server: Namespace | Server): void {
    this.server = server;
  }

  /** Sockets connected to THIS node's /game namespace (per-node, not cluster).
   *  With the Redis adapter, `.sockets` stays local; `fetchSockets()` is the
   *  cross-node variant — we want the per-node number for distribution checks. */
  getLocalSocketCount(): number {
    // Namespace.sockets is a Map<SocketId, Socket> of local sockets.
    const ns = this.server as Namespace | undefined;
    return ns?.sockets?.size ?? 0;
  }

  /** Matches owned by this node. Stage-A fallback via SCAN over the owner
   *  keys; superseded by MatchOwnershipService's in-memory set in Stage B. */
  async getOwnedMatchIds(): Promise<string[]> {
    try {
      const client = this.redis.getClient();
      const owned: string[] = [];
      let cursor = "0";
      do {
        const [next, keys] = await client.scan(
          cursor,
          "MATCH",
          `${OWNER_KEY_PREFIX}*`,
          "COUNT",
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          const values = await client.mget(...keys);
          keys.forEach((key, i) => {
            const value = values[i];
            // Owner value is "<nodeId>:<fence>" (Stage B); tolerate a bare id.
            if (
              value &&
              (value === this.nodeId || value.startsWith(`${this.nodeId}:`))
            ) {
              owned.push(key.slice(OWNER_KEY_PREFIX.length));
            }
          });
        }
      } while (cursor !== "0");
      return owned;
    } catch (err) {
      this.logger.warn(
        `getOwnedMatchIds scan failed: ${(err as Error).message}`,
      );
      return [];
    }
  }
}
