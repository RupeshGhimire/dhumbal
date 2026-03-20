import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GameState, Card } from './models/game-state.model';
import { GameService } from './services/game.service';
import { SoundService } from './services/sound.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  gameState: GameState | null = null;
  gameId: string | null = null;
  playerId: string | null = null;
  authToken: string | null = null;
  gameStarted = false;
  gameEnded = false;
  currentPlayerName = '';
  gameCodeCopied = false;
  lobbyActionError = '';
  isClosingGame = false;
  isStartingLobby = false;
  isRestartingGame = false;
  gameOverActionError = '';
  private hasPlayedEndSound = false;
  private readonly sessionStorageKey = 'dhumbal_session_v1';
  private readonly destroy$ = new Subject<void>();

  get soundEnabled(): boolean {
    return this.soundService.isEnabled();
  }

  get soundVolumePercent(): number {
    return Math.round(this.soundService.getVolume() * 100);
  }

  constructor(private gameService: GameService, private soundService: SoundService) {}

  ngOnInit(): void {
    interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (!this.gameStarted || !this.gameId || !this.gameState) {
          return;
        }

        if (
          this.gameState.phase === 'setup' ||
          (this.gameState.mode === 'lan' && this.gameState.phase === 'ended')
        ) {
          this.refreshLobbyState();
        }
      });

    const savedSessionRaw = localStorage.getItem(this.sessionStorageKey);
    if (!savedSessionRaw) {
      return;
    }

    try {
      const parsed = JSON.parse(savedSessionRaw) as {
        gameId?: string;
        playerId?: string;
        authToken?: string;
      };

      if (!parsed.gameId || !parsed.playerId || !parsed.authToken) {
        return;
      }

      this.gameId = parsed.gameId;
      this.playerId = parsed.playerId;
      this.authToken = parsed.authToken;
      this.gameService.setAuthToken(this.authToken);

      this.gameService.getGameState(parsed.gameId).subscribe({
        next: (response) => {
          this.gameStarted = true;
          this.applyIncomingGameState(response.gameState);
        },
        error: () => {
          this.clearStoredSession();
          this.resetGame();
        },
      });
    } catch {
      this.clearStoredSession();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Use `any` for event parameters since Angular templates treat custom events as generic Event
  onGameCreated(data: any): void {
    if (data) {
      this.gameId = data.gameId;
      this.playerId = data.playerId;
      this.authToken = data.authToken || null;
      this.gameService.setAuthToken(this.authToken);
      this.gameStarted = true;
      this.gameEnded = false;
      this.hasPlayedEndSound = false;
      this.lobbyActionError = '';
      this.gameOverActionError = '';
      this.isRestartingGame = false;
      this.applyIncomingGameState(data.gameState);
      this.persistSession();
    }
  }

  onGameUpdated(gameState: any): void {
    if (gameState) {
      this.applyIncomingGameState(gameState);
    }
  }

  onGameEnded(): void {
    this.gameEnded = true;
    if (!this.hasPlayedEndSound) {
      this.soundService.playGameEnd();
      this.hasPlayedEndSound = true;
    }
  }

  toggleSound(): void {
    this.soundService.setEnabled(!this.soundService.isEnabled());
  }

  onVolumeChanged(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const value = Number(input.value);
    if (Number.isNaN(value)) {
      return;
    }

    this.soundService.setVolume(value / 100);
  }

  resetGame(): void {
    this.gameService.setAuthToken(null);
    this.clearStoredSession();
    this.gameId = null;
    this.gameState = null;
    this.playerId = null;
    this.authToken = null;
    this.gameStarted = false;
    this.gameEnded = false;
    this.gameCodeCopied = false;
    this.hasPlayedEndSound = false;
    this.currentPlayerName = '';
    this.lobbyActionError = '';
    this.isClosingGame = false;
    this.isStartingLobby = false;
    this.isRestartingGame = false;
    this.gameOverActionError = '';
  }

  restartCurrentGame(): void {
    if (!this.gameId || !this.gameStarted || !this.gameEnded || this.isRestartingGame) {
      return;
    }

    if (this.gameState?.mode === 'lan') {
      this.markRematchReady();
      return;
    }

    this.isRestartingGame = true;
    this.gameOverActionError = '';

    this.gameService.restartGame(this.gameId).subscribe({
      next: (response) => {
        this.applyIncomingGameState(response.gameState);
        this.gameEnded = false;
        this.isRestartingGame = false;
      },
      error: (err) => {
        this.gameOverActionError = err?.error?.error || 'Failed to start a new round';
        this.isRestartingGame = false;
      },
    });
  }

  private markRematchReady(): void {
    if (!this.gameId || this.gameState?.mode !== 'lan' || !this.gameEnded) {
      return;
    }

    this.isRestartingGame = true;
    this.gameOverActionError = '';

    this.gameService.setRematchReady(this.gameId, true).subscribe({
      next: (response) => {
        this.applyIncomingGameState(response.gameState);
        this.isRestartingGame = false;
      },
      error: (err) => {
        this.gameOverActionError = err?.error?.error || 'Failed to set ready status';
        this.isRestartingGame = false;
      },
    });
  }

  get showLanGameCode(): boolean {
    return Boolean(this.gameStarted && this.gameState?.mode === 'lan' && this.displayedGameCode);
  }

  get displayedGameCode(): string | null {
    return this.gameState?.lobbyCode || this.gameId;
  }

  get isHostPlayer(): boolean {
    return Boolean(this.gameState?.hostPlayerId && this.playerId === this.gameState.hostPlayerId);
  }

  get joinedPlayerCount(): number {
    return this.gameState?.joinedPlayerIds?.length || 0;
  }

  get totalPlayerCount(): number {
    return this.gameState?.players.length || 0;
  }

  get allPlayersJoined(): boolean {
    return this.totalPlayerCount > 0 && this.joinedPlayerCount === this.totalPlayerCount;
  }

  get canHostStartGame(): boolean {
    return Boolean(this.gameState?.canStartGame && this.isHostPlayer && !this.isStartingLobby);
  }

  get isInLobby(): boolean {
    return Boolean(this.gameStarted && this.gameState?.phase === 'setup');
  }

  copyGameCode(): void {
    if (!this.displayedGameCode) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(this.displayedGameCode)
        .then(() => {
          this.showCopiedState();
        })
        .catch(() => {
          this.showCopiedState();
        });
      return;
    }

    this.showCopiedState();
  }

  startLanGame(): void {
    if (!this.gameId || !this.canHostStartGame) {
      return;
    }

    this.isStartingLobby = true;
    this.lobbyActionError = '';
    this.gameService.startLanGame(this.gameId).subscribe({
      next: (response) => {
        this.applyIncomingGameState(response.gameState);
        this.isStartingLobby = false;
      },
      error: (err) => {
        this.lobbyActionError = err?.error?.error || 'Failed to start the lobby';
        this.isStartingLobby = false;
      },
    });
  }

  closeCurrentGame(): void {
    if (!this.gameStarted) {
      this.resetGame();
      return;
    }

    if (this.gameState?.mode === 'lan' && this.isHostPlayer && this.gameId) {
      this.isClosingGame = true;
      this.lobbyActionError = '';
      this.gameService.closeGame(this.gameId).subscribe({
        next: () => {
          this.resetGame();
        },
        error: (err) => {
          this.lobbyActionError = err?.error?.error || 'Failed to close the room';
          this.isClosingGame = false;
        },
      });
      return;
    }

    if (this.gameState?.mode === 'lan' && this.gameId) {
      this.isClosingGame = true;
      this.lobbyActionError = '';
      this.gameService.leaveGame(this.gameId).subscribe({
        next: () => {
          this.resetGame();
        },
        error: () => {
          // Even if leave request fails, local user should still return to menu.
          this.resetGame();
        },
      });
      return;
    }

    this.resetGame();
  }

  @HostListener('window:beforeunload')
  onBeforeUnload(): void {
    if (!this.gameStarted || !this.gameId || !this.authToken || this.gameState?.mode !== 'lan') {
      return;
    }

    fetch(`/api/games/${this.gameId}/leave`, {
      method: 'POST',
      keepalive: true,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }).catch(() => {
      // Best-effort only.
    });
  }

  isPlayerJoined(playerId: string): boolean {
    return Boolean(this.gameState?.joinedPlayerIds?.includes(playerId));
  }

  getPlayerCardCount(playerId: string): number {
    if (!this.gameState) {
      return 0;
    }
    if (this.gameState.playerCardCounts && this.gameState.playerCardCounts[playerId] !== undefined) {
      return this.gameState.playerCardCounts[playerId];
    }
    return (this.gameState.playerHands[playerId] || []).length;
  }

  getPlayerHandScore(playerId: string): number {
    if (!this.gameState) return 0;

    if (this.gameState.mode === 'lan' && playerId !== this.playerId) {
      return 0;
    }

    const hand = this.gameState.playerHands[playerId] || [];
    return hand.reduce((sum, card) => sum + this.getCardValue(card), 0);
  }

  canShowPlayerScore(playerId: string): boolean {
    return this.gameState?.mode !== 'lan' || playerId === this.playerId;
  }

  private getCardValue(card: Card): number {
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

  private updateCurrentPlayerName(): void {
    if (this.gameState) {
      const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
      this.currentPlayerName = currentPlayer?.name || '';
    }
  }

  private refreshLobbyState(): void {
    if (!this.gameId) {
      return;
    }

    this.gameService.getGameState(this.gameId).subscribe({
      next: (response) => {
        this.applyIncomingGameState(response.gameState);
      },
      error: () => {
        this.resetGame();
      },
    });
  }

  private applyIncomingGameState(gameState: GameState): void {
    const previousPhase = this.gameState?.phase;
    const wasEnded = this.gameState?.phase === 'ended' || this.gameEnded;

    this.gameState = gameState;
    this.gameEnded = gameState.phase === 'ended';
    this.updateCurrentPlayerName();

    if (
      ((previousPhase === 'setup' || previousPhase === 'ended') && gameState.phase === 'playing') ||
      (!previousPhase && gameState.phase === 'playing')
    ) {
      this.soundService.playGameStart();
    }

    if (gameState.phase === 'ended') {
      if (!wasEnded && !this.hasPlayedEndSound) {
        this.soundService.playGameEnd();
        this.hasPlayedEndSound = true;
      }
      return;
    }

    this.hasPlayedEndSound = false;
  }

  private persistSession(): void {
    if (!this.gameId || !this.playerId || !this.authToken) {
      return;
    }

    localStorage.setItem(
      this.sessionStorageKey,
      JSON.stringify({
        gameId: this.gameId,
        playerId: this.playerId,
        authToken: this.authToken,
      })
    );
  }

  private clearStoredSession(): void {
    localStorage.removeItem(this.sessionStorageKey);
  }

  private showCopiedState(): void {
    this.gameCodeCopied = true;
    setTimeout(() => {
      this.gameCodeCopied = false;
    }, 1400);
  }
}
