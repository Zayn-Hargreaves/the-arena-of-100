import type { Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import type { MatchService, PersistOutcome } from "./match.service";
import { emitMatchDisconnected, emitMatchPlayerLeft } from "./game-loop.events";

interface PlayerLifecycleContext {
  logger: Logger;
  matchService: MatchService;
}

export async function disconnectMatchPlayer(
  context: PlayerLifecycleContext,
  matchId: string,
  userId: string,
  server: Server,
): Promise<PersistOutcome | "NOOP"> {
  const stateMachine = await context.matchService.getStateMachine(matchId);
  if (!stateMachine) return "NOOP";

  const state = stateMachine.getState();
  const player = state.players.get(userId);
  if (!player) {
    context.logger.warn(`Player ${userId} not found in match ${matchId}`);
    return "NOOP";
  }

  stateMachine.disconnectPlayer(userId);
  const outcome = await context.matchService.persistStateMachine(matchId);
  if (outcome !== "APPLIED") {
    context.logger.warn(
      `handlePlayerDisconnect: persist ${outcome} for ${matchId} — no confirmed canonical write, skipping disconnect broadcast`,
    );
    return outcome;
  }

  emitMatchDisconnected(server, state.roomId, userId);
  context.logger.log(`Player ${userId} disconnected from match ${matchId}`);
  return "APPLIED";
}

export async function leaveMatchPlayer(
  context: PlayerLifecycleContext,
  matchId: string,
  roomId: string,
  userId: string,
  server: Server,
  reason: "LEFT" | "STALE" = "LEFT",
): Promise<void> {
  const stateMachine = await context.matchService.getStateMachine(matchId);

  if (stateMachine) {
    const player = stateMachine.getState().players.get(userId);
    if (player) {
      stateMachine.disconnectPlayer(userId);
      await context.matchService.persistStateMachine(matchId);
    }
  } else {
    context.logger.warn(
      `handleMatchPlayerLeft: no state machine for match ${matchId} (likely already finished); skipping state update`,
    );
  }

  emitMatchPlayerLeft(server, roomId, userId, reason);
  context.logger.log(
    `Player ${userId} left match ${matchId} (room ${roomId}) with reason ${reason}`,
  );
}
