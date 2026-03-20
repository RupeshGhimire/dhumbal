import { v4 as uuidv4 } from 'uuid';
import { Card, Deck, GameState, Player } from '../models';
import { ValuationService } from './ValuationService';

export interface GameEndResult {
  winner: Player;
  allScores: Map<string, number>;
  dhumbalCaller: Player;
}

export interface PlayerConfig {
  isBot?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}

/**
 * Core game engine service for Dhumbal
 * Handles all game logic including initialization, turn processing, and win determination
 */
export class GameEngine {
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
   * Initialize a new game of Dhumbal
   * @param playerNames - Array of player names (2-5 players)
   * @throws Error if invalid number of players
   */
  static initializeGame(playerNames: string[], playerConfigs?: PlayerConfig[]): GameState {
    if (playerNames.length < 2 || playerNames.length > 5) {
      throw new Error('Dhumbal requires 2 to 5 players');
    }

    const gameId = uuidv4();
    const deck = new Deck();

    // Create players
    const players: Player[] = playerNames.map((name, index) => ({
      id: uuidv4(),
      name,
      position: index,
      isBot: Boolean(playerConfigs?.[index]?.isBot),
      difficulty: playerConfigs?.[index]?.difficulty,
    }));

    // Dealer is at position 0, game starts with player to the left of dealer (position 1)
    const dealerIndex = 0;
    const currentPlayerIndex = 1 % players.length;

    // Deal 5 cards to each player
    const playerHands = new Map<string, Card[]>();
    for (const player of players) {
      const hand: Card[] = [];
      for (let i = 0; i < 5; i++) {
        const card = deck.drawCard();
        if (card) hand.push(card);
      }
      playerHands.set(player.id, hand);
    }

    // Initialize stockpile and discard pile
    const stockpile = deck.getCards();
    const discardCard = stockpile.pop();
    const discardPile = discardCard ? [discardCard] : [];

    const gameState: GameState = {
      id: gameId,
      createdAt: new Date(),
      mode: 'local',
      phase: 'playing',
      turnPhase: 'waiting_for_action',
      lobbyCode: null,
      hostPlayerId: null,
      players,
      currentPlayerIndex,
      dealerIndex,
      playerHands,
      stockpile,
      discardPile,
      drawnCard: null,
      pendingDiscard: [],
      winner: null,
      finalScores: null,
      dhumbalCalledBy: null,
      roundNumber: 1,
      turnCount: 0,
    };

    return gameState;
  }

  /**
   * Process a discard action at the start of a turn
   * @param gameState - Current game state
  * @param cardIndices - Array of indices of cards in player's hand to discard (1 to 4 cards)
   * @returns Updated game state after discard
   */
  static discardCards(gameState: GameState, cardIndices: number[]): GameState {
    const newState = this.deepCopyGameState(gameState);
    const currentPlayer = newState.players[newState.currentPlayerIndex];

    const playerHand = newState.playerHands.get(currentPlayer.id);
    if (!playerHand) {
      throw new Error('Player hand not found');
    }

    if (cardIndices.length < 1 || cardIndices.length > 4) {
      throw new Error('Must discard between 1 and 4 cards');
    }

    // Sort indices in descending order to remove from highest index first
    const sortedIndices = [...cardIndices].sort((a, b) => b - a);

    // Validate all indices
    for (const index of sortedIndices) {
      if (index < 0 || index >= playerHand.length) {
        throw new Error('Invalid card index');
      }
    }

    // Check if indices are unique
    if (new Set(sortedIndices).size !== sortedIndices.length) {
      throw new Error('Duplicate card indices');
    }

    if (cardIndices.length >= 2) {
      const selectedCards = cardIndices.map((index) => playerHand[index]);
      if (!this.isValidDiscardGroup(selectedCards)) {
        throw new Error(
          'Invalid discard set. Allowed: same-rank sets (2-4 cards) or same-suit runs (3-4 cards, including Q-K-A).'
        );
      }
    }

    // Remove cards from hand (in descending order to maintain indices)
    const discardedCards: Card[] = [];
    for (const index of sortedIndices) {
      discardedCards.unshift(playerHand.splice(index, 1)[0]);
    }

    newState.pendingDiscard = discardedCards;
    newState.turnPhase = 'waiting_for_draw';
    return newState;
  }

  static isValidDiscardGroup(cards: Card[]): boolean {
    return this.isSameRankSet(cards) || this.isSameSuitSequence(cards);
  }

