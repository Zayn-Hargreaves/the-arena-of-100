import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, RoomError } from "@arena/shared";

export abstract class BaseHandler {
  protected async runSafely(
    client: Socket,
    operation: () => Promise<void>,
    onError: (error: unknown) => void,
  ) {
    try {
      await operation();
    } catch (error) {
      onError(error);
    }
  }

  protected emitError(client: Socket, code: ErrorCode, message: string) {
    client.emit(ServerEvent.ERROR, { code, message });
  }

  protected getErrorCode(error: unknown): ErrorCode {
    return error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
  }

  protected getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  protected getUserId(client: Socket): string | null {
    return client.data.userId ?? null;
  }

  protected requireAuth(client: Socket): string {
    const userId = this.getUserId(client);
    if (!userId) throw new RoomError(ErrorCode.UNAUTHORIZED);
    return userId;
  }
}
