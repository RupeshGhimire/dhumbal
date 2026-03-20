import { Component, EventEmitter, Input, Output } from '@angular/core';
import { GameState } from '../../models/game-state.model';

@Component({
  selector: 'app-game-over',
  templateUrl: './game-over.component.html',
  styleUrls: ['./game-over.component.scss'],
})
export class GameOverComponent {
  @Input() gameState!: GameState;
  @Input() isRestarting = false;
  @Input() actionError = '';
  @Input() playerId: string | null = null;
  @Output() restart = new EventEmitter<void>();
  @Output() mainMenu = new EventEmitter<void>();

  get isLanMode(): boolean {
    return this.gameState?.mode === 'lan';
  }

  get readyPlayerCount(): number {
    return this.gameState?.rematchReadyPlayerIds?.length || 0;
  }

  get totalPlayers(): number {
    return this.gameState?.players?.length || 0;
  }

  get isCurrentPlayerReady(): boolean {
    return Boolean(this.playerId && this.gameState?.rematchReadyPlayerIds?.includes(this.playerId));
  }

  get rematchButtonLabel(): string {
    if (!this.isLanMode) {
      return this.isRestarting ? 'Starting New Round...' : 'Play Again';
    }

    if (this.isCurrentPlayerReady) {
      return 'Ready';
    }

    return 'Play Agin';
  }

  get rematchButtonDisabled(): boolean {
    if (this.isRestarting) {
      return true;
    }

    return this.isLanMode && this.isCurrentPlayerReady;
  }

  get finalScore(): number | null {
    if (!this.gameState || !this.gameState.finalScores || !this.gameState.winner) {
      return null;
    }
    return this.gameState.finalScores[this.gameState.winner.id];
  }

  onRestart(): void {
    if (this.rematchButtonDisabled) {
      return;
    }
    this.restart.emit();
  }

  onMainMenu(): void {
    this.mainMenu.emit();
  }
}
