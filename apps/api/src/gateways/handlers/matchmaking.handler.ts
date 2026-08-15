// ============================================================
// Matchmaking Handler - WebSocket Event Handler for Matchmaking
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { Socket } from "socket.io";
import { ServerEvent, type JoinMatchmakingPayload } from "@arena/shared";
import { MatchmakingService } from "../../modules/matchmaking/matchmaking.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class MatchmakingHandler extends BaseHandler {
  private readonly logger = new Logger(MatchmakingHandler.name);

  constructor(private readonly matchmakingService: MatchmakingService) {
    super();
  }

  /**
   * Handle player joining matchmaking queue.
   */
  async handleJoinMatchmaking(
    client: Socket,
    payload: JoinMatchmakingPayload = {},
  ) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);
        const username =
          (client.data?.username as string) ||
          (client.data?.user?.username as string) ||
          "Player";

        const status = await this.matchmakingService.joinQueue(
          { id: userId, username },
          client.id,
          payload.category,
        );

        client.emit(ServerEvent.MATCHMAKING_STATUS, status);
      },
      (error) => {
        this.logger.error("Error handling join_matchmaking", error);
        const code = this.getErrorCode(error);
        const message = this.getErrorMessage(error);
        this.emitError(client, code, message);
      },
    );
  }

  /**
   * Handle player leaving matchmaking queue.
   */
  async handleLeaveMatchmaking(client: Socket) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);
        await this.matchmakingService.leaveQueue(userId);

        const status = await this.matchmakingService.getQueueStatus(userId);
        client.emit(ServerEvent.MATCHMAKING_STATUS, status);
      },
      (error) => {
        this.logger.error("Error handling leave_matchmaking", error);
        const code = this.getErrorCode(error);
        const message = this.getErrorMessage(error);
        this.emitError(client, code, message);
      },
    );
  }

  /**
   * Cleanup queue ticket on socket disconnect.
   */
  async handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (userId) {
      try {
        await this.matchmakingService.leaveQueue(userId, client.id);
      } catch (error) {
        this.logger.warn(
          `Failed to leave queue on socket disconnect: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
