import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, ERROR_MESSAGES } from "@arena/shared";
import { AuthHandler } from "./auth.handler";
import { AuthService } from "../../modules/auth/auth.service";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { PresenceService } from "../../modules/match/presence.service";

describe("AuthHandler", () => {
  let handler: AuthHandler;
  let authService: AuthService;
  let roomService: RoomService;
  let matchService: MatchService;
  let gameLoopService: GameLoopService;
  let presenceService: PresenceService;
  let client: Socket;

  let mockSockets: Map<string, any>;

  beforeEach(() => {
    authService = { verifyToken: vi.fn() } as unknown as AuthService;
    roomService = {
      getUserActiveRooms: vi.fn().mockResolvedValue([]),
    } as unknown as RoomService;
    matchService = {
      getStateMachine: vi.fn(),
      persistStateMachine: vi.fn(),
    } as unknown as MatchService;
    gameLoopService = {
      handlePlayerDisconnect: vi.fn(),
      getCountdownEnd: vi.fn().mockResolvedValue(null),
    } as unknown as GameLoopService;
    presenceService = {
      isPresent: vi.fn().mockResolvedValue(true),
      updatePresence: vi.fn().mockResolvedValue(undefined),
    } as unknown as PresenceService;
    handler = new AuthHandler(
      authService,
      roomService,
      matchService,
      gameLoopService,
      presenceService,
    );
    mockSockets = new Map();
    client = {
      id: "socket-1",
      emit: vi.fn(),
      disconnect: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      data: {},
      // Default empty rooms set — tests that exercise the sync
      // `client.leave(room:*)` cleanup override this with the rooms
      // they expect the socket to be joined to.
      rooms: new Set<string>(),
      nsp: {
        sockets: mockSockets,
        // Required for handleDisconnect's match-notification path.
        server: { to: vi.fn() },
      },
    } as unknown as Socket;
  });

  describe("handleAuthenticate", () => {
    it("sets client data and emits AUTHENTICATED on valid token", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      await handler.handleAuthenticate(client, { token: "valid-token" });

      expect(client.data.userId).toBe("u1");
      expect(client.data.username).toBe("Alice");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.AUTHENTICATED, {
        userId: "u1",
        username: "Alice",
      });
    });

    it("emits error on invalid token", async () => {
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await handler.handleAuthenticate(client, { token: "bad" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_TOKEN,
        message: ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
      });
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw "string error";
      });

      await handler.handleAuthenticate(client, { token: "bad" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_TOKEN,
        message: ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
      });
    });

    // L2 fix: when the validation pipe (WsValidationPipe) throws
    // a `WsValidationError` (a `RoomError` with code
    // `INVALID_PAYLOAD`), the handler surfaces that error code
    // directly to the client instead of mapping it to the
    // generic `INVALID_TOKEN`. The client can then distinguish
    // "your payload is malformed" from "your token is bad" and
    // fix the right thing.
    //
    // In the spec we call `handleAuthenticate` directly (the
    // pipe runs at the gateway layer, before the handler), so
    // we exercise the handler's catch by mocking `verifyToken`
    // to throw the same `RoomError(INVALID_PAYLOAD)` that the
    // pipe would have thrown.
    it("emits INVALID_PAYLOAD (not INVALID_TOKEN) when a RoomError(INVALID_PAYLOAD) bubbles up", async () => {
      const { RoomError } = await import("@arena/shared");
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw new RoomError(ErrorCode.INVALID_PAYLOAD, "Missing token");
      });

      await handler.handleAuthenticate(client, { token: "bad" });

      // The handler must emit the payload-shape error, NOT
      // the generic INVALID_TOKEN, so the client knows to
      // fix the request shape rather than the credentials.
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_PAYLOAD,
        message: expect.stringContaining("Missing token"),
      });
      // Defensive: the handler must NOT have emitted
      // INVALID_TOKEN. A regression to the old code that
      // would map every error to INVALID_TOKEN would fail
      // this assertion.
      const emitCalls = vi.mocked(client.emit).mock.calls;
      const invalidTokenEmits = emitCalls.filter(
        (call) =>
          call[0] === ServerEvent.ERROR &&
          (call[1] as { code: string }).code === ErrorCode.INVALID_TOKEN,
      );
      expect(invalidTokenEmits).toHaveLength(0);
    });

    it("kicks previous socket connection when same user authenticates", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      const oldSocket = {
        id: "socket-old",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: { userId: "u1" },
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(oldSocket.id, oldSocket);

      // First authentication
      await handler.handleAuthenticate(oldSocket, { token: "t1" });

      // Second authentication with same userId on different socket
      const newSocket = {
        id: "socket-new",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: {},
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(newSocket.id, newSocket);

      await handler.handleAuthenticate(newSocket, { token: "t2" });

      // Verify old socket was kicked
      expect(oldSocket.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.UNAUTHORIZED,
        message: ERROR_MESSAGES[ErrorCode.UNAUTHORIZED],
      });
      expect(oldSocket.disconnect).toHaveBeenCalledWith(true);

      // Verify new socket authenticated successfully
      expect(newSocket.data.userId).toBe("u1");
      expect(newSocket.emit).toHaveBeenCalledWith(ServerEvent.AUTHENTICATED, {
        userId: "u1",
        username: "Alice",
      });
    });

    it("cleans up previous user mapping when same socket re-authenticates as a different user", async () => {
      // C3/previousUserId branch: when a socket was previously
      // authenticated as user "u1" and then re-authenticates as
      // "u2", the handler must clean up u1's tracked connection
      // (connectedPlayers + connectionGeneration) and notify u1's
      // active matches of the disconnect.
      vi.mocked(authService.verifyToken)
        .mockReturnValueOnce({
          userId: "u1",
          username: "Alice",
          role: "GUEST" as any,
        })
        .mockReturnValueOnce({
          userId: "u2",
          username: "Bob",
          role: "GUEST" as any,
        });

      // First auth as u1 — client is joined to room:r1 so the
      // disconnect cleanup will leave it. Empty rooms mock for the
      // first auth's syncReconnection.
      (client as any).rooms = new Set<string>(["socket-1", "room:r1"]);
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValueOnce([]);
      await handler.handleAuthenticate(client, { token: "t1" });
      expect(client.data.userId).toBe("u1");

      // Mock getUserActiveRooms for u1's disconnect cleanup
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValueOnce([
        {
          room: { id: "r1", currentMatchId: "m1" },
        },
      ] as any);

      // Re-authenticate the SAME socket as u2
      await handler.handleAuthenticate(client, { token: "t2" });

      // u1's active rooms should have been notified of disconnect
      expect(roomService.getUserActiveRooms).toHaveBeenCalledWith("u1");
      expect(gameLoopService.handlePlayerDisconnect).toHaveBeenCalledWith(
        "m1",
        "u1",
        expect.anything(),
      );

      // The socket must leave every room channel u1 was joined to so
      // the reused client cannot receive broadcasts for the old user.
      expect(client.leave).toHaveBeenCalledWith("room:r1");

      // Socket now belongs to u2
      expect(client.data.userId).toBe("u2");
      expect(client.data.username).toBe("Bob");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.AUTHENTICATED, {
        userId: "u2",
        username: "Bob",
      });

      // u1's mapping should be cleaned up
      expect((handler as any).connectedPlayers.has("u1")).toBe(false);
      expect((handler as any).connectionGeneration.has("u1")).toBe(false);
      // u2's mapping should exist
      expect((handler as any).connectedPlayers.get("u2")).toBe(client.id);
    });

    it("skips user-switch cleanup when previousUserId matches the new decoded userId", async () => {
      // Edge case: the socket's client.data.userId is already the
      // same as the newly decoded userId. The previousUserId check
      // must NOT fire handleTrackedUserSwitchDisconnect.
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      // First auth
      await handler.handleAuthenticate(client, { token: "t1" });
      expect(client.data.userId).toBe("u1");

      // Record call count after first auth (syncReconnection calls getUserActiveRooms)
      const callsAfterFirst = vi.mocked(gameLoopService.handlePlayerDisconnect)
        .mock.calls.length;

      // Re-authenticate the SAME socket with the SAME user
      await handler.handleAuthenticate(client, { token: "t1" });

      // handlePlayerDisconnect should NOT have been called again —
      // same user means the previousUserId branch is skipped entirely.
      expect(gameLoopService.handlePlayerDisconnect).toHaveBeenCalledTimes(
        callsAfterFirst,
      );
    });

    // Regression for the reconnect-during-await race in
    // handleTrackedUserSwitchDisconnect: when a new socket
    // authenticates as the same user during the awaited
    // getUserActiveRooms call, the match-notify path must be
    // skipped (the new socket's session is canonical). Without
    // the re-check of `connectedPlayers.has(userId)`, the old
    // socket's disconnect would propagate to the state machine
    // and mark a live player as DISCONNECTED.
    it("skips handlePlayerDisconnect when a newer socket authenticates during the awaited disconnect cleanup", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u-race",
        username: "Alice",
        role: "GUEST" as any,
      });

      // First socket authenticates as u-race.
      const socket1 = {
        id: "socket-1",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: {},
        // Simulate the socket having been joined to r1 so the
        // sync leave loop has something to iterate.
        rooms: new Set<string>(["socket-1", "room:r1"]),
        nsp: { sockets: mockSockets, server: { to: vi.fn() } },
      } as unknown as Socket;
      mockSockets.set(socket1.id, socket1);
      await handler.handleAuthenticate(socket1, { token: "t1" });
      expect((handler as any).connectedPlayers.get("u-race")).toBe(socket1.id);

      // Drive handleDisconnect on socket1 — but do NOT await it yet
      // because we want to interleave a re-authenticate during the
      // awaited getUserActiveRooms. We mock getUserActiveRooms to
      // expose a controllable promise so the interleaving is
      // deterministic.
      let resolveGetRooms!: (rooms: any) => void;
      const getRoomsPromise = new Promise<any>((resolve) => {
        resolveGetRooms = resolve;
      });
      vi.mocked(roomService.getUserActiveRooms).mockReturnValueOnce(
        getRoomsPromise as any,
      );

      const disconnectPromise = handler.handleDisconnect(socket1);

      // While handleDisconnect is awaiting getUserActiveRooms,
      // simulate a NEW socket authenticating as u-race. This
      // populates connectedPlayers[u-race] again.
      const socket2 = {
        id: "socket-2",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: {},
        nsp: { sockets: mockSockets, server: { to: vi.fn() } },
      } as unknown as Socket;
      mockSockets.set(socket2.id, socket2);
      await handler.handleAuthenticate(socket2, { token: "t2" });
      expect((handler as any).connectedPlayers.get("u-race")).toBe(socket2.id);

      // Now resolve the pending getUserActiveRooms with an active
      // match. The re-check inside the notify loop must see that
      // connectedPlayers[u-race] is non-empty (a new socket took
      // over) and skip handlePlayerDisconnect.
      resolveGetRooms([{ room: { id: "r1", currentMatchId: "m1" } }]);
      await disconnectPromise;

      // The new session must NOT be marked as DISCONNECTED — the
      // notify path was correctly skipped because a newer socket
      // took over u-race during the await.
      expect(gameLoopService.handlePlayerDisconnect).not.toHaveBeenCalled();
      // socket1 was still told to leave the room channel (sync,
      // before the await), so a future broadcast for the old user
      // does not reach this reused socket.
      expect(socket1.leave).toHaveBeenCalledWith("room:r1");
    });
  });

  describe("handleDisconnect", () => {
    it("removes player from connected map on disconnect", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client, { token: "t" });

      handler.handleDisconnect(client);

      // Authenticate again with new socket to verify old mapping removed
      const client2 = {
        id: "socket-2",
        emit: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: {},
        nsp: {
          sockets: mockSockets,
        },
      } as unknown as Socket;
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client2, { token: "t" });
      expect(client2.data.userId).toBe("u1");
    });

    it("handles disconnect for unknown socket gracefully", () => {
      expect(() => handler.handleDisconnect(client)).not.toThrow();
    });

    it("does not delete mapping if active session socket ID is different", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      const oldSocket = {
        id: "socket-old",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        data: { userId: "u1" },
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(oldSocket.id, oldSocket);

      // Authenticate old socket
      await handler.handleAuthenticate(oldSocket, { token: "t1" });

      // Authenticate new socket
      const newSocket = {
        id: "socket-new",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: { userId: "u1" },
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(newSocket.id, newSocket);
      await handler.handleAuthenticate(newSocket, { token: "t2" });

      // Trigger disconnect on old socket
      handler.handleDisconnect(oldSocket);

      // Try authenticating a third socket.
      // If the map entry was deleted, the kick logic wouldn't run.
      // We check that the mapping still exists by showing newSocket is still in the map and will be kicked if we connect socket3
      const thirdSocket = {
        id: "socket-third",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        data: {},
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(thirdSocket.id, thirdSocket);

      await handler.handleAuthenticate(thirdSocket, { token: "t3" });

      // newSocket should have been kicked because it was still in the map
      expect(newSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it("notifies active matches of player disconnect", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client, { token: "t" });

      (client.nsp as any).server = { to: vi.fn() } as any;

      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        {
          joinedAt: new Date(),
          room: {
            id: "r1",
            currentMatchId: "m1",
          },
        },
      ] as any);

      await handler.handleDisconnect(client);

      expect(roomService.getUserActiveRooms).toHaveBeenCalledWith("u1");
      expect(gameLoopService.handlePlayerDisconnect).toHaveBeenCalledWith(
        "m1",
        "u1",
        client.nsp.server,
      );
    });

    it("handles getUserActiveRooms error on disconnect gracefully", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client, { token: "t" });

      vi.mocked(roomService.getUserActiveRooms).mockRejectedValue(
        new Error("db failure"),
      );

      const warnSpy = vi.spyOn(handler["logger"], "warn");

      await expect(handler.handleDisconnect(client)).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to notify match of disconnect for u1"),
        expect.any(Error),
      );
    });
  });

  describe("reconnection sync", () => {
    beforeEach(() => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
    });

    it("rejoins active rooms after authentication", async () => {
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        {
          joinedAt: new Date(),
          room: {
            id: "r1",
            code: "ABC",
            type: "PUBLIC",
            status: "WAITING",
            hostId: "u1",
            currentMatchId: null,
            players: [{ userId: "u1", user: { username: "Alice" } }],
          },
        },
      ] as any);

      await handler.handleAuthenticate(client, { token: "t" });

      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(presenceService.updatePresence).toHaveBeenCalledWith("r1", "u1");
      // updatePresence must run before the ROOM_JOINED emit so the player
      // list sent to the client reflects the user as online.
      const updatePresenceOrder = vi.mocked(presenceService.updatePresence).mock
        .invocationCallOrder[0];
      const emitOrder = (client.emit as any).mock.invocationCallOrder.find(
        (n: number) => n > updatePresenceOrder,
      );
      expect(updatePresenceOrder).toBeDefined();
      expect(emitOrder).toBeDefined();
      expect(updatePresenceOrder).toBeLessThan(emitOrder as number);
      expect(presenceService.isPresent).toHaveBeenCalledWith("r1", "u1");
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ROOM_JOINED,
        expect.objectContaining({
          roomId: "r1",
          code: "ABC",
          roomType: "PUBLIC",
          roomStatus: "WAITING",
          players: expect.arrayContaining([
            expect.objectContaining({
              playerId: "u1",
              playerName: "Alice",
              isOnline: true,
            }),
          ]),
        }),
      );
    });

    it("emits snapshot, restores player status to active, and persists state machine when active match exists", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        {
          joinedAt: new Date(),
          room: {
            id: "r1",
            code: "ABC",
            currentMatchId: "m1",
            players: [{ userId: "u1", user: { username: "Alice" } }],
          },
        },
      ] as any);

      const mockStateMachine = {
        reconnectPlayer: vi.fn(),
        getSnapshot: vi.fn().mockReturnValue(snapshot),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockStateMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue();

      await handler.handleAuthenticate(client, { token: "t" });

      expect(mockStateMachine.reconnectPlayer).toHaveBeenCalledWith("u1");
      expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
    });

    it("handles reconnection errors gracefully", async () => {
      vi.mocked(roomService.getUserActiveRooms).mockRejectedValue(
        new Error("db error"),
      );

      await expect(
        handler.handleAuthenticate(client, { token: "t" }),
      ).resolves.not.toThrow();
      // Auth still succeeded
      expect(client.data.userId).toBe("u1");
    });

    // ---- C3 fix: multi-room reconnection ----
    describe("C3: multi-room reconnection", () => {
      it("joins ALL active rooms' channels, not just the most recent", async () => {
        // C3 fix: previously the reconnect path took the single most
        // recent active room and re-joined only its channel. A user
        // with RoomPlayer rows in two rooms (e.g. an IN_GAME match
        // and a public lobby) would silently stop receiving
        // broadcasts from the dropped room. The fix joins all
        // channels and reconnects the player to every live match's
        // state machine.
        vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
          {
            joinedAt: new Date("2026-06-14T10:00:00Z"),
            room: {
              id: "r1",
              code: "MATCH",
              type: "PRIVATE",
              status: "IN_GAME",
              hostId: "u1",
              currentMatchId: "m1",
              players: [{ userId: "u1", user: { username: "Alice" } }],
            },
          },
          {
            joinedAt: new Date("2026-06-14T10:05:00Z"),
            room: {
              id: "r2",
              code: "LOBBY",
              type: "PUBLIC",
              status: "WAITING",
              hostId: "u2",
              currentMatchId: null,
              players: [
                { userId: "u1", user: { username: "Alice" } },
                { userId: "u2", user: { username: "Bob" } },
              ],
            },
          },
        ] as any);
        const mockSm1 = {
          reconnectPlayer: vi.fn(),
          getSnapshot: vi.fn().mockReturnValue({ matchId: "m1" }),
        };
        vi.mocked(matchService.getStateMachine).mockResolvedValue(
          mockSm1 as any,
        );

        await handler.handleAuthenticate(client, { token: "t" });

        // The socket is joined to BOTH room channels. join() is
        // called twice (once per room) — we don't assume the order
        // in this assertion to keep the test resilient to internal
        // reordering.
        const joinedChannels = (client.join as any).mock.calls.map(
          (call: unknown[]) => call[0],
        );
        expect(joinedChannels).toContain("room:r1");
        expect(joinedChannels).toContain("room:r2");
        expect(joinedChannels).toHaveLength(2);

        // C3 + presence fix: updatePresence is called for EVERY
        // rejoined room, not just the most recent. The sweeper
        // uses the presence key to mark non-reconnected players
        // stale, so all rooms' presence records must be refreshed
        // on reconnect. We don't assume the call order.
        const presenceCalls = vi.mocked(presenceService.updatePresence).mock
          .calls;
        const presenceRooms = presenceCalls.map(
          (call) => (call[0] as string) ?? "",
        );
        expect(presenceRooms).toContain("r1");
        expect(presenceRooms).toContain("r2");
        expect(presenceCalls).toHaveLength(2);

        // The match state machine is reconnected for r1.
        expect(mockSm1.reconnectPlayer).toHaveBeenCalledWith("u1");
        // The persistence call uses the matchId (m1) for the IN_GAME
        // room.
        expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");

        // ROOM_JOINED is emitted ONCE — for the most recent room
        // (r2, joinedAt=10:05). The web store has a single
        // `room` slot; emitting twice would race and clobber.
        const roomJoinedCalls = (client.emit as any).mock.calls.filter(
          (call: unknown[]) => call[0] === ServerEvent.ROOM_JOINED,
        );
        expect(roomJoinedCalls).toHaveLength(1);
        expect(roomJoinedCalls[0][1]).toEqual(
          expect.objectContaining({ roomId: "r2", code: "LOBBY" }),
        );

        // SNAPSHOT is emitted once for the most recent room's match.
        // r2 has no currentMatchId, so no snapshot for it. r1's
        // match is also the most recent in the sort order
        // (joinedAt desc: r2 first), so r2 gets the user-facing
        // ROOM_JOINED; r1's match is not the "primary" room and
        // does not get a snapshot — the user can REQUEST_SNAPSHOT
        // on demand.
        const snapshotCalls = (client.emit as any).mock.calls.filter(
          (call: unknown[]) => call[0] === ServerEvent.SNAPSHOT,
        );
        expect(snapshotCalls).toHaveLength(0);
      });

      it("emits ROOM_JOINED + SNAPSHOT for the most recent active match", async () => {
        // Variant: the most recent room is the one WITH a current
        // matchId. ROOM_JOINED is emitted for that room, and a
        // SNAPSHOT is replayed for its match.
        vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
          {
            joinedAt: new Date("2026-06-14T10:00:00Z"),
            room: {
              id: "r1",
              code: "LOBBY",
              type: "PUBLIC",
              status: "WAITING",
              hostId: "u1",
              currentMatchId: null,
              players: [{ userId: "u1", user: { username: "Alice" } }],
            },
          },
          {
            joinedAt: new Date("2026-06-14T10:05:00Z"),
            room: {
              id: "r2",
              code: "MATCH",
              type: "PRIVATE",
              status: "IN_GAME",
              hostId: "u1",
              currentMatchId: "m2",
              players: [{ userId: "u1", user: { username: "Alice" } }],
            },
          },
        ] as any);
        const snapshot = { matchId: "m2", status: "ROUND_ACTIVE" };
        const mockSm = {
          reconnectPlayer: vi.fn(),
          getSnapshot: vi.fn().mockReturnValue(snapshot),
        };
        vi.mocked(matchService.getStateMachine).mockResolvedValue(
          mockSm as any,
        );

        await handler.handleAuthenticate(client, { token: "t" });

        const roomJoinedCalls = (client.emit as any).mock.calls.filter(
          (call: unknown[]) => call[0] === ServerEvent.ROOM_JOINED,
        );
        expect(roomJoinedCalls).toHaveLength(1);
        expect(roomJoinedCalls[0][1]).toEqual(
          expect.objectContaining({ roomId: "r2" }),
        );

        // Snapshot is emitted for the most recent room's match.
        const snapshotCalls = (client.emit as any).mock.calls.filter(
          (call: unknown[]) => call[0] === ServerEvent.SNAPSHOT,
        );
        expect(snapshotCalls).toHaveLength(1);
        expect(snapshotCalls[0][1]).toEqual(snapshot);
      });

      it("still works with a single active room (regression)", async () => {
        // The single-room case must still work as before.
        vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
          {
            joinedAt: new Date(),
            room: {
              id: "r1",
              code: "ABC",
              type: "PUBLIC",
              status: "WAITING",
              hostId: "u1",
              currentMatchId: null,
              players: [{ userId: "u1", user: { username: "Alice" } }],
            },
          },
        ] as any);

        await handler.handleAuthenticate(client, { token: "t" });

        expect(client.join).toHaveBeenCalledWith("room:r1");
        expect(client.emit).toHaveBeenCalledWith(
          ServerEvent.ROOM_JOINED,
          expect.objectContaining({ roomId: "r1" }),
        );
      });

      it("returns early when the user has no active rooms", async () => {
        vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([]);

        await handler.handleAuthenticate(client, { token: "t" });

        expect(client.join).not.toHaveBeenCalled();
        expect(client.emit).not.toHaveBeenCalledWith(
          ServerEvent.ROOM_JOINED,
          expect.anything(),
        );
      });
    });

    // ---- L1 fix: stale connectedPlayers cleanup ----
    describe("L1: stale connectedPlayers cleanup", () => {
      it("removes a connectedPlayers entry when the old socket is gone from the namespace", async () => {
        // L1: if a socket was force-closed (e.g. process OOM-killed)
        // and Socket.IO cleaned up its internal map, our
        // connectedPlayers map would still hold a stale entry.
        // A subsequent authenticate would silently no-op the kick
        // and the map would grow unbounded.
        vi.mocked(authService.verifyToken).mockReturnValue({
          userId: "u-stale",
          username: "Stale",
          role: "GUEST" as any,
        });

        // Pre-populate connectedPlayers with a socket id that does
        // NOT exist in the namespace's socket map.
        const staleSocket = {
          id: "socket-stale-gone",
          emit: vi.fn(),
          disconnect: vi.fn(),
        } as unknown as Socket;
        (handler as any).connectedPlayers.set("u-stale", staleSocket.id);
        // Note: we do NOT add staleSocket to mockSockets.

        // New socket for the same user authenticates.
        await handler.handleAuthenticate(client, { token: "t" });

        // The new socket is the active session now.
        expect((handler as any).connectedPlayers.get("u-stale")).toBe(
          client.id,
        );
        // The stale socket was NOT kicked (it didn't exist to be kicked).
        expect(staleSocket.disconnect).not.toHaveBeenCalled();
      });
    });

    // ---- L2 fix: generation counter for socket disconnect race ----
    describe("L2: generation counter for socket disconnect race", () => {
      it("ignores a stale disconnect from a superseded socket", async () => {
        // L2: when a user opens a second tab, the first socket is
        // kicked and the connectionGeneration is bumped. The first
        // socket's eventual disconnect event should be a no-op
        // because its captured generation no longer matches the
        // live one.
        vi.mocked(authService.verifyToken).mockReturnValue({
          userId: "u-race",
          username: "Race",
          role: "GUEST" as any,
        });

        const socket1 = {
          id: "socket-1",
          emit: vi.fn(),
          disconnect: vi.fn(),
          join: vi.fn(),
          leave: vi.fn(),
          data: {},
          nsp: { sockets: mockSockets, server: { to: vi.fn() } },
        } as unknown as Socket;
        mockSockets.set(socket1.id, socket1);
        await handler.handleAuthenticate(socket1, { token: "t1" });

        const socket2 = {
          id: "socket-2",
          emit: vi.fn(),
          disconnect: vi.fn(),
          join: vi.fn(),
          leave: vi.fn(),
          data: {},
          nsp: { sockets: mockSockets, server: { to: vi.fn() } },
        } as unknown as Socket;
        mockSockets.set(socket2.id, socket2);
        await handler.handleAuthenticate(socket2, { token: "t2" });

        // socket1 was kicked and the generation bumped. socket2 is
        // the live one.
        const liveGen = (handler as any).connectionGeneration.get("u-race");
        const socket1Gen = (socket1 as any).data.connectionGen;
        expect(socket1Gen).toBeLessThan(liveGen);

        // Now socket1 fires its disconnect event. This is a no-op
        // because socket1's captured generation is stale.
        // We do NOT expect any match notification.
        vi.mocked(roomService.getUserActiveRooms).mockClear();
        await handler.handleDisconnect(socket1);

        // No DB lookup, no match notification.
        expect(roomService.getUserActiveRooms).not.toHaveBeenCalled();
      });

      it("processes a disconnect from the current (non-superseded) socket", async () => {
        // L2 regression: a normal disconnect from the LIVE socket
        // must still be processed (notify matches, clear the map).
        vi.mocked(authService.verifyToken).mockReturnValue({
          userId: "u-live",
          username: "Live",
          role: "GUEST" as any,
        });
        vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
          {
            room: { currentMatchId: "m-live" },
          },
        ] as any);

        await handler.handleAuthenticate(client, { token: "t" });
        await handler.handleDisconnect(client);

        // The user was removed from the map and the active match
        // was notified.
        expect((handler as any).connectedPlayers.has("u-live")).toBe(false);
        expect((handler as any).connectionGeneration.has("u-live")).toBe(false);
        expect(gameLoopService.handlePlayerDisconnect).toHaveBeenCalledWith(
          "m-live",
          "u-live",
          expect.anything(),
        );
      });
    });
  });
});
