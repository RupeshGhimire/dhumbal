import { Card, Suit, Rank } from './Card';

export class Deck {
  private cards: Card[];

  constructor() {
    this.cards = [];
    this.initializeDeck();
    this.shuffle();
  }

  /**
   * Initialize a standard 52-card deck
   */
  private initializeDeck(): void {
    const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

    for (const suit of suits) {
      for (const rank of ranks) {
        this.cards.push(new Card(suit, rank));
      }
    }
  }

  /**
   * Shuffle the deck using Fisher-Yates algorithm
   */
  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * Draw a card from the top of the deck
   */
  drawCard(): Card | undefined {
    return this.cards.shift();
  }

  /**
   * Get the number of cards remaining in the deck
   */
  getCardCount(): number {
    return this.cards.length;
  }

  /**
   * Check if the deck is empty
   */
  isEmpty(): boolean {
    return this.cards.length === 0;
  }

  /**
   * Get all remaining cards (for reshuffle operations)
   */
  getCards(): Card[] {
    return [...this.cards];
  }

  /**
   * Add cards back to the deck (for reshuffle)
   */
  addCards(cards: Card[]): void {
    this.cards.push(...cards);
  }

  /**
   * Clear the deck
   */
  clear(): void {
    this.cards = [];
  }
}
