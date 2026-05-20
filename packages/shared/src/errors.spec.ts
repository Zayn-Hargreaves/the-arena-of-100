import { describe, it, expect } from "vitest";
import { RoomError } from "./errors";
import { ErrorCode } from "./index";

describe("RoomError", () => {
  it("should create a RoomError with code and message", () => {
    const error = new RoomError(ErrorCode.ROOM_NOT_FOUND, "Room not found");

    expect(error).toBeInstanceOf(RoomError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(ErrorCode.ROOM_NOT_FOUND);
    expect(error.message).toBe("Room not found");
    expect(error.name).toBe("RoomError");
  });

  it("should use code as message when no message is provided", () => {
    const error = new RoomError(ErrorCode.ROOM_NOT_FOUND);

    expect(error.message).toBe(ErrorCode.ROOM_NOT_FOUND);
  });

  it("should be detectable with instanceof", () => {
    const error = new RoomError(ErrorCode.ROOM_NOT_FOUND);

    expect(error instanceof RoomError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});