  private static isSameRankSet(cards: Card[]): boolean {
    if (cards.length < 2 || cards.length > 4) {
      return false;
    }

    const firstRank = cards[0].rank;
    return cards.every((card) => card.rank === firstRank);
  }

  private static isSameSuitSequence(cards: Card[]): boolean {
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
   * Process a draw action (after discard)
   * @param gameState - Current game state
   * @param source - Where to draw from: 'stockpile' or 'discard'
   * @returns Updated game state after drawing and completing the turn
   */
  static drawCard(
    gameState: GameState,
    source: 'stockpile' | 'discard'
  ): GameState {
    const newState = this.deepCopyGameState(gameState);
    const currentPlayer = newState.players[newState.currentPlayerIndex];
    let drawnCard: Card | null = null;

    if (source === 'stockpile') {
      if (newState.stockpile.length === 0) {
        throw new Error('Stockpile is empty');
      }
      drawnCard = newState.stockpile.shift() || null;
      if (drawnCard) {
        const playerHand = newState.playerHands.get(currentPlayer.id);
        if (playerHand) {
          playerHand.push(drawnCard);
        }
      }
    } else if (source === 'discard') {
      if (newState.discardPile.length === 0) {
        throw new Error('Discard pile is empty');
      }
      drawnCard = newState.discardPile.pop() || null;
      if (drawnCard) {
        const playerHand = newState.playerHands.get(currentPlayer.id);
        if (playerHand) {
          playerHand.push(drawnCard);
        }
      }
    } else {
      throw new Error('Invalid draw source');
    }

    newState.drawnCard = drawnCard;

    // Move to turn_complete phase to allow player to manually end turn
    newState.turnPhase = 'turn_complete';
    newState.turnCount++;

    // Reshuffle if stockpile is empty
    if (newState.stockpile.length === 0 && newState.discardPile.length > 1) {
      this.reshuffleStockpile(newState);
    }

    // Place the discarded cards on the discard pile
    if (newState.pendingDiscard && newState.pendingDiscard.length > 0) {
      newState.discardPile.push(...newState.pendingDiscard);
      newState.pendingDiscard = [];
    }

    return newState;
  }

  /**
   * End the current turn and advance to the next player
   * @param gameState - Current game state
   * @returns Updated game state with next player's turn starting
   */
  static endTurn(gameState: GameState): GameState {
    const newState = this.deepCopyGameState(gameState);

    if (newState.turnPhase !== 'turn_complete') {
      throw new Error('Cannot end turn - turn is not complete');
    }

    // Advance to next player
    newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
    newState.turnPhase = 'waiting_for_action';
    newState.drawnCard = null;

    return newState;
  }

  /**
   * Process a "Dhumbal" call, ending the game
   * @param gameState - Current game state
   * @returns Game end result with winner and final scores
   */
  static callDhumbal(gameState: GameState): GameEndResult {
    const newState = this.deepCopyGameState(gameState);
    const currentPlayer = newState.players[newState.currentPlayerIndex];
    const playerCount = gameState.players.length;

    // Verify the player can call Dhumbal (hand value <= threshold based on player count)
    const playerHand = newState.playerHands.get(currentPlayer.id);
    if (!playerHand) {
      throw new Error('Player hand not found');
    }

    const handScore = ValuationService.calculateHandScore(playerHand);
    if (!ValuationService.canCallDhumbal(handScore, playerCount)) {
      const threshold = ValuationService.getDhumbalThreshold(playerCount);
      throw new Error(
        `Cannot call Dhumbal with hand value of ${handScore}. Must be ${threshold} or less.`
      );
    }

    // Calculate all player scores
    const finalScores = new Map<string, number>();
    for (const player of newState.players) {
      const hand = newState.playerHands.get(player.id) || [];
      const score = ValuationService.calculateHandScore(hand);
      finalScores.set(player.id, score);
    }

    // Determine winner (lowest score, with tie-breaker: caller wins)
    let winningScore = Infinity;
    let winners: Player[] = [];

    for (const player of newState.players) {
      const score = finalScores.get(player.id) || 0;
      if (score < winningScore) {
        winningScore = score;
        winners = [player];
      } else if (score === winningScore) {
        winners.push(player);
      }
    }

    // Tie-breaker: if multiple winners, the caller wins
    let winner = winners[0];
    if (winners.length > 1 && winners.some((p) => p.id === currentPlayer.id)) {
      winner = currentPlayer;
    }

    newState.phase = 'ended';
    newState.winner = winner;
    newState.finalScores = finalScores;
    newState.dhumbalCalledBy = currentPlayer;

    return {
      winner,
      allScores: finalScores,
      dhumbalCaller: currentPlayer,
    };
  }

  /**
   * Get the current player's hand score
   */
  static getCurrentPlayerHandScore(gameState: GameState): number {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const hand = gameState.playerHands.get(currentPlayer.id) || [];
    return ValuationService.calculateHandScore(hand);
  }

  /**
   * Check if current player can call Dhumbal
   */
  static canCurrentPlayerCallDhumbal(gameState: GameState): boolean {
    const score = this.getCurrentPlayerHandScore(gameState);
    const playerCount = gameState.players.length;
    return ValuationService.canCallDhumbal(score, playerCount);
  }

  static startLanGame(gameState: GameState): GameState {
    const newState = this.deepCopyGameState(gameState);
    newState.phase = 'playing';
    newState.turnPhase = 'waiting_for_action';
    newState.drawnCard = null;
    newState.pendingDiscard = [];
    return newState;
  }

  static restartGame(gameState: GameState): GameState {
    const deck = new Deck();
    const players = gameState.players.map((player) => ({ ...player }));
    const dealerIndex = (gameState.dealerIndex + 1) % players.length;
    const currentPlayerIndex = (dealerIndex + 1) % players.length;

    const playerHands = new Map<string, Card[]>();
    for (const player of players) {
      const hand: Card[] = [];
      for (let i = 0; i < 5; i++) {
        const card = deck.drawCard();
        if (card) {
          hand.push(card);
        }
      }
      playerHands.set(player.id, hand);
    }

    const stockpile = deck.getCards();
    const discardCard = stockpile.pop();
    const discardPile = discardCard ? [discardCard] : [];

    return {
      id: gameState.id,
      createdAt: gameState.createdAt,
      mode: gameState.mode,
      phase: 'playing',
      turnPhase: 'waiting_for_action',
      lobbyCode: gameState.lobbyCode,
      hostPlayerId: gameState.hostPlayerId,
      players,
      currentPlayerIndex,
      dealerIndex,
      playerHands,
      stockpile,
      discardPile,
      drawnCard: null,
      pendingDiscard: [],
      winner: null,
      finalScores: null,
      dhumbalCalledBy: null,
      roundNumber: gameState.roundNumber + 1,
      turnCount: 0,
    };
  }

  /**
   * Reshuffle the stockpile from discard pile when stockpile is empty
   * Keeps the top card of discard pile separate
   */
  private static reshuffleStockpile(gameState: GameState): void {
    if (gameState.discardPile.length <= 1) {
      return; // Can't reshuffle if only one card in discard pile
    }

    // Remove the top card from discard pile
    const topCard = gameState.discardPile.pop();

    // Reshuffle remaining cards into stockpile
    if (topCard) {
      gameState.stockpile = gameState.discardPile;
      this.shuffleArray(gameState.stockpile);
      gameState.discardPile = [topCard];
    }
  }

  /**
   * Fisher-Yates shuffle algorithm
   */
  private static shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Deep copy game state to avoid mutations
   */
  private static deepCopyGameState(gameState: GameState): GameState {
    return {
      id: gameState.id,
      createdAt: gameState.createdAt,
      mode: gameState.mode,
      phase: gameState.phase,
      turnPhase: gameState.turnPhase,
      lobbyCode: gameState.lobbyCode,
      hostPlayerId: gameState.hostPlayerId,
      players: [...gameState.players],
      currentPlayerIndex: gameState.currentPlayerIndex,
      dealerIndex: gameState.dealerIndex,
      playerHands: new Map(
        Array.from(gameState.playerHands).map(([key, cards]) => [key, [...cards]])
      ),
      stockpile: [...gameState.stockpile],
      discardPile: [...gameState.discardPile],
      drawnCard: gameState.drawnCard ? new Card(gameState.drawnCard.suit, gameState.drawnCard.rank) : null,
      pendingDiscard: gameState.pendingDiscard ? [...gameState.pendingDiscard.map(card => new Card(card.suit, card.rank))] : [],
      winner: gameState.winner,
      finalScores: gameState.finalScores ? new Map(gameState.finalScores) : null,
      dhumbalCalledBy: gameState.dhumbalCalledBy,
      roundNumber: gameState.roundNumber,
      turnCount: gameState.turnCount,
    };
  }
}
