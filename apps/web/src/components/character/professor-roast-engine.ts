"use client";

export type ProfessorMood =
  | "idle"
  | "thinking"
  | "searching"
  | "teaching"
  | "ticking_panic"
  | "shocked"
  | "angry_roast"
  | "proud_cheer";

export type DialogueContext =
  | "home_greeting"
  | "home_nickname_empty"
  | "home_nickname_typed"
  | "matchmaking_waiting"
  | "matchmaking_matched"
  | "lobby_briefing"
  | "game_round_start"
  | "game_last_seconds"
  | "game_correct_answer"
  | "game_wrong_answer"
  | "game_mass_elimination"
  | "game_eliminated"
  | "game_eliminated_timeout"
  | "result_winner"
  | "result_top10"
  | "result_early_elim";

export interface DialogueData {
  key: string;
  mood: ProfessorMood;
}

export const PROFESSOR_DIALOGUES: Record<DialogueContext, DialogueData[]> = {
  home_greeting: [
    { key: "dialogues.home_greeting.0", mood: "idle" },
    { key: "dialogues.home_greeting.1", mood: "teaching" },
    { key: "dialogues.home_greeting.2", mood: "idle" },
  ],
  home_nickname_empty: [
    { key: "dialogues.home_nickname_empty.0", mood: "angry_roast" },
    { key: "dialogues.home_nickname_empty.1", mood: "shocked" },
  ],
  home_nickname_typed: [
    { key: "dialogues.home_nickname_typed.0", mood: "proud_cheer" },
    { key: "dialogues.home_nickname_typed.1", mood: "thinking" },
  ],
  matchmaking_waiting: [
    { key: "dialogues.matchmaking_waiting.0", mood: "searching" },
    { key: "dialogues.matchmaking_waiting.1", mood: "searching" },
    { key: "dialogues.matchmaking_waiting.2", mood: "thinking" },
  ],
  matchmaking_matched: [
    { key: "dialogues.matchmaking_matched.0", mood: "shocked" },
  ],
  lobby_briefing: [
    { key: "dialogues.lobby_briefing.0", mood: "teaching" },
    { key: "dialogues.lobby_briefing.1", mood: "angry_roast" },
    { key: "dialogues.lobby_briefing.2", mood: "teaching" },
  ],
  game_round_start: [
    { key: "dialogues.game_round_start.0", mood: "teaching" },
    { key: "dialogues.game_round_start.1", mood: "thinking" },
  ],
  game_last_seconds: [
    { key: "dialogues.game_last_seconds.0", mood: "ticking_panic" },
    { key: "dialogues.game_last_seconds.1", mood: "ticking_panic" },
  ],
  game_correct_answer: [
    { key: "dialogues.game_correct_answer.0", mood: "proud_cheer" },
    { key: "dialogues.game_correct_answer.1", mood: "proud_cheer" },
    { key: "dialogues.game_correct_answer.2", mood: "proud_cheer" },
  ],
  game_wrong_answer: [
    { key: "dialogues.game_wrong_answer.0", mood: "angry_roast" },
    { key: "dialogues.game_wrong_answer.1", mood: "shocked" },
    { key: "dialogues.game_wrong_answer.2", mood: "angry_roast" },
    { key: "dialogues.game_wrong_answer.3", mood: "angry_roast" },
  ],
  game_mass_elimination: [
    { key: "dialogues.game_mass_elimination.0", mood: "shocked" },
    { key: "dialogues.game_mass_elimination.1", mood: "shocked" },
  ],
  game_eliminated: [
    { key: "dialogues.game_eliminated.0", mood: "angry_roast" },
    { key: "dialogues.game_eliminated.1", mood: "shocked" },
  ],
  game_eliminated_timeout: [
    { key: "dialogues.game_eliminated_timeout.0", mood: "angry_roast" },
  ],
  result_winner: [{ key: "dialogues.result_winner.0", mood: "proud_cheer" }],
  result_top10: [{ key: "dialogues.result_top10.0", mood: "proud_cheer" }],
  result_early_elim: [
    { key: "dialogues.result_early_elim.0", mood: "angry_roast" },
  ],
};

export function getRandomProfessorDialogue(
  context: DialogueContext,
): DialogueData {
  const list = PROFESSOR_DIALOGUES[context];
  const item = list[Math.floor(Math.random() * list.length)] ?? list[0]!;
  return item;
}
