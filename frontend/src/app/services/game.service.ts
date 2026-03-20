import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { GameState } from '../models/game-state.model';

export interface PlayerConfig {
  isBot?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface GameResponse {
  gameId?: string;
  playerId?: string;
  authToken?: string;
  gameState: GameState;
  botActionSummary?: {
    playerId: string;
    playerName: string;
    calledDhumbal: boolean;
    discardedIndices: number[];
    drawSource: 'stockpile' | 'discard' | null;
    endedTurn: boolean;
  };
  result?: {
    winner: any;
    scores: { [playerId: string]: number };
  };
}

export interface LanLobbySummary {
  gameId: string;
  lobbyCode: string | null;
  hostName: string;
  roomName: string;
  playerCount: number;
  joinedCount: number;
  createdAt: string;
}

export interface LanLobbiesResponse {
  lobbies: LanLobbySummary[];
}

@Injectable({
  providedIn: 'root',
})
export class GameService {
  private apiUrl = '/api/games';
  private authToken: string | null = null;

  constructor(private http: HttpClient) {}

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  private getRequestOptions(): { headers?: HttpHeaders } {
    if (!this.authToken) {
      return {};
    }

    return {
      headers: new HttpHeaders({
        Authorization: `Bearer ${this.authToken}`,
      }),
    };
  }

  createGame(playerNames: string[], playerConfigs?: PlayerConfig[]): Observable<GameResponse> {
    return this.http.post<GameResponse>(this.apiUrl, {
      playerNames,
      playerConfigs,
    });
  }

  createLanGame(playerCount: number, hostName: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(this.apiUrl, {
      mode: 'lan',
      playerCount,
      hostName,
    });
  }

  joinLanGame(gameId: string, playerName: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/join`, { playerName });
  }

  getLanLobbies(): Observable<LanLobbiesResponse> {
    return this.http.get<LanLobbiesResponse>(`${this.apiUrl}/lobbies`);
  }

  startLanGame(gameId: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/start`, {}, this.getRequestOptions());
  }

  restartGame(gameId: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/restart`, {}, this.getRequestOptions());
  }

  setRematchReady(gameId: string, ready: boolean = true): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/rematch-ready`, { ready }, this.getRequestOptions());
  }

  closeGame(gameId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${gameId}`, this.getRequestOptions());
  }

  leaveGame(gameId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${gameId}/leave`, {}, this.getRequestOptions());
  }

  getGameState(gameId: string): Observable<GameResponse> {
    return this.http.get<GameResponse>(`${this.apiUrl}/${gameId}`, this.getRequestOptions());
  }

  drawCard(gameId: string, source: 'stockpile' | 'discard'): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/draw`, { source }, this.getRequestOptions());
  }

  discardCards(gameId: string, cardIndices: number[]): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/discard`, { cardIndices }, this.getRequestOptions());
  }

  callDhumbal(gameId: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/dhumbal`, {}, this.getRequestOptions());
  }

  endTurn(gameId: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/end-turn`, {}, this.getRequestOptions());
  }

  executeBotTurn(gameId: string): Observable<GameResponse> {
    return this.http.post<GameResponse>(`${this.apiUrl}/${gameId}/execute-bot-turn`, {}, this.getRequestOptions());
  }
}
