import { Injectable, Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  GAME_CONFIG,
  MatchStatus,
  RoomStatus,
  RoomError,
  ErrorCode,
} from "@arena/shared";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "../room/room.service";
import { PrismaService } from "../prisma/prisma.service";
import { MatchRoundRunner } from "./match-round-runner";
import { LobbyCountdownService } from "./lobby-countdown.service";
import {
  emitMatchStarting,
  emitRoomStatusUpdated,
  emitRoomTerminated,
  emitWaitingRoomState,
} from "./game-loop.helpers";
import { LOBBY_COUNTDOWN_INDEX_KEY } from "./game-loop.countdown-store";

// Re-export for backwards compatibility with existing spec imports.
export const COUNTDOWN_INDEX_KEY = LOBBY_COUNTDOWN_INDEX_KEY;

/**
 * Authoritative finish result for `forceFinishMatchForDisband`. Returned to
 * the caller (e.g. `PresenceService.sweep`) so it can broadcast
 * `ServerEvent.MATCH_FINISHED` with the canonical `winnerId` / `totalRounds`
 * / `finishedAt` from the state machine + `matchService.finishMatch` DB row
 * — never synthetic zeros.
 *
 * `null` means "this call did not produce a result to emit": either the
 * match was already finishing (the in-flight natural finish owns the
 * emission) or the finish was a no-op (idempotent guard hit). The caller
 * MUST skip its own `MATCH_FINISHED` emission in that case so we get
 * exactly one event per match end.
 */
export type FinishResult = {
  matchId: string;
  winnerId: string | null;
  totalRounds: number;
  finishedAt: Date;
};

@Injectable()
export class GameLoopService {
  private readonly logger = new Logger(GameLoopService.name);
  // The timer-driven match loop (countdown → round → finish + in-match
  // player events). GameLoopService owns it and drives it from
  // launchRoomMatch / stopRoomRuntime; the socket handlers reach its
  // in-match events through this class's thin facade below.
  private readonly roundRunner: MatchRoundRunner;
  private server?: Server;

  constructor(
    private readonly matchService: MatchService,
    questionService: QuestionService,
    private readonly roomService: RoomService,
    // B3 fix: we need direct Prisma access inside `launchRoomMatch`
    // to acquire a row-level lock on the Room row + perform the
    // status / currentMatchId check atomically. The same pattern
    // is used in `RoomService.joinRoom` (see
    // `apps/api/src/modules/room/room.service.ts:171-182`). The
    // PrismaModule is global, so no module change is required.
    private readonly prisma: PrismaService,
    // Pre-match lobby countdown + boot recovery. GameLoopService is the
    // only caller that drives it (launch/stop); the reverse edge is the
    // launcher callback wired below, so the DI is one-directional.
    private readonly lobbyCountdown: LobbyCountdownService,
  ) {
    this.roundRunner = new MatchRoundRunner(
      matchService,
      questionService,
      roomService,
    );
    // When a lobby countdown expires (live or recovered), launch the
    // match through the same auto-start path the timer used to call.
    this.lobbyCountdown.setLauncher((roomId, server) =>
      this.launchRoomMatch(roomId, server, { isAutoStart: true }),
    );
  }

  /**
   * Inject the Socket.io server so lobby countdowns can be recovered on
   * boot. Called once during application bootstrap. Forwards to the lobby
   * countdown provider (which drains any buffered recovery).
   */
  setServer(server: Server) {
    this.server = server;
    this.lobbyCountdown.setServer(server);
  }

  async forceStartRoomMatch(roomId: string, server: Server) {
    return this.launchRoomMatch(roomId, server, { isAutoStart: false });
  }

  private async launchRoomMatch(
    roomId: string,
    server: Server,
    options: { isAutoStart: boolean },
  ) {
    const room = await this.roomService.getRoom(roomId);

    if (
      room.status !== RoomStatus.WAITING &&
      room.status !== RoomStatus.COUNTDOWN
    ) {
      throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
    }

    await this.lobbyCountdown.clearCountdown(roomId);

    if (room.players.length < GAME_CONFIG.MIN_PLAYERS_TO_START) {
      if (room.status !== RoomStatus.WAITING) {
        await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
      }

      if (options.isAutoStart) {
        emitWaitingRoomState(
          roomId,
          server,
          "NOT_ENOUGH_PLAYERS",
          RoomStatus.WAITING,
        );
      }

      throw new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS);
    }

