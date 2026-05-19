import { Injectable, Logger } from "@nestjs/common";
import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, ERROR_MESSAGES } from "@arena/shared";
import { AuthService } from "../../modules/auth/auth.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class AuthHandler extends BaseHandler {
  private readonly logger = new Logger(AuthHandler.name);
  private readonly connectedPlayers = new Map<string, string>();

  constructor(private readonly authService: AuthService) {
    super();
  }

  async handleAuthenticate(client: Socket, payload: { token: string }) {
    try {
      const decoded = this.authService.verifyToken(payload.token);

      // Kick existing connection of this user if exists (O(1) lookup)
      const oldSocketId = this.connectedPlayers.get(decoded.userId);
      if (oldSocketId && oldSocketId !== client.id) {
        const oldSocket = client.nsp?.sockets.get(oldSocketId);
        if (oldSocket) {
          this.logger.log(
            `Kicking old socket: ${oldSocketId} for user: ${decoded.userId}`,
          );
          oldSocket.emit(ServerEvent.ERROR, {
            code: ErrorCode.UNAUTHORIZED,
            message: ERROR_MESSAGES[ErrorCode.UNAUTHORIZED],
          });
          oldSocket.disconnect(true);
        }
      }

      this.connectedPlayers.set(decoded.userId, client.id);

      client.data.userId = decoded.userId;
      client.data.username = decoded.username;

      client.emit(ServerEvent.AUTHENTICATED, {
        userId: decoded.userId,
        username: decoded.username,
      });

      this.logger.log(`Player authenticated: ${decoded.username}`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(
          `Token verification failed: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(`Token verification failed: ${String(error)}`);
      }
      this.emitError(
        client,
        ErrorCode.INVALID_TOKEN,
        ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
      );
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      const currentSocketId = this.connectedPlayers.get(userId);
      // Only delete from map if the disconnected socket is the active session
      if (currentSocketId === client.id) {
        this.connectedPlayers.delete(userId);
        this.logger.log(`Player disconnected: ${userId}`);
      }
    }
  }
}
