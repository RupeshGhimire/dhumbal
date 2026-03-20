import { Card, GameState } from '../models';
import { GameEngine } from './GameEngine';
import { ValuationService } from './ValuationService';

interface CandidateDiscard {
  indices: number[];
  discardedScore: number;
  remainingScore: number;
  discardCount: number;
}

/**
 * Basic bot heuristics for Dhumbal gameplay.
 * This is intentionally simple for v1 and can be upgraded later.
 */
export class BotService {
  static shouldCallDhumbal(gameState: GameState): boolean {
    return GameEngine.canCurrentPlayerCallDhumbal(gameState);
  }

  static chooseDiscardIndices(gameState: GameState): number[] {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const hand = gameState.playerHands.get(currentPlayer.id) || [];

    if (hand.length === 0) {
      throw new Error('Bot cannot discard from an empty hand');
    }

    const candidates = this.getValidDiscardCandidates(hand);
    if (candidates.length === 0) {
      throw new Error('No valid discard options found for bot');
    }

    candidates.sort((a, b) => {
      if (a.remainingScore !== b.remainingScore) {
        return a.remainingScore - b.remainingScore;
      }
      if (a.discardedScore !== b.discardedScore) {
        return b.discardedScore - a.discardedScore;
      }
      if (a.discardCount !== b.discardCount) {
        return b.discardCount - a.discardCount;
      }
      return a.indices[0] - b.indices[0];
    });

    return candidates[0].indices;
  }

  static chooseDrawSource(gameState: GameState): 'stockpile' | 'discard' {
    if (gameState.discardPile.length === 0) {
      return 'stockpile';
    }
    if (gameState.stockpile.length === 0) {
      return 'discard';
    }

    const topDiscard = gameState.discardPile[gameState.discardPile.length - 1];
    const topValue = ValuationService.getCardValue(topDiscard);

    // Prefer low visible values from discard pile; otherwise take unknown stockpile.
    return topValue <= 7 ? 'discard' : 'stockpile';
  }

  private static getValidDiscardCandidates(hand: Card[]): CandidateDiscard[] {
    const candidates: CandidateDiscard[] = [];

    for (let size = 1; size <= Math.min(4, hand.length); size++) {
      const combos = this.combinations(hand.length, size);
      for (const indices of combos) {
        const cards = indices.map((index) => hand[index]);
        if (size >= 2 && !GameEngine.isValidDiscardGroup(cards)) {
          continue;
        }

        const discardedScore = cards.reduce(
          (sum, card) => sum + ValuationService.getCardValue(card),
          0
        );
        const remainingCards = hand.filter((_, index) => !indices.includes(index));
        const remainingScore = ValuationService.calculateHandScore(remainingCards);

        candidates.push({
          indices,
          discardedScore,
          remainingScore,
          discardCount: size,
        });
      }
    }

    return candidates;
  }

  private static combinations(length: number, size: number): number[][] {
    const results: number[][] = [];

    const generate = (start: number, path: number[]) => {
      if (path.length === size) {
        results.push([...path]);
        return;
      }

      for (let i = start; i < length; i++) {
        path.push(i);
        generate(i + 1, path);
        path.pop();
      }
    };

    generate(0, []);
    return results;
  }
}