import { Injectable, Logger } from "@nestjs/common";
import { Socket } from "socket.io";
import { ServerEvent, ErrorCode } from "@arena/shared";
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
      this.emitError(client, ErrorCode.INVALID_TOKEN, "Token không hợp lệ");
    }
  }

  handleDisconnect(client: Socket) {
    // Find userId by socketId since we now only store socketId in the value
    let userIdToDelete: string | undefined;
    for (const [userId, socketId] of this.connectedPlayers.entries()) {
      if (socketId === client.id) {
        userIdToDelete = userId;
        break;
      }
    }

    if (userIdToDelete) {
      this.connectedPlayers.delete(userIdToDelete);
      this.logger.log(`Player disconnected: ${userIdToDelete}`);
    }
  }
}
