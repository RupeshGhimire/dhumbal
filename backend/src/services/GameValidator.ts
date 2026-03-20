import { GameState } from '../models';
import { GameEngine } from './GameEngine';
import { ValuationService } from './ValuationService';

/**
 * Service for validating game actions and state transitions
 */
export class GameValidator {
  private static readonly rankOrder: Record<string, number> = {
    A: 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    J: 11,
    Q: 12,
    K: 13,
  };

  /**
   * Validate that a discard action is valid (performed first in turn)
   */
  static validateDiscardAction(gameState: GameState, cardIndices: number[]): void {
    if (gameState.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    if (gameState.turnPhase !== 'waiting_for_action') {
      throw new Error(
        `Cannot discard during ${gameState.turnPhase}. Must be in waiting_for_action phase.`
      );
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const playerHand = gameState.playerHands.get(currentPlayer.id);

    if (!playerHand) {
      throw new Error('Player hand not found');
    }

    if (cardIndices.length < 1 || cardIndices.length > 4) {
      throw new Error('Must discard between 1 and 4 cards');
    }

    // Check for duplicate indices
    if (new Set(cardIndices).size !== cardIndices.length) {
      throw new Error('Duplicate card indices');
    }

    // Validate each index
    for (const index of cardIndices) {
      if (index < 0 || index >= playerHand.length) {
        throw new Error(`Invalid card index ${index}. Hand has ${playerHand.length} cards.`);
      }
    }

    if (cardIndices.length >= 2) {
      const selectedCards = cardIndices.map((index) => playerHand[index]);
      if (!this.isValidDiscardGroup(selectedCards)) {
        throw new Error(
          'Invalid discard set. Allowed: same-rank sets (2-4 cards) or same-suit runs (3-4 cards, including Q-K-A).'
        );
      }
    }
  }

  private static isValidDiscardGroup(cards: { rank: string; suit: string }[]): boolean {
    return this.isSameRankSet(cards) || this.isSameSuitSequence(cards);
  }

  private static isSameRankSet(cards: { rank: string; suit: string }[]): boolean {
    if (cards.length < 2 || cards.length > 4) {
      return false;
    }

    const firstRank = cards[0].rank;
    return cards.every((card) => card.rank === firstRank);
  }

  private static isSameSuitSequence(cards: { rank: string; suit: string }[]): boolean {
    if (cards.length < 3 || cards.length > 4) {
      return false;
    }

    const firstSuit = cards[0].suit;
    if (!cards.every((card) => card.suit === firstSuit)) {
      return false;
    }

    const rawValues = cards.map((card) => this.rankOrder[card.rank]);
    if (rawValues.some((value) => value === undefined)) {
      return false;
    }

    const uniqueValues = Array.from(new Set(rawValues));
    if (uniqueValues.length !== cards.length) {
      return false;
    }

    if (this.formsConsecutiveRun(uniqueValues)) {
      return true;
    }

    // Allow Ace-high runs such as Q-K-A and J-Q-K-A.
    const aceHighValues = uniqueValues.map((value) => (value === 1 ? 14 : value));
    return this.formsConsecutiveRun(aceHighValues);
  }

  private static formsConsecutiveRun(values: number[]): boolean {
    const sorted = [...values].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        return false;
      }
    }
    return true;
  }

  /**
   * Validate that a draw action is valid (performed after discard)
   */
  static validateDrawAction(gameState: GameState): void {
    if (gameState.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    if (gameState.turnPhase !== 'waiting_for_draw') {
      throw new Error(
        `Cannot draw during ${gameState.turnPhase}. Must be in waiting_for_draw phase.`
      );
    }

    if (gameState.stockpile.length === 0 && gameState.discardPile.length === 0) {
      throw new Error('No cards available to draw');
    }
  }

  /**
   * Validate that a Dhumbal call is valid
   */
  static validateDhumbalCall(gameState: GameState): void {
    if (gameState.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    if (gameState.turnPhase !== 'waiting_for_action') {
      throw new Error(
        `Cannot call Dhumbal during ${gameState.turnPhase}. Must be in waiting_for_action phase.`
      );
    }

    if (!GameEngine.canCurrentPlayerCallDhumbal(gameState)) {
      const score = GameEngine.getCurrentPlayerHandScore(gameState);
      const playerCount = gameState.players.length;
      const threshold = ValuationService.getDhumbalThreshold(playerCount);
      throw new Error(
        `Cannot call Dhumbal with hand value of ${score}. Must be ${threshold} or less.`
      );
    }
  }

  /**
   * Validate a draw source is available
   */
  static validateDrawSource(gameState: GameState, source: 'stockpile' | 'discard'): void {
    if (source === 'stockpile' && gameState.stockpile.length === 0) {
      throw new Error('Stockpile is empty');
    }

    if (source === 'discard' && gameState.discardPile.length === 0) {
      throw new Error('Discard pile is empty');
    }

    if (source !== 'stockpile' && source !== 'discard') {
      throw new Error('Invalid draw source');
    }
  }

  /**
   * Validate that a turn can be ended
   */
  static validateEndTurnAction(gameState: GameState): void {
    if (gameState.phase !== 'playing') {
      throw new Error('Game is not in playing phase');
    }

    if (gameState.turnPhase !== 'turn_complete') {
      throw new Error(
        `Cannot end turn during ${gameState.turnPhase}. Must be in turn_complete phase.`
      );
    }
  }

  /**
   * Check if a player can perform any action
   */
  static canPlayerAct(gameState: GameState, playerId: string): boolean {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    return currentPlayer.id === playerId;
  }

  /**
   * Validate that the requesting player is the active turn owner
   */
  static validateCurrentPlayerTurn(gameState: GameState, requestingPlayerId: string): void {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== requestingPlayerId) {
      throw new Error('Not your turn');
    }
  }
}
