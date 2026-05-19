import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, RoomError } from "@arena/shared";
import { BaseHandler } from "./base.handler";

// Concrete subclass to test abstract class
class TestHandler extends BaseHandler {
  testEmitError(client: Socket, code: string, message: string) {
    this.emitError(client, code, message);
  }
  testGetUserId(client: Socket) {
    return this.getUserId(client);
  }
  testRequireAuth(client: Socket) {
    return this.requireAuth(client);
  }
}

describe("BaseHandler", () => {
  let handler: TestHandler;
  let client: Socket;

  beforeEach(() => {
    handler = new TestHandler();
    client = { emit: vi.fn(), data: {} } as unknown as Socket;
  });

  it("emitError emits ServerEvent.ERROR with code and message", () => {
    handler.testEmitError(client, ErrorCode.ROOM_NOT_FOUND, "not found");
    expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
      code: ErrorCode.ROOM_NOT_FOUND,
      message: "not found",
    });
  });

  it("getUserId returns userId from client.data", () => {
    client.data.userId = "user-1";
    expect(handler.testGetUserId(client)).toBe("user-1");
  });

  it("getUserId returns null when no userId", () => {
    expect(handler.testGetUserId(client)).toBeNull();
  });

  it("requireAuth returns userId when authenticated", () => {
    client.data.userId = "user-1";
    expect(handler.testRequireAuth(client)).toBe("user-1");
  });

  it("requireAuth throws RoomError when not authenticated", () => {
    expect(() => handler.testRequireAuth(client)).toThrow(RoomError);
  });
});
