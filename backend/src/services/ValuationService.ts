import { Card } from '../models/Card';

/**
 * Service for calculating card values and hand scores in Dhumbal
 */
export class ValuationService {
  /**
   * Get the Dhumbal threshold based on player count
   * 2 players = 5, 3 players = 10, 4+ players = 15
   */
  static getDhumbalThreshold(playerCount: number): number {
    if (playerCount <= 2) {
      return 5;
    } else if (playerCount === 3) {
      return 10;
    } else {
      return 15;
    }
  }

  /**
   * Calculate the total score of a hand of cards
   * Ace=1, Jack=11, Queen=12, King=13, 2-10=face value
   */
  static calculateHandScore(cards: Card[]): number {
    return cards.reduce((sum, card) => sum + card.getPointValue(), 0);
  }

  /**
   * Check if a player can call "Dhumbal" with the given score
   * Threshold depends on player count: 2 players=5, 3 players=10, 4+ players=15
   */
  static canCallDhumbal(handScore: number, playerCount: number): boolean {
    const threshold = this.getDhumbalThreshold(playerCount);
    return handScore <= threshold;
  }

  /**
   * Get the point value of a single card
   */
  static getCardValue(card: Card): number {
    return card.getPointValue();
  }
}
