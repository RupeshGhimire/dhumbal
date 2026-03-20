import { Component, EventEmitter, Output } from '@angular/core';
import { GameService, LanLobbySummary, PlayerConfig } from '../../services/game.service';
import { GameState } from '../../models/game-state.model';
import { SoundService } from '../../services/sound.service';

type PlayerMode = 'human' | 'bot';
type SetupMode = 'single' | 'lan-host' | 'lan-join';
type MenuSection = 'play' | 'lan-guide' | 'options';

@Component({
  selector: 'app-game-setup',
  templateUrl: './game-setup.component.html',
  styleUrls: ['./game-setup.component.scss'],
})
export class GameSetupComponent {
  @Output() gameCreated = new EventEmitter<{
    gameId: string;
    gameState: GameState;
    playerId: string;
    authToken: string | null;
  }>();

  menuSection: MenuSection = 'play';
  setupMode: SetupMode = 'single';
  playerCount = 2;
  playerNames: string[] = ['', ''];
  playerModes: PlayerMode[] = ['human', 'bot'];
  lanGameCode = '';
  lanDisplayName = '';
  availableLobbies: LanLobbySummary[] = [];
  isLoadingLobbies = false;
  autoEndTurnEnabled = true;
  isLoading = false;
  error = '';
  private readonly autoEndTurnStorageKey = 'dhumbal_auto_end_turn';

  constructor(private gameService: GameService, private soundService: SoundService) {
    const stored = localStorage.getItem(this.autoEndTurnStorageKey);
    this.autoEndTurnEnabled = stored === null ? true : stored === 'true';
  }

  get soundEnabled(): boolean {
    return this.soundService.isEnabled();
  }

  get soundVolumePercent(): number {
    return Math.round(this.soundService.getVolume() * 100);
  }

  get startButtonLabel(): string {
    if (this.isLoading) {
      return 'Working...';
    }
    if (this.setupMode === 'lan-join') {
      return 'Join Lobby';
    }
    if (this.setupMode === 'lan-host') {
      return 'Create Lobby';
    }
    return 'Start Game';
  }

  setMenuSection(section: MenuSection): void {
    this.menuSection = section;
    this.error = '';
  }

  get playerIndices(): number[] {
    return Array.from({ length: this.playerCount }, (_, i) => i);
  }

  get defaultNamesHint(): string {
    return this.playerIndices.map(i => `"Player ${i + 1}"`).join(', ');
  }

  setSetupMode(mode: SetupMode): void {
    this.setupMode = mode;
    this.error = '';
    this.menuSection = 'play';
    if (mode !== 'lan-join') {
      this.lanGameCode = this.sanitizeLobbyCode(this.lanGameCode);
      return;
    }

    this.refreshLanLobbies();
  }

  setPlayerCount(count: number): void {
    this.playerCount = count;
    while (this.playerNames.length < count) {
      this.playerNames.push('');
    }
    this.playerNames = this.playerNames.slice(0, count);
    while (this.playerModes.length < count) {
      this.playerModes.push('bot');
    }
    this.playerModes = this.playerModes.slice(0, count);
  }

  startGame(): void {
    if (this.setupMode === 'lan-host') {
      this.startLanHostGame();
      return;
    }

    if (this.setupMode === 'lan-join') {
      this.joinLanGame();
      return;
    }

    this.startLocalGame();
  }

  private startLocalGame(): void {
    // Use default names for empty player names
    const playerNamesWithDefaults = this.playerNames.map((name, index) => {
      return name && name.trim() !== '' ? name.trim() : `Player ${index + 1}`;
    });
    const playerConfigs: PlayerConfig[] = this.playerModes.map((mode) => ({
      isBot: mode === 'bot',
      difficulty: 'easy',
    }));

    this.isLoading = true;
    this.error = '';

    this.gameService.createGame(playerNamesWithDefaults, playerConfigs).subscribe({
      next: (response) => {
        if (response.gameId) {
          // If there is at least one human, use that player as this client identity.
          const humanPlayer = response.gameState.players.find((player) => !player.isBot);
          const playerId = humanPlayer ? humanPlayer.id : '';
          this.gameCreated.emit({
            gameId: response.gameId,
            gameState: response.gameState,
            playerId,
            authToken: null,
          });
        }
        this.isLoading = false;
      },
      error: (err) => {
        this.error = this.getFriendlyError(err, 'Failed to create game');
        this.isLoading = false;
      },
    });
  }

