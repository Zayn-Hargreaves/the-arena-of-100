// ============================================================
// ClusterService — this node's identity + local runtime view
//
// Holds the stable per-instance `nodeId` (used from Stage B on as the
// value of the Redis owner-lease `match:owner:<matchId>`), a reference
// to the Socket.IO server for a LOCAL socket count, and a read of which
// matches this node currently owns.
//
// Ownership tracking moved to `MatchOwnershipService` (B2b), whose in-memory
// owned set supersedes the old Stage-A `getOwnedMatchIds` SCAN. ClusterService
// now stays responsible only for `nodeId` and the local socket-count metric,
// so it never depends on match ownership (which depends on it for `nodeId`).
// ============================================================

import { Injectable } from "@nestjs/common";
import os from "os";
import type { Namespace, Server } from "socket.io";

@Injectable()
export class ClusterService {
  /** Stable identity for this process. In the multi-instance topology
   *  INSTANCE_ID is set per replica (api-1/2/3); falls back to hostname. */
  readonly nodeId = process.env.INSTANCE_ID || os.hostname();

  // A namespaced gateway (@WebSocketGateway({ namespace: "/game" })) hands
  // afterInit the /game Namespace, not the root Server — same object
  // presence/gameLoop receive and call `.to(room).emit()` on.
  private server?: Namespace | Server;

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
}
