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
import { MatchOwnershipService } from "./match-ownership.service";
import { MatchCommandService } from "./match-command.service";
import {
  emitMatchStarting,
  emitRoomStatusUpdated,
  emitRoomTerminated,
  emitWaitingRoomState,
} from "./game-loop.helpers";
import { emitAnswerResult } from "./game-loop.events";

// Re-export for backwards compatibility with existing spec imports.

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
    // B2b: owner-lease acquisition at launch + release on stop/finish.
    private readonly matchOwnership: MatchOwnershipService,
    // B4a/B4b: owner command channel — forwarded-answer consumer + fenced apply.
    private readonly matchCommand: MatchCommandService,
  ) {
    this.roundRunner = new MatchRoundRunner(
      matchService,
      questionService,
      roomService,
      matchOwnership,
      async (matchId) => {
        this.matchCommand.deregisterMatch(matchId);
        await this.matchCommand.disposeStream(matchId);
      },
    );
    // B4b: wire the fenced side effects the authoritative answer apply runs
    // after a successful persist (canonical ANSWER_RESULT + early termination).
    this.matchCommand.setSideEffects({
      publishAnswerResult: (env, roomId, result, roundNo, server) =>
        emitAnswerResult(
          server,
          roomId,
          env.matchId,
          env.body.userId,
          result,
          roundNo,
        ),
      checkEarlyTermination: (matchId, roomId, server) =>
        this.roundRunner.checkEarlyTermination(matchId, roomId, server),
      // B5: player_disconnect forwarded from a non-owner presence leader. The
      // owner is the single writer; roomId is resolved from authoritative state
      // inside handlePlayerDisconnect, never from the command payload.
      //
      // Symmetric with submit_answer (applyAnswerAuthoritative): a non-APPLIED
      // outcome from the runner means the fenced persist did NOT land on the
      // canonical writer (lease lost / BLIND), so we MUST return "RETRY" to
      // leave the stream entry pending. Without this, the entry would be XACKed
      // and the disconnect silently dropped. eventId dedup in
      // applyDisconnectAuthoritative covers redelivery after a successful apply.
      handlePlayerDisconnect: async (env, _owner, server) => {
        if (env.body.type !== "player_disconnect") return "APPLIED";
        try {
          const outcome = await this.roundRunner.handlePlayerDisconnect(
            env.matchId,
            env.body.userId,
            server,
          );
          if (outcome === "APPLIED" || outcome === "NOOP") return "APPLIED";
          this.logger.warn(
            `handlePlayerDisconnect non-canonical outcome ${outcome} for ${env.matchId}/${env.body.userId} (RETRY, entry stays pending)`,
          );
          return "RETRY";
        } catch (err) {
          this.logger.warn(
            `handlePlayerDisconnect apply failed for ${env.matchId}/${env.body.userId} (RETRY): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return "RETRY";
        }
      },
    });
    // B2c: let the ownership heartbeat cancel a match's timers when this node
    // loses the lease (relinquish path). One-directional: the runner is not DI.
    this.matchOwnership.setRoundRunner(this.roundRunner);
    // B3b: wire the recovery collaborators so boot/orphan takeover can hydrate
    // canonical state and resume the loop. MatchService already depends on
    // MatchOwnershipService, so this setter (not DI) avoids the cycle.
    this.matchOwnership.setRecoveryDeps({
      getStateMachine: (matchId) => matchService.getStateMachine(matchId),
      getRoomIdByMatchId: (matchId) => matchService.getRoomIdByMatchId(matchId),
      resumeMatchLoop: async (matchId, hydratedSm, roomId, server) => {
        // B4b: register the owner command consumer on takeover so forwarded
        // answers (incl. any XAUTOCLAIM'd during the failover gap) are drained.
        await this.matchCommand.registerMatch(matchId, server);
        await this.roundRunner.resumeMatchLoop(
          matchId,
          hydratedSm,
          roomId,
          server,
        );
      },
    });
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
    // B3b: drains buffered boot recovery + enables the orphan sweep to resume.
    this.matchOwnership.setServer(server);
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
    await this.validateRoomForLaunch(room, roomId, server, options.isAutoStart);

    let match:
      | Awaited<ReturnType<typeof this.matchService.createMatch>>
      | undefined = undefined;
    let ownershipAcquired = false;

    try {
      await this.acquireRoomLaunchLock(roomId);

      emitRoomStatusUpdated(server, {
        roomId,
        roomStatus: RoomStatus.STARTING,
        currentMatchId: room.currentMatchId ?? null,
        updatedAt: Date.now(),
      });

      match = await this.matchService.createMatch(roomId);

      emitMatchStarting(
        server,
        roomId,
        match.id,
        GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      );

      const acquired = await this.matchOwnership.acquireOnLaunch(
        match.id,
        roomId,
      );
      if (!acquired) {
        throw new Error(
          `launchRoomMatch: could not acquire owner lease for match ${match.id} (room ${roomId}); aborting launch`,
        );
      }
      ownershipAcquired = true;

      await this.matchCommand.registerMatch(match.id, server);
      await this.roundRunner.startMatchLoop(match.id, roomId, server);

      return match;
    } catch (error) {
      await this.handleLaunchError(
        error,
        roomId,
        server,
        match,
        ownershipAcquired,
      );
      /* c8 ignore next */
      throw error;
    }
  }

  private async validateRoomForLaunch(
    room: Awaited<ReturnType<typeof this.roomService.getRoom>>,
    roomId: string,
    server: Server,
    isAutoStart: boolean,
  ): Promise<void> {
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

      if (isAutoStart) {
        emitWaitingRoomState(
          roomId,
          server,
          "NOT_ENOUGH_PLAYERS",
          RoomStatus.WAITING,
        );
      }

      throw new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS);
    }
  }

  private async acquireRoomLaunchLock(roomId: string): Promise<void> {
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
  }

  private isRaceLostError(error: unknown): boolean {
    return error instanceof RoomError
      ? error.code === ErrorCode.ROOM_ALREADY_STARTED
      : (error as Record<string, unknown>)?.code ===
          ErrorCode.ROOM_ALREADY_STARTED;
  }

  private isRoomNotFoundError(error: unknown): boolean {
    return error instanceof RoomError
      ? error.code === ErrorCode.ROOM_NOT_FOUND
      : (error as Record<string, unknown>)?.code === ErrorCode.ROOM_NOT_FOUND ||
          (error as Record<string, unknown>)?.message ===
            ErrorCode.ROOM_NOT_FOUND;
  }

  private async handleLaunchError(
    error: unknown,
    roomId: string,
    server: Server,
    match:
      | Awaited<ReturnType<typeof this.matchService.createMatch>>
      | undefined,
    ownershipAcquired: boolean,
  ): Promise<never> {
    if (this.isRaceLostError(error)) {
      this.logger.warn(
        `B3 race-lost: launchRoomMatch for room ${roomId} aborted because another thread won the launch. The winning thread's state (STARTING/IN_GAME) is preserved.`,
      );
      throw error;
    }

    if (this.isRoomNotFoundError(error)) {
      this.logger.warn(
        `Room ${roomId} not found during launch. Skipping revert/broadcast.`,
      );
      throw error;
    }

    this.logger.error(
      `Launch failed for room ${roomId}: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );

    if (match) {
      await this.cleanupOrphanedMatch(match, roomId, ownershipAcquired);
    }

    await this.revertRoomStatusToWaiting(roomId, server);
    throw error;
  }

  private async cleanupOrphanedMatch(
    match: { id: string },
    roomId: string,
    ownershipAcquired: boolean,
  ): Promise<void> {
    if (ownershipAcquired) {
      this.roundRunner.cancelMatchLoop(match.id);
      // Consumer đã được register sau khi acquire lease; dọn stream + dedup set
      // để nhánh launch-fail không để lại poll mồ côi và key rác trên Redis.
      this.matchCommand.deregisterMatch(match.id);
      await this.matchCommand.disposeStream(match.id);
      try {
        await this.matchOwnership.release(match.id);
      } catch (releaseError) {
        this.logger.error(
          `Failed to release owner lease for match ${match.id} during launch rollback.`,
          releaseError instanceof Error ? releaseError.stack : undefined,
        );
      }
    }

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

  private async revertRoomStatusToWaiting(
    roomId: string,
    server: Server,
  ): Promise<void> {
    try {
      await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING, null);
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
      // B2b: release the owner lease + match:active entry so recovery does not
      // adopt a match we intentionally tore down.
      await this.matchOwnership.release(matchId);
      // B4b: stop the command consumer + drop the stream/dedup set.
      this.matchCommand.deregisterMatch(matchId);
      await this.matchCommand.disposeStream(matchId);
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
    // B2b: release the owner lease + match:active entry once for this teardown,
    // covering every branch below (already-finishing, idempotent no-op, finish).
    await this.matchOwnership.release(matchId);

    if (this.roundRunner.isMatchFinishing(matchId)) {
      this.logger.warn(
        `forceFinishMatchForDisband: match ${matchId} already finishing; skipping SM/DB finish`,
      );
      // B1.1: wait for the in-flight natural finish to complete before
      // returning, so the caller (e.g. PresenceService.sweep) does not
      // race ahead and disband the room while the finish transaction is
      // still persisting. Return null: the in-flight natural finish
      // already broadcast its own MATCH_FINISHED, so the caller MUST NOT
      // re-emit. Natural finish also disposes the command stream.
      await this.roundRunner.awaitFinish(matchId);
      this.logger.log(
        `forceFinishMatchForDisband: match ${matchId} awaited in-flight finish`,
      );
      // Defence-in-depth: natural finish should have cleaned the stream; if it
      // aborted early (lease lost) we still drop any residual keys here.
      this.matchCommand.deregisterMatch(matchId);
      await this.matchCommand.disposeStream(matchId);
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
      // B4b: stop the command consumer + drop match:cmd / match:applied. Disband
      // does not go through stopRoomRuntime, so this path must clean them itself.
      this.matchCommand.deregisterMatch(matchId);
      await this.matchCommand.disposeStream(matchId);
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
    // B5: the owner-local path; the outcome is informational only — the
    // command-stream wrapper is the only consumer that needs the value to
    // decide XACK vs RETRY. We discard it here because the public contract
    // is fire-and-forget from `PresenceService.routeInGameDisconnect`.
    await this.roundRunner.handlePlayerDisconnect(matchId, userId, server);
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

export { LOBBY_COUNTDOWN_INDEX_KEY as COUNTDOWN_INDEX_KEY } from "./game-loop.countdown-store";
