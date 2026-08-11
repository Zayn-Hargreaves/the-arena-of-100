import { deriveSubstream, mulberry32 } from "@arena/game-core";
import type { MatchStateMachine } from "@arena/game-core";
import { getCardDefinition, PlayerStatus, type CardId } from "@arena/shared";

export function makeCardResolveRng(
  matchId: string,
  userId: string,
  roundNo: number,
  offerSeqNo: number,
  cardId: string,
): () => number {
  const seed = deriveSubstream(
    `${matchId}|${userId}|${roundNo}|${offerSeqNo}|${cardId}`,
    `resolve|${cardId}`,
  );
  return mulberry32(seed);
}

export function expandCardTargets(
  matchId: string,
  cardId: CardId,
  playedByPlayerId: string,
  targetPlayerId: string | undefined,
  roundNo: number,
  offerSeqNo: number,
  stateMachine: MatchStateMachine,
): string[] {
  const definition = getCardDefinition(cardId);
  const template = definition.effectTemplate as { targetCount?: number };
  const count = template.targetCount ?? 1;

  if (count <= 1) {
    return targetPlayerId ? [targetPlayerId] : [playedByPlayerId];
  }

  const targetRng = mulberry32(
    deriveSubstream(
      `${matchId}|${playedByPlayerId}|${roundNo}|${offerSeqNo}|${cardId}`,
      `targets|${cardId}`,
    ),
  );
  const eligible = Array.from(stateMachine.getState().players.entries())
    .filter(
      ([id, player]) =>
        id !== playedByPlayerId &&
        player.status !== PlayerStatus.ELIMINATED &&
        player.status !== PlayerStatus.WINNER &&
        player.status !== PlayerStatus.DISCONNECTED,
    )
    .map(([id]) => id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const selected: string[] = [];
  const remaining = eligible.slice();
  const numToPick = Math.min(count, remaining.length);
  for (let i = 0; i < numToPick; i++) {
    const index = Math.floor(targetRng() * remaining.length);
    selected.push(remaining[index]!);
    remaining.splice(index, 1);
  }
  return selected;
}