    let match:
      | Awaited<ReturnType<typeof this.matchService.createMatch>>
      | undefined = undefined;
    try {
      // B3 fix: atomic guard against the double-launch race.
      //
      // The previous flow was: re-fetch room (no lock) → check
      // status → `updateRoomStatus(STARTING)` (no lock) → call
      // `matchService.createMatch`. The same `launchRoomMatch`
      // is reachable from three independent paths — the public
      // auto-start timer, the host force-start, and the
      // `onModuleInit` recovery for expired countdowns. Two of
      // them firing for the same roomId at the same time could
      // both pass the status check, both call `updateRoomStatus`
      // (idempotent so no error), and both call `createMatch` →
      // two Match rows, two `MatchPlayer.createMany`, an
      // orphan `match:state:*` Redis key, and a corrupted
      // `currentMatchId` (the second `room.update` overwrites
      // the first).
      //
      // We close the race with the same `SELECT ... FOR UPDATE`
      // pattern that `RoomService.joinRoom` uses:
      //
      //   1. Open a Prisma transaction.
      //   2. Acquire a row-level lock on the Room.
      //   3. Re-check status (must be WAITING or COUNTDOWN) and
      //      `currentMatchId IS NULL` under the lock. A second
      //      caller that has been blocked on the lock will see
      //      either the already-set status (STARTING/IN_GAME)
      //      or the already-set `currentMatchId` and abort.
      //   4. Set `Room.status = STARTING` inside the transaction
      //      so a third caller (which could arrive between
      //      commit and `createMatch`) fails the status check.
      //   5. Commit, then call `matchService.createMatch` outside
      //      the transaction. `createMatch` writes `currentMatchId`
      //      in its own internal transaction; because we set
      //      `status = STARTING` first, any other caller that
      //      beats `createMatch` to its own FOR UPDATE will fail
      //      the status check.
      //
      // We do NOT set `currentMatchId` here because we don't have
      // the `match.id` yet — `createMatch` owns that field. Setting
      // `status = STARTING` is sufficient to make the race window
      // observable to concurrent callers.
      await this.prisma.$transaction(async (tx) => {
        const lockedRoom = await tx.$queryRaw<
          Array<{ id: string; status: string; currentMatchId: string | null }>
        >`
          SELECT id, status, "currentMatchId"
          FROM "rooms"
          WHERE id = ${roomId}
          FOR UPDATE
        `;
        if (lockedRoom.length === 0) {
          // Room was deleted between the outer read and the
          // in-transaction lock acquisition. Treat as
          // not-found so the caller gets a typed error.
          throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
        }
        const locked = lockedRoom[0];
        if (
          locked.status !== RoomStatus.WAITING &&
          locked.status !== RoomStatus.COUNTDOWN
        ) {
          throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
        }
        if (locked.currentMatchId !== null) {
          // A previous launch already set currentMatchId. Even
          // though `status` may still be WAITING (race window),
          // the lock holder is the canonical truth. Abort.
          throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
        }
        await tx.room.update({
          where: { id: roomId },
          data: { status: RoomStatus.STARTING },
        });
      });

      emitRoomStatusUpdated(server, {
        roomId,
        roomStatus: RoomStatus.STARTING,
        currentMatchId: room.currentMatchId ?? null,
        updatedAt: Date.now(),
      });

      // `createMatch` opens its own internal transaction. If it
      // throws AFTER its `match.create` succeeds but before its
      // `room.update` completes, we end up with an orphan Match
      // row pointing at a room that is still STARTING with no
      // currentMatchId. We clean up explicitly: delete the
      // orphan Match row (this is the only side effect of
      // `createMatch` we own from here) and revert the Room
      // status back to WAITING so a recovery sweep can retry.
      //
      // Race-fix: if the failure is `ROOM_ALREADY_STARTED`, the
      // B3 transaction guard has already determined that another
      // thread validly acquired the room lock and is mid-launch.
      // Our room may already be in `STARTING` / `IN_GAME` state
      // from that thread's transaction commit. Unconditionally
      // overwriting that with `WAITING` + emitting
      // `ROOM_STATUS_UPDATED {WAITING}` would corrupt the
      // winning thread's state. The fix: detect the race-lost
      // error and skip the revert + emit entirely. The losing
      // thread only propagates the error so the caller sees the
      // "launch failed because someone else got there first"
      // outcome without us silently destroying the winner's
      // progress.
      match = await this.matchService.createMatch(roomId);

      emitMatchStarting(
        server,
        roomId,
        match.id,
        GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      );

      await this.roundRunner.startMatchLoop(match.id, roomId, server);
      return match;
    } catch (error) {
      // Rollback on error. We DO NOT touch `currentMatchId` here
      // because we did not set it in the transaction (B3 fix);
      // only the status needs to revert. The `createMatch` path
      // may have set `currentMatchId` if it succeeded mid-error;
      // the cleanup branch above handles that before we get here.
      //
      // Race-fix: same guard as the inner `createError` catch.
      // The B3 transaction throws `ROOM_ALREADY_STARTED` when
      // the lock holder sees a non-WAITING/COUNTDOWN status or a
      // non-null `currentMatchId` (i.e. another thread won the
      // launch). At that point the room is already in
      // `STARTING` (or `IN_GAME`) state from the winning thread.
      // Reverting it to `WAITING` + broadcasting that revert
      // would clobber the winner's progress and confuse every
      // spectator/player connected to the room channel. We
      // detect the race-lost error and skip both the revert
      // and the emit, only propagating the original error to
      // the caller (which can be admin tooling, the host
      // force-start handler, or the auto-start timer).
      const isRaceLost =
        error instanceof RoomError
          ? error.code === ErrorCode.ROOM_ALREADY_STARTED
          : (error as Record<string, unknown>)?.code ===
            ErrorCode.ROOM_ALREADY_STARTED;
      if (isRaceLost) {
        this.logger.warn(
          `B3 race-lost: launchRoomMatch for room ${roomId} aborted because another thread won the launch. The winning thread's state (STARTING/IN_GAME) is preserved.`,
        );
        throw error;
      }

      const isRoomNotFound =
        error instanceof RoomError
          ? error.code === ErrorCode.ROOM_NOT_FOUND
          : (error as Record<string, unknown>)?.code ===
              ErrorCode.ROOM_NOT_FOUND ||
            (error as Record<string, unknown>)?.message ===
              ErrorCode.ROOM_NOT_FOUND;
      if (isRoomNotFound) {
        this.logger.warn(
          `Room ${roomId} not found during launch. Skipping revert/broadcast.`,
        );
        throw error;
      }

      this.logger.error(
        `Launch failed for room ${roomId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Clean up orphaned match in DB if created
      if (match) {
        try {
          this.logger.warn(
            `Deleting orphaned match ${match.id} for room ${roomId}`,
          );
          await this.prisma.match.delete({
            where: { id: match.id },
          });
        } catch (cleanupError) {
          this.logger.error(
            `Failed to delete orphaned match ${match.id}:`,
            cleanupError,
          );
        }
      }

      try {
        await this.roomService.updateRoomStatus(
          roomId,
          RoomStatus.WAITING,
          null,
        );
        emitRoomStatusUpdated(server, {
          roomId,
          roomStatus: RoomStatus.WAITING,
          currentMatchId: null,
          updatedAt: Date.now(),
        });
      } catch (revertError) {
        this.logger.error(
          `Failed to revert Room ${roomId} status to WAITING after launch failure.`,
          revertError instanceof Error ? revertError.stack : undefined,
        );
      }
      throw error;
    }
  }

  /**
   * Stops all in-process timers associated with a room and (optionally) its
   * active match. Called by the admin kill-switch before the room is torn
   * down. Does not touch DB or Redis — that is the orchestrator's job.
   * Unconditional: clears the lobby countdown even if the room is mid-WAITING.
   */
  async stopRoomRuntime(roomId: string, matchId: string | null): Promise<void> {
    await this.lobbyCountdown.clearCountdown(roomId);
    if (matchId) {
      this.roundRunner.cancelMatchLoop(matchId);
    }
  }

  /**
   * Terminates an active match through the server-authoritative path before
   * room membership teardown (e.g. private host-stale disband mid-match).
   * Cancels timers, appends MATCH_FINISHED on the in-memory state machine
   * when present (audit/replay), then persists Match+Room FINISHED via
   * matchService.finishMatch. Safe if the match is already finishing or gone.
   *
   * Returns the authoritative `FinishResult` (winnerId / totalRounds /
   * finishedAt from the state machine + `matchService.finishMatch` DB row)
   * for the caller to broadcast `ServerEvent.MATCH_FINISHED`. Returns
   * `null` when this call did NOT produce a result to emit — either an
   * in-flight natural finish already owns the emission (already-finishing
   * branch) or `matchService.finishMatch` was a no-op (idempotent guard).
   * The caller MUST skip its own emission in that case to guarantee
   * exactly one `MATCH_FINISHED` per match end.
   */
  async forceFinishMatchForDisband(
    matchId: string,
    roomId: string,
  ): Promise<FinishResult | null> {
    this.roundRunner.cancelMatchLoop(matchId);

    if (this.roundRunner.isMatchFinishing(matchId)) {
      this.logger.warn(
        `forceFinishMatchForDisband: match ${matchId} already finishing; skipping SM/DB finish`,
      );
      // B1.1: wait for the in-flight natural finish to complete before
      // returning, so the caller (e.g. PresenceService.sweep) does not
      // race ahead and disband the room while the finish transaction is
      // still persisting. Return null: the in-flight natural finish
      // already broadcast its own MATCH_FINISHED, so the caller MUST NOT
      // re-emit.
      await this.roundRunner.awaitFinish(matchId);
      this.logger.log(
        `forceFinishMatchForDisband: match ${matchId} awaited in-flight finish`,
      );
      return null;
    }

    // Capture the state machine's totalRounds BEFORE finishMatch() so we
    // can return the canonical value to the caller. Mirror the natural
    // path (see `match-round-runner.ts` `finishMatchLoopInner`): the wire
    // uses `state.currentRoundNo` for the MATCH_FINISHED payload.
    let totalRounds = 0;
    try {
      const stateMachine = await this.matchService.getStateMachine(matchId);
      if (stateMachine) {
        const status = stateMachine.getState().status;
        if (status !== MatchStatus.FINISHED) {
          if (stateMachine.canTransition(MatchStatus.FINISHED)) {
            stateMachine.transition(MatchStatus.FINISHED);
          }
          stateMachine.finishMatch();
          await this.matchService.persistStateMachine(matchId);
        }
        totalRounds = stateMachine.getState().currentRoundNo;
      }
    } catch (error) {
      this.logger.warn(
        `forceFinishMatchForDisband: state-machine terminalization failed for match ${matchId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    try {
      // Admin-termination flag: no score recompute; winnerId null.
      const match = await this.matchService.finishMatch(
        matchId,
        null,
        roomId,
        true,
      );
      // Idempotent no-op (count: 0 in finishMatch): a prior finish
      // already won the race. Return null so the caller skips its
      // emission — the prior caller already broadcast MATCH_FINISHED.
      if (!match) {
        this.logger.warn(
          `forceFinishMatchForDisband: match ${matchId} finishMatch returned null (idempotent no-op); caller will skip MATCH_FINISHED emission`,
        );
        return null;
      }
      return {
        matchId,
        winnerId: match.winnerId ?? null,
        totalRounds,
        finishedAt: match.endedAt ?? new Date(),
      };
    } catch (error) {
      this.logger.warn(
        `forceFinishMatchForDisband: finishMatch failed for match ${matchId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Emits the ServerEvent.ROOM_TERMINATED notification to all sockets joined
   * to the room channel. Encapsulates the Server reference so the admin
   * service does not need direct socket access.
   */
  emitRoomTerminated(
    roomId: string,
    payload: { matchId: string | null; message?: string },
  ): void {
    if (!this.server) {
      this.logger.warn(
        `emitRoomTerminated: server not set, cannot emit for room ${roomId}`,
      );
      return;
    }
    emitRoomTerminated(this.server, roomId, payload);
  }

  // ============================================================
  // In-match runtime facade — thin delegators to MatchRoundRunner.
  // The socket handlers and admin service drive the live match through
  // GameLoopService; the implementation lives in MatchRoundRunner.
  // ============================================================

  cancelMatchLoop(matchId: string): void {
    this.roundRunner.cancelMatchLoop(matchId);
  }

  isMatchFinishing(matchId: string): boolean {
    return this.roundRunner.isMatchFinishing(matchId);
  }

  async handlePlayerDisconnect(
    matchId: string,
    userId: string,
    server: Server,
  ): Promise<void> {
    return this.roundRunner.handlePlayerDisconnect(matchId, userId, server);
  }

  async handleMatchPlayerLeft(
    matchId: string,
    roomId: string,
    userId: string,
    server: Server,
    reason: "LEFT" | "STALE" = "LEFT",
  ): Promise<void> {
    return this.roundRunner.handleMatchPlayerLeft(
      matchId,
      roomId,
      userId,
      server,
      reason,
    );
  }

  async checkEarlyTermination(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    return this.roundRunner.checkEarlyTermination(matchId, roomId, server);
  }
}
