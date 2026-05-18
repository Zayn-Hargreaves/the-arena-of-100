import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, RoomError } from "@arena/shared";

export abstract class BaseHandler {
  protected emitError(client: Socket, code: string, message: string) {
    client.emit(ServerEvent.ERROR, { code, message });
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
