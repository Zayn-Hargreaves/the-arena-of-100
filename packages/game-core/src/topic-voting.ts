// ============================================================
// Topic Ban Voting Engine — Arena of 100 (Pre-match Draft)
// Pure, deterministic crowd-voting algorithm for Battle Royale.
// ============================================================

import { GAME_CONFIG } from "@arena/shared";
import { deriveSubstream, mulberry32 } from "./prng";

export interface TopicVotingResult {
  bannedTopics: string[];
  activeTopics: string[];
  voteCounts: Record<string, number>;
}

/**
 * Deterministically select candidate topics from the pool using a seed.
 */
export function selectCandidateTopics(
  seed: string,
  count = 6,
  pool: readonly string[] = GAME_CONFIG.TOPIC_VOTING_CANDIDATE_POOL,
): string[] {
  if (pool.length <= count) {
    return [...pool];
  }

  const substreamSeed = deriveSubstream(seed, "topic-candidates");
  const rng = mulberry32(substreamSeed);

  // Shuffle pool deterministically and pick the first `count`
  const indexed = pool.map((topic) => ({ topic, roll: rng() }));
  indexed.sort((a, b) => a.roll - b.roll);

  return indexed.slice(0, count).map((item) => item.topic);
}

/**
 * Tally votes for each candidate topic.
 */
export function tallyTopicVotes(
  votes: Record<string, string>,
  candidateTopics: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = Object.create(null);
  for (const topic of candidateTopics) {
    counts[topic] = 0;
  }

  for (const votedTopic of Object.values(votes)) {
    if (counts[votedTopic] !== undefined) {
      counts[votedTopic] += 1;
    }
  }

  return counts;
}

/**
 * Resolve topic voting result: Top `bannedCount` topics with the most ban votes are eliminated.
 * Tie-break is deterministic using `deriveSubstream(seed, "topic-ban-tiebreak")`.
 */
export function resolveBannedTopics(
  candidateTopics: readonly string[],
  votes: Record<string, string>,
  seed: string,
  bannedCount: number = GAME_CONFIG.TOPIC_VOTING_BANNED_COUNT,
): TopicVotingResult {
  const voteCounts = tallyTopicVotes(votes, candidateTopics);

  if (candidateTopics.length <= bannedCount) {
    return {
      bannedTopics: [...candidateTopics],
      activeTopics: [],
      voteCounts,
    };
  }

  const substreamSeed = deriveSubstream(seed, "topic-ban-tiebreak");
  const rng = mulberry32(substreamSeed);

  // Assign deterministic tie-break score to each topic
  // Note: sort candidate topics alphabetically first so tiebreak rolls are stable
  const sortedCandidates = [...candidateTopics].sort();
  const tieBreakScores = new Map<string, number>();
  for (const topic of sortedCandidates) {
    tieBreakScores.set(topic, rng());
  }

  // Sort candidate topics by:
  // 1. Vote count descending (highest ban votes first)
  // 2. Tie-break roll descending
  const ranked = [...candidateTopics].sort((a, b) => {
    const diff = (voteCounts[b] ?? 0) - (voteCounts[a] ?? 0);
    if (diff !== 0) return diff;
    return (tieBreakScores.get(b) ?? 0) - (tieBreakScores.get(a) ?? 0);
  });

  const bannedTopics = ranked.slice(0, bannedCount);
  const activeTopics = ranked.slice(bannedCount);

  return {
    bannedTopics,
    activeTopics,
    voteCounts,
  };
}
