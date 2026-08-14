// Barrel for the game-match presentational components. The page.tsx
// composes these organisms and owns all match state/effects/handlers.
export { Timer, type TimerProps } from "./timer";
export { AnswerTile, type AnswerTileProps } from "./answer-tile";
export { PlayerGrid, type PlayerGridProps } from "./player-grid";
export { LeaveMatchModal } from "./leave-match-modal";
export { EliminatedOverlay } from "./eliminated-overlay";
export { SpectatorBanner } from "./spectator-banner";
export {
  GameStateRibbon,
  type GameStateRibbonProps,
} from "./game-state-ribbon";
export { QuestionCard, type QuestionCardProps } from "./question-card";
export { AnswerPanel, type AnswerPanelProps } from "./answer-panel";
export {
  OpponentsSidebar,
  type OpponentsSidebarProps,
  type OpponentPlayer,
} from "./opponents-sidebar";
export { AntiHackNote } from "./anti-hack-note";
export {
  LeaveMatchButton,
  type LeaveMatchButtonProps,
} from "./leave-match-button";
export { MatchFinishedOverlay } from "./match-finished-overlay";
export { TopicVotingOverlay } from "./topic-voting-overlay";

// Phase 2 — Class + Card Hybrid UI.
export {
  CardTile,
  CARD_TIE_BORDER_STYLES,
  type CardTileProps,
} from "./card-tile";
export { CardHand, type CardHandProps } from "./card-hand";
export {
  CardTargetPicker,
  type CardTargetPickerProps,
} from "./card-target-picker";
export { CardAnimation, type CardAnimationProps } from "./card-animation";
export { ClassBadge, type ClassBadgeProps } from "./class-badge";
export {
  AoeCapIndicator,
  type AoeCapIndicatorProps,
} from "./aoe-cap-indicator";
