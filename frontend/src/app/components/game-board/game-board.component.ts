import { Component, EventEmitter, Input, Output, OnInit, OnDestroy } from '@angular/core';
import { GameState } from '../../models/game-state.model';
import { GameService } from '../../services/game.service';
import { SoundService } from '../../services/sound.service';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-game-board',
  templateUrl: './game-board.component.html',
  styleUrls: ['./game-board.component.scss'],
})
export class GameBoardComponent implements OnInit, OnDestroy {
  @Input() gameState!: GameState;
  @Input() playerId!: string;
  @Input() currentPlayerName!: string;
  @Output() gameUpdated = new EventEmitter<GameState>();
  @Output() gameEnded = new EventEmitter<void>();

  isLoading = false;
  error = '';
  selectedCardIndices: number[] = [];
  private destroy$ = new Subject<void>();
  private previousCurrentPlayerIndex = -1;
  private previousTurnPhase = '';
  private botTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private botTurnInProgress = false;
  private lastScheduledBotTurnKey = '';
  private readonly autoEndTurnStorageKey = 'dhumbal_auto_end_turn';
  autoEndTurnEnabled = true;

  constructor(private gameService: GameService, private soundService: SoundService) {}

  ngOnInit(): void {
    const storedAutoEndTurn = localStorage.getItem(this.autoEndTurnStorageKey);
    this.autoEndTurnEnabled = storedAutoEndTurn === null ? true : storedAutoEndTurn === 'true';

    this.previousCurrentPlayerIndex = this.gameState.currentPlayerIndex;
    this.previousTurnPhase = this.gameState.turnPhase;

    // Poll for game state updates at a faster cadence for smoother LAN interactions.
    interval(600)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.gameState.phase === 'playing') {
          this.pollGameState();
        }
      });

    this.scheduleBotTurnIfNeeded(this.gameState);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearBotTurnTimer();
  }

  pollGameState(): void {
    this.gameService.getGameState(this.gameState.id).subscribe({
      next: (response) => {
        this.applyStateUpdate(response.gameState);

        if (this.gameState.phase === 'ended') {
          this.gameEnded.emit();
        }
      },
      error: (err) => {
        console.error('Error polling game state:', err);
      },
    });
  }

  get isCurrentPlayer(): boolean {
    if (this.gameState.mode === 'local') {
      return true;
    }

    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    return Boolean(currentPlayer && currentPlayer.id === this.playerId);
  }

  get myPlayerIndex(): number {
    const idx = this.gameState.players.findIndex(p => p.id === this.playerId);
    return idx >= 0 ? idx : 0;
  }

  getPlayerPositionStyle(playerIndex: number): { [key: string]: string } {
    const n = this.gameState.players.length;
    const relativeIndex = (playerIndex - this.myPlayerIndex + n) % n;
    const angleDeg = 270 + relativeIndex * (360 / n);
    const angleRad = (angleDeg * Math.PI) / 180;
    const radius = 41;
    const leftPct = 50 + radius * Math.cos(angleRad);
    const topPct = 50 - radius * Math.sin(angleRad);
    return {
      left: `${leftPct.toFixed(1)}%`,
      top: `${topPct.toFixed(1)}%`,
      transform: 'translate(-50%, -50%)',
    };
  }

  get isCurrentPlayerBot(): boolean {
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    return Boolean(currentPlayer?.isBot);
  }

  get myHand(): any[] {
    return this.gameState.playerHands[this.playerId] || [];
  }

  get displayedHandPlayerId(): string {
    if (this.gameState.mode === 'local') {
      return this.gameState.players[this.gameState.currentPlayerIndex].id;
    }

    return this.playerId;
  }

  get displayedHandPlayerName(): string {
    if (this.gameState.mode === 'local') {
      return this.gameState.players[this.gameState.currentPlayerIndex].name;
    }

    const me = this.gameState.players.find((player) => player.id === this.playerId);
    return me ? me.name : 'Your';
  }

  get currentHandScore(): number {
    const hand = this.gameState.playerHands[this.displayedHandPlayerId] || [];
    return hand.reduce((sum, card) => sum + this.getCardValue(card), 0);
  }

  get canCallDhumbal(): boolean {
    const threshold = this.getDhumbalThreshold(this.gameState.players.length);
    return (
      this.currentHandScore <= threshold &&
      this.isCurrentPlayer &&
      this.gameState.turnPhase === 'waiting_for_action' &&
      !this.isCurrentPlayerBot &&
      !this.botTurnInProgress
    );
  }

  getDhumbalThreshold(playerCount: number): number {
    if (playerCount <= 2) {
      return 5;
    } else if (playerCount === 3) {
      return 10;
    } else {
      return 15;
    }
  }

  get canSelectDiscard(): boolean {
    // Allow discarding during waiting_for_action phase (player must discard first)
    return (
      this.isCurrentPlayer &&
      this.gameState.turnPhase === 'waiting_for_action' &&
      !this.isCurrentPlayerBot &&
      !this.botTurnInProgress
    );
  }

  get canDraw(): boolean {
    // Allow drawing during waiting_for_draw phase (after discard is completed)
    return (
      this.isCurrentPlayer &&
      this.gameState.turnPhase === 'waiting_for_draw' &&
      !this.isCurrentPlayerBot &&
      !this.botTurnInProgress
    );
  }

  get canEndTurn(): boolean {
    // Allow ending turn after it's complete
    return (
      this.isCurrentPlayer &&
      this.gameState.turnPhase === 'turn_complete' &&
      !this.isCurrentPlayerBot &&
      !this.botTurnInProgress
    );
  }

  drawSource: 'stockpile' | 'discard' | null = null;
  dragOverTable = false;
  dragOverDiscard = false;
  isDraggingCards = false;

  onTableDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOverTable = true;
  }

  onTableDragLeave(event: DragEvent): void {
    this.dragOverTable = false;
  }

  onTableDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOverTable = false;
    this.isDraggingCards = false;
    // Get card data from drag event
    const cardIndices = event.dataTransfer?.getData('cardIndices');
    if (cardIndices) {
      const indices = JSON.parse(cardIndices);
      this.selectedCardIndices = indices;
      // Auto-confirm the discard
      this.onDiscardCards();
    }
  }

  onDiscardPileDragOver(event: DragEvent): void {
    if (this.canSelectDiscard) {
      event.preventDefault();
      this.dragOverDiscard = true;
    }
  }

  onDiscardPileDragLeave(event: DragEvent): void {
    this.dragOverDiscard = false;
  }

  onDiscardPileDrop(event: DragEvent): void {
    if (this.canSelectDiscard) {
      event.preventDefault();
      this.dragOverDiscard = false;
      this.isDraggingCards = false;
      // Get card data from drag event
      const cardIndices = event.dataTransfer?.getData('cardIndices');
      if (cardIndices) {
        const indices = JSON.parse(cardIndices);
        this.selectedCardIndices = indices;
        // Auto-confirm the discard
        this.onDiscardCards();
      }
    }
  }

  getDiscardCardStyle(index: number, totalCards: number): any {
    if (totalCards <= 1) {
      return {
        transform: 'translate(20px, 12px) rotate(-16deg)',
        zIndex: 1,
      };
    }

    if (totalCards === 2) {
      const twoCardPattern = [4, 22];
      const twoCardRotation = [-12, 10];
      return {
        transform: `translate(${twoCardPattern[index]}px, 12px) rotate(${twoCardRotation[index]}deg)`,
        zIndex: index,
      };
    }

    const spreadPattern = [-36, -20, -8, 4, 16, 28, 40, 52];
    const verticalPattern = [-6, -1, 4, 9, 14, 18, 23, 27];
    const rotationPattern = [-24, -16, -9, -3, 4, 11, 18, 26];
    const patternIndex = index % spreadPattern.length;
    const offsetX = spreadPattern[patternIndex];
    const offsetY = verticalPattern[patternIndex] + Math.floor(index / spreadPattern.length) * 4;
    const rotation = rotationPattern[patternIndex];

    return {
      transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`,
      zIndex: index,
    };
  }

  onCardSelected(index: number): void {
    if (this.isLoading || !this.canSelectDiscard) {
      return;
    }

    const cardIndex = this.selectedCardIndices.indexOf(index);
    if (cardIndex > -1) {
      this.selectedCardIndices.splice(cardIndex, 1);
    } else {
      // Allow selecting up to 4 cards for same-rank sets and same-suit runs.
      if (this.selectedCardIndices.length < 4) {
        this.selectedCardIndices.push(index);
      }
    }
  }

  // Adapter used by child component event
  onDiscardCard(cardIndex: number): void {
    this.onCardSelected(cardIndex);
  }

  onDiscardCards(): void {
    if (this.isLoading || this.selectedCardIndices.length === 0) {
      return;
    }

    this.isLoading = true;
    this.gameService
      .discardCards(this.gameState.id, this.selectedCardIndices)
      .subscribe({
        next: (response) => {
          this.applyStateUpdate(response.gameState);
          this.soundService.playDiscard();
          this.selectedCardIndices = [];
          this.error = '';
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Error discarding cards:', err);
          this.error = this.normalizeApiError(
            err?.error?.error || err?.error?.message || 'Failed to discard cards'
          );
          this.isLoading = false;
        },
      });
  }

  // Adapter for template button
  confirmDiscard(): void {
    this.onDiscardCards();
  }

  onDrawCard(source: 'stockpile' | 'discard'): void {
    if (this.isLoading || !this.canDraw) {
      return;
    }

    this.isLoading = true;
    this.drawSource = source;
    this.gameService.drawCard(this.gameState.id, source).subscribe({
      next: (response) => {
        this.applyStateUpdate(response.gameState);
        this.soundService.playDraw();
        this.error = '';
        this.drawSource = null;
        this.isLoading = false;

        if (this.autoEndTurnEnabled && this.canEndTurn) {
          this.onEndTurn();
        }
      },
      error: (err) => {
        console.error('Error drawing card:', err);
        this.error = this.normalizeApiError(
          err?.error?.error || err?.error?.message || 'Failed to draw card'
        );
        this.isLoading = false;
        this.drawSource = null;
      },
    });
  }

  onCallDhumbal(): void {
    if (this.isLoading || !this.canCallDhumbal) {
      return;
    }

    this.isLoading = true;
    this.gameService.callDhumbal(this.gameState.id).subscribe({
      next: (response) => {
        this.applyStateUpdate(response.gameState);
        this.error = '';
        this.gameEnded.emit();
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error calling Dhumbal:', err);
        this.error = this.normalizeApiError(
          err?.error?.error || err?.error?.message || 'Failed to call Dhumbal'
        );
        this.isLoading = false;
      },
    });
  }

  // Handle auto-discard when pair or single card is submitted from player hand
  onAutoDiscard(indices: number[]): void {
    this.selectedCardIndices = indices;
    // Auto-confirm the discard
    setTimeout(() => {
      this.onDiscardCards();
    }, 10);
  }

  onEndTurn(): void {
    if (this.isLoading || !this.canEndTurn) {
      return;
    }

    this.isLoading = true;
    this.gameService.endTurn(this.gameState.id).subscribe({
      next: (response) => {
        this.applyStateUpdate(response.gameState);
        this.soundService.playTurnPass();
        this.selectedCardIndices = [];
        this.dragOverTable = false;
        this.dragOverDiscard = false;
        this.isDraggingCards = false;
        this.error = '';
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error ending turn:', err);
        this.error = this.normalizeApiError(
          err?.error?.error || err?.error?.message || 'Failed to end turn'
        );
        this.isLoading = false;
      },
    });
  }

  getPlayerHandScore(playerId: string): number {
    const hand = this.gameState.playerHands[playerId] || [];
    return hand.reduce((sum, card) => sum + this.getCardValue(card), 0);
  }

  private getCardValue(card: any): number {
    switch (card.rank) {
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
        return 0; // Should not happen
    }
  }

  private applyStateUpdate(nextState: GameState): void {
    const playerChanged = this.previousCurrentPlayerIndex !== nextState.currentPlayerIndex;
    const phaseChanged = this.previousTurnPhase !== nextState.turnPhase;

    if (playerChanged || phaseChanged) {
      this.selectedCardIndices = [];
      this.dragOverTable = false;
      this.dragOverDiscard = false;
      this.isDraggingCards = false;
    }

    if (phaseChanged && nextState.turnPhase !== 'waiting_for_action') {
      this.selectedCardIndices = [];
    }

    const nextCurrentPlayer = nextState.players[nextState.currentPlayerIndex];
    const canDiscardInNextState =
      nextState.turnPhase === 'waiting_for_action' &&
      !nextCurrentPlayer?.isBot &&
      (nextState.mode === 'local' || nextCurrentPlayer?.id === this.playerId);

    if (!canDiscardInNextState) {
      this.selectedCardIndices = [];
    }

    this.gameState = nextState;
    this.previousCurrentPlayerIndex = nextState.currentPlayerIndex;
    this.previousTurnPhase = nextState.turnPhase;
    this.gameUpdated.emit(this.gameState);
    this.scheduleBotTurnIfNeeded(nextState);
  }

  onHandDragStateChange(isDragging: boolean): void {
    this.isDraggingCards = isDragging && this.canSelectDiscard;
    if (!this.isDraggingCards) {
      this.dragOverTable = false;
      this.dragOverDiscard = false;
    }
  }

  private normalizeApiError(message: string): string {
    if (message === 'Pair must be cards of the same rank') {
      return 'Invalid discard set. Use same-rank sets (2-4 cards) or same-suit runs (3-4 cards).';
    }
    if (message === 'Must discard 1 or 2 cards') {
      return 'You can discard between 1 and 4 cards.';
    }
    return message;
  }

  get currentActionText(): string {
    if (!this.isCurrentPlayer && this.gameState.phase === 'playing') {
      return `Waiting for ${this.gameState.players[this.gameState.currentPlayerIndex].name} to play`;
    }

    if (this.isCurrentPlayerBot && this.gameState.phase === 'playing') {
      return `${this.gameState.players[this.gameState.currentPlayerIndex].name} is thinking...`;
    }

    if (this.gameState.turnPhase === 'waiting_for_action') {
      return 'Discard 1 card, a same-rank set (2-4), or a same-suit run (3-4)';
    }
    if (this.gameState.turnPhase === 'waiting_for_draw') {
      return 'Take a card from the stockpile or grab the top discard';
    }
    if (this.gameState.turnPhase === 'turn_complete') {
      return 'Looking good — pass the turn when you\'re ready';
    }
    return 'Waiting...';
  }

  private scheduleBotTurnIfNeeded(state: GameState): void {
    if (state.mode === 'lan') {
      this.lastScheduledBotTurnKey = '';
      this.clearBotTurnTimer();
      return;
    }

    if (state.phase !== 'playing') {
      this.lastScheduledBotTurnKey = '';
      this.clearBotTurnTimer();
      return;
    }

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer?.isBot || this.botTurnInProgress) {
      if (!currentPlayer?.isBot) {
        this.lastScheduledBotTurnKey = '';
      }
      return;
    }

    const turnKey = `${state.turnCount}:${state.currentPlayerIndex}:${state.turnPhase}`;
    if (turnKey === this.lastScheduledBotTurnKey) {
      return;
    }

    this.lastScheduledBotTurnKey = turnKey;
    this.clearBotTurnTimer();
    this.botTurnTimer = setTimeout(
      () => this.executeBotTurn(),
      this.getBotThinkDelayMs(state.turnPhase)
    );
  }

  private executeBotTurn(): void {
    if (this.botTurnInProgress || this.gameState.phase !== 'playing') {
      return;
    }

    this.botTurnInProgress = true;
    this.isLoading = true;
    this.gameService.executeBotTurn(this.gameState.id).subscribe({
      next: (response) => {
        this.botTurnInProgress = false;
        if (response.botActionSummary?.discardedIndices?.length) {
          this.soundService.playDiscard();
        }
        if (response.botActionSummary?.drawSource) {
          this.soundService.playDraw();
        }
        if (response.botActionSummary?.endedTurn) {
          this.soundService.playTurnPass();
        }
        this.applyStateUpdate(response.gameState);
        this.error = '';
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error executing bot turn:', err);
        this.botTurnInProgress = false;
        this.lastScheduledBotTurnKey = '';
        this.error = this.normalizeApiError(
          err?.error?.error || err?.error?.message || 'Failed to execute bot turn'
        );
        this.isLoading = false;
      },
    });
  }

  private clearBotTurnTimer(): void {
    if (this.botTurnTimer) {
      clearTimeout(this.botTurnTimer);
      this.botTurnTimer = null;
    }
  }

  private getBotThinkDelayMs(turnPhase: string): number {
    if (turnPhase === 'waiting_for_action') {
      return this.randomBetween(1800, 3000);
    }
    if (turnPhase === 'waiting_for_draw') {
      return this.randomBetween(1400, 2400);
    }
    if (turnPhase === 'turn_complete') {
      return this.randomBetween(1100, 1800);
    }
    return this.randomBetween(1300, 2200);
  }

  private randomBetween(minMs: number, maxMs: number): number {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }
  
}
