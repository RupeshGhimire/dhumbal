import { Card } from './Card';
import { Player } from './Player';

export type GamePhase = 'setup' | 'playing' | 'ended';
export type TurnPhase = 'waiting_for_action' | 'waiting_for_draw' | 'turn_complete';
export type GameMode = 'local' | 'lan';

/**
 * Represents the complete state of a Dhumbal game
 */
export interface GameState {
  id: string;
  createdAt: Date;
  mode: GameMode;
  phase: GamePhase; // setup, playing, ended
  turnPhase: TurnPhase; // Current phase in the turn FSM
  lobbyCode: string | null;
  hostPlayerId: string | null;
  
  // Players
  players: Player[];
  currentPlayerIndex: number;
  dealerIndex: number;

  // Cards
  playerHands: Map<string, Card[]>; // playerId -> cards in hand
  stockpile: Card[];
  discardPile: Card[];
  drawnCard: Card | null; // Card currently being held by current player
  pendingDiscard: Card[]; // Cards discarded but not yet placed on discard pile

  // Game end info
  winner: Player | null;
  finalScores: Map<string, number> | null; // playerId -> score
  dhumbalCalledBy: Player | null;

  // Metadata
  roundNumber: number;
  turnCount: number;
}
