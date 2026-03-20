import { Card } from '../models/Card';
import { GameEngine } from '../services/GameEngine';
import { BotService } from '../services/BotService';

describe('BotService', () => {
  it('should return at least one legal discard index', () => {
    let gameState = GameEngine.initializeGame(['Human', 'Bot'], [
      { isBot: false },
      { isBot: true, difficulty: 'easy' },
    ]);

    gameState.currentPlayerIndex = 1;
    gameState.playerHands.set(gameState.players[1].id, [
      new Card('hearts', 'K'),
      new Card('spades', 'Q'),
      new Card('diamonds', 'J'),
      new Card('clubs', '10'),
      new Card('hearts', '9'),
    ]);

    const indices = BotService.chooseDiscardIndices(gameState);

    expect(indices.length).toBeGreaterThanOrEqual(1);
    expect(indices.length).toBeLessThanOrEqual(4);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('should prefer discard pile draw for low-value visible top card', () => {
    let gameState = GameEngine.initializeGame(['Human', 'Bot'], [
      { isBot: false },
      { isBot: true, difficulty: 'easy' },
    ]);

    gameState.currentPlayerIndex = 1;
    gameState.turnPhase = 'waiting_for_draw';
    gameState.discardPile = [new Card('clubs', '3')];
    gameState.stockpile = [new Card('spades', 'K')];

    const source = BotService.chooseDrawSource(gameState);

    expect(source).toBe('discard');
  });

  it('should call dhumbal when current bot hand is eligible', () => {
    let gameState = GameEngine.initializeGame(['Human', 'Bot'], [
      { isBot: false },
      { isBot: true, difficulty: 'easy' },
    ]);

    gameState.currentPlayerIndex = 1;
    gameState.playerHands.set(gameState.players[1].id, [
      new Card('hearts', 'A'),
      new Card('diamonds', 'A'),
      new Card('clubs', 'A'),
      new Card('spades', 'A'),
      new Card('hearts', 'A'),
    ]);

    expect(BotService.shouldCallDhumbal(gameState)).toBe(true);
  });
});