  private startLanHostGame(): void {
    const hostName = this.lanDisplayName.trim() || 'Host';
    this.isLoading = true;
    this.error = '';

    this.gameService.createLanGame(this.playerCount, hostName).subscribe({
      next: (response) => {
        if (response.gameId && response.gameState && response.playerId) {
          this.gameCreated.emit({
            gameId: response.gameId,
            gameState: response.gameState,
            playerId: response.playerId,
            authToken: response.authToken || null,
          });
        }
        this.isLoading = false;
      },
      error: (err) => {
        this.error = this.getFriendlyError(
          err,
          'Failed to create LAN game. Start the host backend and the LAN frontend first.'
        );
        this.isLoading = false;
      },
    });
  }

  private joinLanGame(): void {
    const gameCode = this.sanitizeLobbyCode(this.lanGameCode);
    const displayName = this.lanDisplayName.trim();

    this.lanGameCode = gameCode;

    if (!gameCode || !displayName) {
      this.error = 'Game code and display name are required to join';
      return;
    }

    this.isLoading = true;
    this.error = '';

    this.gameService.joinLanGame(gameCode, displayName).subscribe({
      next: (response) => {
        if (response.gameId && response.gameState && response.playerId) {
          this.gameCreated.emit({
            gameId: response.gameId,
            gameState: response.gameState,
            playerId: response.playerId,
            authToken: response.authToken || null,
          });
        }
        this.isLoading = false;
      },
      error: (err) => {
        this.error = this.getFriendlyError(
          err,
          'Failed to join LAN game. Check the game code and confirm the host server is reachable.'
        );
        this.isLoading = false;
      },
    });
  }

  get isFormValid(): boolean {
    if (this.setupMode === 'lan-join') {
      return Boolean(this.sanitizeLobbyCode(this.lanGameCode) && this.lanDisplayName.trim());
    }
    return true;
  }

  setPlayerMode(index: number, mode: PlayerMode): void {
    this.playerModes[index] = mode;
  }

  onLobbyCodeChanged(value: string): void {
    this.lanGameCode = this.sanitizeLobbyCode(value);
  }

  refreshLanLobbies(): void {
    this.isLoadingLobbies = true;
    this.gameService.getLanLobbies().subscribe({
      next: (response) => {
        this.availableLobbies = response.lobbies || [];
        this.isLoadingLobbies = false;
      },
      error: () => {
        this.availableLobbies = [];
        this.isLoadingLobbies = false;
      },
    });
  }

  useLobbyCode(code: string | null): void {
    if (!code) {
      return;
    }

    this.lanGameCode = this.sanitizeLobbyCode(code);
    this.error = '';
  }

  toggleSound(): void {
    this.soundService.setEnabled(!this.soundService.isEnabled());
  }

  toggleAutoEndTurn(): void {
    this.autoEndTurnEnabled = !this.autoEndTurnEnabled;
    localStorage.setItem(this.autoEndTurnStorageKey, String(this.autoEndTurnEnabled));
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

  private sanitizeLobbyCode(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  private getFriendlyError(err: any, fallback: string): string {
    const apiError = err?.error?.error || err?.error?.message;
    if (apiError) {
      return apiError;
    }

    if (err?.status === 0) {
      return `${fallback} If you are hosting, run backend: npm run dev and frontend: npm run start:lan on the host machine.`;
    }

    return fallback;
  }
}
