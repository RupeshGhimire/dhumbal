export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';

export class Card {
  constructor(public suit: Suit, public rank: Rank) {}

  /**
   * Returns the point value of the card according to Nepalese Dhumbal rules
   * Ace=1, Jack=11, Queen=12, King=13, 2-10=face value
   */
  getPointValue(): number {
    switch (this.rank) {
      case 'A':
        return 1;
      case 'K':
        return 13;
      case 'Q':
        return 12;
      case 'J':
        return 11;
      case '10':
        return 10;
      case '9':
        return 9;
      case '8':
        return 8;
      case '7':
        return 7;
      case '6':
        return 6;
      case '5':
        return 5;
      case '4':
        return 4;
      case '3':
        return 3;
      case '2':
        return 2;
      default:
        throw new Error(`Unknown rank: ${this.rank}`);
    }
  }

  /**
   * Returns a string representation of the card
   */
  toString(): string {
    return `${this.rank}${this.suit[0].toUpperCase()}`;
  }

  /**
   * Check equality between two cards
   */
  equals(other: Card): boolean {
    return this.suit === other.suit && this.rank === other.rank;
  }
}
