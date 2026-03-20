export interface Card {
  suit: string;
  rank: string;
}

export interface Player {
  id: string;
  name: string;
  position: number;
  isBot?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface GameState {
  id: string;
  lobbyCode: string | null;
  hostPlayerId: string | null;
  joinedPlayerIds?: string[];
  rematchReadyPlayerIds?: string[];
  roomNotice?: string | null;
  canStartGame?: boolean;
  canRestartRematch?: boolean;
  mode: 'local' | 'lan';
  phase: 'setup' | 'playing' | 'ended';
  turnPhase: string;
  players: Player[];
  currentPlayerIndex: number;
  dealerIndex: number;
  playerHands: { [playerId: string]: Card[] };
  playerCardCounts?: { [playerId: string]: number };
  viewerPlayerId?: string | null;
  stockpileCount: number;
  discardPile: Card[];
  drawnCard: Card | null;
  winner: Player | null;
  finalScores: { [playerId: string]: number } | null;
  dhumbalCalledBy: Player | null;
  roundNumber: number;
  turnCount: number;
}
