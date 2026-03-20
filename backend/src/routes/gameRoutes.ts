import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { BotService, GameEngine, GameValidator } from '../services';
import { GameState } from '../models';

const router = Router();

// In-memory game storage (for local development)
// In production, this would be a database
const games = new Map<string, GameState>();
const lobbyCodeToGameId = new Map<string, string>();
const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_CODE_LENGTH = 6;

interface GameSession {
  claimedPlayerIds: Set<string>;
  tokenToPlayerId: Map<string, string>;
  playerIdToToken: Map<string, string>;
  rematchReadyPlayerIds: Set<string>;
  playerLastSeenAt: Map<string, number>;
  roomNotice: string | null;
}

const PRESENCE_TIMEOUT_MS = 20_000;

const gameSessions = new Map<string, GameSession>();

interface PlayerConfigRequest {
  isBot?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}

interface CreateGameRequestBody {
  playerNames?: string[];
  playerConfigs?: PlayerConfigRequest[];
  mode?: 'local' | 'lan';
  playerCount?: number;
  hostName?: string;
}

function getOrCreateSession(gameId: string): GameSession {
  const existing = gameSessions.get(gameId);
  if (existing) {
    return existing;
  }

  const created: GameSession = {
    claimedPlayerIds: new Set<string>(),
    tokenToPlayerId: new Map<string, string>(),
    playerIdToToken: new Map<string, string>(),
    rematchReadyPlayerIds: new Set<string>(),
    playerLastSeenAt: new Map<string, number>(),
    roomNotice: null,
  };
  gameSessions.set(gameId, created);
  return created;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (!authHeader) {
    return null;
  }
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim() || null;
}

function getRequestingPlayerId(req: Request, gameState: GameState): string | null {
  if (gameState.mode !== 'lan') {
    return null;
  }

  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  const session = gameSessions.get(gameState.id);
  if (!session) {
    return null;
  }

  return session.tokenToPlayerId.get(token) || null;
}

function claimSeat(gameState: GameState, playerId: string): string {
  const session = getOrCreateSession(gameState.id);
  const existingToken = session.playerIdToToken.get(playerId);
  if (existingToken) {
    session.claimedPlayerIds.add(playerId);
    session.tokenToPlayerId.set(existingToken, playerId);
    session.playerLastSeenAt.set(playerId, Date.now());
    return existingToken;
  }

  const token = uuidv4();
  session.claimedPlayerIds.add(playerId);
  session.playerIdToToken.set(playerId, token);
  session.tokenToPlayerId.set(token, playerId);
  session.playerLastSeenAt.set(playerId, Date.now());
  return token;
}

function markPlayerPresent(gameId: string, playerId: string): void {
  const session = gameSessions.get(gameId);
  if (!session) {
    return;
  }

  session.playerLastSeenAt.set(playerId, Date.now());
}

function removePlayerFromSession(gameState: GameState, playerId: string): void {
  const session = gameSessions.get(gameState.id);
  if (!session) {
    return;
  }

  session.claimedPlayerIds.delete(playerId);
  session.rematchReadyPlayerIds.delete(playerId);
  session.playerLastSeenAt.delete(playerId);

  const token = session.playerIdToToken.get(playerId);
  if (token) {
    session.tokenToPlayerId.delete(token);
  }
  session.playerIdToToken.delete(playerId);
}

function concludeLanRoundFromDeparture(gameState: GameState, departedPlayerNames: string[]): void {
  const session = getOrCreateSession(gameState.id);
  const connectedPlayers = gameState.players.filter((player) => session.claimedPlayerIds.has(player.id));
  const departureText = departedPlayerNames.join(', ');
  const plural = departedPlayerNames.length > 1 ? 'have' : 'has';

  gameState.phase = 'ended';
  gameState.turnPhase = 'turn_complete';
  gameState.dhumbalCalledBy = null;
  gameState.winner = connectedPlayers.length === 1 ? connectedPlayers[0] : null;

  if (connectedPlayers.length > 0) {
    const forfeitScores = new Map<string, number>();
    for (const player of gameState.players) {
      forfeitScores.set(player.id, session.claimedPlayerIds.has(player.id) ? 0 : 99);
    }
    gameState.finalScores = forfeitScores;
  } else {
    gameState.finalScores = null;
  }

  session.roomNotice = `${departureText} ${plural} left the room. Match ended.`;
}

function refreshLanPresence(gameState: GameState): void {
  if (gameState.mode !== 'lan') {
    return;
  }

  const session = getOrCreateSession(gameState.id);
  const now = Date.now();
  const timedOutPlayerIds: string[] = [];

  for (const playerId of session.claimedPlayerIds) {
    const lastSeen = session.playerLastSeenAt.get(playerId) || 0;
    if (now - lastSeen > PRESENCE_TIMEOUT_MS) {
      timedOutPlayerIds.push(playerId);
    }
  }

  if (timedOutPlayerIds.length === 0) {
    return;
  }

  const departedNames = gameState.players
    .filter((player) => timedOutPlayerIds.includes(player.id))
    .map((player) => player.name);

  for (const playerId of timedOutPlayerIds) {
    removePlayerFromSession(gameState, playerId);
  }

  if (gameState.phase === 'playing') {
    concludeLanRoundFromDeparture(gameState, departedNames);
  } else if (gameState.phase === 'setup' && departedNames.length > 0) {
    const departureText = departedNames.join(', ');
    const plural = departedNames.length > 1 ? 'have' : 'has';
    session.roomNotice = `${departureText} ${plural} left the lobby.`;
  }

  games.set(gameState.id, gameState);
}

function generateLobbyCode(): string {
  while (true) {
    let code = '';
    for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
      const randomIndex = Math.floor(Math.random() * LOBBY_CODE_ALPHABET.length);
      code += LOBBY_CODE_ALPHABET[randomIndex];
    }

    if (!lobbyCodeToGameId.has(code)) {
      return code;
    }
  }
}

function resolveGameLookup(gameLookup: string): { gameId: string; gameState: GameState } | null {
  const normalizedLookup = gameLookup.trim();
  const normalizedCode = normalizedLookup.toUpperCase();
  const resolvedGameId = lobbyCodeToGameId.get(normalizedCode) || normalizedLookup;
  const gameState = games.get(resolvedGameId);

  if (!gameState) {
    return null;
  }

  return { gameId: resolvedGameId, gameState };
}

function getJoinedPlayerIds(gameState: GameState): string[] {
  const session = getOrCreateSession(gameState.id);
  return gameState.players
    .map((player) => player.id)
    .filter((playerId) => session.claimedPlayerIds.has(playerId));
}

function getRematchReadyPlayerIds(gameState: GameState): string[] {
  if (gameState.mode !== 'lan') {
    return [];
  }

  const session = getOrCreateSession(gameState.id);
  return gameState.players
    .map((player) => player.id)
    .filter((playerId) => session.rematchReadyPlayerIds.has(playerId));
}

function clearRematchReadyState(gameId: string): void {
  const session = gameSessions.get(gameId);
  if (!session) {
    return;
  }

  session.rematchReadyPlayerIds.clear();
}

function canRestartLanRematch(gameState: GameState): boolean {
  if (gameState.mode !== 'lan' || gameState.phase !== 'ended') {
    return false;
  }

  return getRematchReadyPlayerIds(gameState).length === gameState.players.length;
}

function canStartLanGame(gameState: GameState, requestingPlayerId?: string): boolean {
  if (gameState.mode !== 'lan' || gameState.phase !== 'setup') {
    return false;
  }

  if (!requestingPlayerId || requestingPlayerId !== gameState.hostPlayerId) {
    return false;
  }

  return getJoinedPlayerIds(gameState).length === gameState.players.length;
}

function closeLanGame(gameState: GameState): void {
  games.delete(gameState.id);
  gameSessions.delete(gameState.id);
  if (gameState.lobbyCode) {
    lobbyCodeToGameId.delete(gameState.lobbyCode);
  }
}

/**
 * Create a new game
 * POST /api/games
 * Body: { playerNames: string[] }
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { playerNames, playerConfigs, mode, playerCount, hostName } =
      req.body as CreateGameRequestBody;

    if (mode === 'lan') {
      if (!playerCount || !Number.isInteger(playerCount) || playerCount < 2 || playerCount > 5) {
        return res.status(400).json({ error: 'playerCount must be an integer between 2 and 5' });
      }

      const sanitizedHostName = hostName && hostName.trim() ? hostName.trim() : 'Host';
      const generatedNames = Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
      generatedNames[0] = sanitizedHostName;

      const lanPlayerConfigs: PlayerConfigRequest[] = generatedNames.map(() => ({
        isBot: false,
      }));

      const gameState = GameEngine.initializeGame(generatedNames, lanPlayerConfigs);
      const hostPlayer = gameState.players[0];
      gameState.mode = 'lan';
      gameState.phase = 'setup';
      gameState.lobbyCode = generateLobbyCode();
      gameState.hostPlayerId = hostPlayer.id;
      games.set(gameState.id, gameState);
      lobbyCodeToGameId.set(gameState.lobbyCode, gameState.id);

      const authToken = claimSeat(gameState, hostPlayer.id);

      return res.status(201).json({
        gameId: gameState.id,
        playerId: hostPlayer.id,
        authToken,
        gameState: serializeGameState(gameState, hostPlayer.id),
      });
    }

    if (!playerNames || !Array.isArray(playerNames)) {
      return res.status(400).json({ error: 'playerNames array is required' });
    }

    if (playerConfigs && !Array.isArray(playerConfigs)) {
      return res.status(400).json({ error: 'playerConfigs must be an array if provided' });
    }

    if (playerConfigs && playerConfigs.length !== playerNames.length) {
      return res.status(400).json({ error: 'playerConfigs length must match playerNames length' });
    }

    const gameState = GameEngine.initializeGame(playerNames, playerConfigs);
    gameState.mode = 'local';
    games.set(gameState.id, gameState);

    res.status(201).json({
      gameId: gameState.id,
      gameState: serializeGameState(gameState),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * Join an existing LAN game by game code
 * POST /api/games/:gameId/join
 * Body: { playerName: string }
 */
router.post('/:gameId/join', (req: Request, res: Response) => {
  try {
    const { gameId: gameLookup } = req.params;
    const { playerName } = req.body as { playerName?: string };

    const resolvedGame = resolveGameLookup(gameLookup);
    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameId, gameState } = resolvedGame;
    refreshLanPresence(gameState);

    if (gameState.mode !== 'lan') {
      return res.status(400).json({ error: 'Join is only supported for LAN games' });
    }

    if (gameState.phase !== 'setup') {
      return res.status(409).json({ error: 'This lobby has already started' });
    }

    const sanitizedName = playerName && playerName.trim() ? playerName.trim() : null;
    if (!sanitizedName) {
      return res.status(400).json({ error: 'playerName is required' });
    }

    const session = getOrCreateSession(gameId);
    const availableSeat = gameState.players.find(
      (player) => !player.isBot && !session.claimedPlayerIds.has(player.id)
    );

    if (!availableSeat) {
      return res.status(409).json({ error: 'All seats are already claimed for this game' });
    }

    availableSeat.name = sanitizedName;
    const authToken = claimSeat(gameState, availableSeat.id);
    session.roomNotice = null;
    games.set(gameId, gameState);

    res.json({
      gameId,
      playerId: availableSeat.id,
      authToken,
      gameState: serializeGameState(gameState, availableSeat.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * List joinable LAN lobbies on this server
 * GET /api/games/lobbies
 */
router.get('/lobbies', (_req: Request, res: Response) => {
  try {
    const lobbies = Array.from(games.values())
      .filter((gameState) => gameState.mode === 'lan' && gameState.phase === 'setup')
      .map((gameState) => {
        const joinedCount = getJoinedPlayerIds(gameState).length;
        const host = gameState.players.find((player) => player.id === gameState.hostPlayerId) || gameState.players[0];

        return {
          gameId: gameState.id,
          lobbyCode: gameState.lobbyCode,
          hostName: host?.name || 'Host',
          roomName: `${host?.name || 'Host'}'s Room`,
          playerCount: gameState.players.length,
          joinedCount,
          createdAt: gameState.createdAt,
        };
      })
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

    return res.json({ lobbies });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
});

/**
 * Execute current bot player's full turn atomically
 * POST /api/games/:gameId/execute-bot-turn
 */
router.post('/:gameId/execute-bot-turn', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const gameState = games.get(gameId);

    if (!gameState) {
      return res.status(404).json({ error: 'Game not found' });
    }

    refreshLanPresence(gameState);

    if (gameState.phase !== 'playing') {
      return res.status(400).json({ error: 'Game is not in playing phase' });
    }

    if (gameState.mode === 'lan') {
      return res.status(400).json({ error: 'Bot turns are disabled for LAN mode' });
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer?.isBot) {
      return res.status(400).json({ error: 'Current player is not a bot' });
    }

    let newState = gameState;
    const actionSummary: {
      playerId: string;
      playerName: string;
      calledDhumbal: boolean;
      discardedIndices: number[];
      drawSource: 'stockpile' | 'discard' | null;
      endedTurn: boolean;
    } = {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      calledDhumbal: false,
      discardedIndices: [],
      drawSource: null,
      endedTurn: false,
    };

    if (newState.turnPhase === 'waiting_for_action' && BotService.shouldCallDhumbal(newState)) {
      GameValidator.validateDhumbalCall(newState);
      const result = GameEngine.callDhumbal(newState);
      newState.phase = 'ended';
      newState.winner = result.winner;
      newState.finalScores = result.allScores;
      newState.dhumbalCalledBy = result.dhumbalCaller;
      actionSummary.calledDhumbal = true;
      games.set(gameId, newState);

      return res.json({
        gameState: serializeGameState(newState, getRequestingPlayerId(req, newState) || undefined),
        botActionSummary: actionSummary,
      });
    }

    if (newState.turnPhase === 'waiting_for_action') {
      const discardIndices = BotService.chooseDiscardIndices(newState);
      GameValidator.validateDiscardAction(newState, discardIndices);
      newState = GameEngine.discardCards(newState, discardIndices);
      actionSummary.discardedIndices = discardIndices;
      games.set(gameId, newState);

      return res.json({
        gameState: serializeGameState(newState, getRequestingPlayerId(req, newState) || undefined),
        botActionSummary: actionSummary,
      });
    }

    if (newState.turnPhase === 'waiting_for_draw') {
      const drawSource = BotService.chooseDrawSource(newState);
      GameValidator.validateDrawAction(newState);
      GameValidator.validateDrawSource(newState, drawSource);
      newState = GameEngine.drawCard(newState, drawSource);
      actionSummary.drawSource = drawSource;
      games.set(gameId, newState);

      return res.json({
        gameState: serializeGameState(newState, getRequestingPlayerId(req, newState) || undefined),
        botActionSummary: actionSummary,
      });
    }

    if (newState.turnPhase === 'turn_complete') {
      GameValidator.validateEndTurnAction(newState);
      newState = GameEngine.endTurn(newState);
      actionSummary.endedTurn = true;
      games.set(gameId, newState);

      return res.json({
        gameState: serializeGameState(newState, getRequestingPlayerId(req, newState) || undefined),
        botActionSummary: actionSummary,
      });
    }

    return res.status(400).json({
      error: `Unsupported bot turn phase: ${newState.turnPhase}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * Start a LAN lobby once every seat is claimed
 * POST /api/games/:gameId/start
 */
router.post('/:gameId/start', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const resolvedGame = resolveGameLookup(gameId);
    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameState } = resolvedGame;
    refreshLanPresence(gameState);
    if (gameState.mode !== 'lan') {
      return res.status(400).json({ error: 'Lobby start is only supported for LAN games' });
    }

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (!requestingPlayerId) {
      return res.status(401).json({ error: 'Missing or invalid player token' });
    }

    markPlayerPresent(gameState.id, requestingPlayerId);

    if (requestingPlayerId !== gameState.hostPlayerId) {
      return res.status(403).json({ error: 'Only the host can start the lobby' });
    }

    if (!canStartLanGame(gameState, requestingPlayerId)) {
      return res.status(409).json({ error: 'All players must join before the host can start the game' });
    }

    const newState = GameEngine.startLanGame(gameState);
    clearRematchReadyState(newState.id);
    getOrCreateSession(newState.id).roomNotice = null;
    games.set(newState.id, newState);

    res.json({ gameState: serializeGameState(newState, requestingPlayerId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * Mark/unmark a LAN player's rematch readiness after game end.
 * If all players are ready, game restarts automatically.
 * POST /api/games/:gameId/rematch-ready
 * Body: { ready?: boolean }
 */
router.post('/:gameId/rematch-ready', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { ready } = req.body as { ready?: boolean };
    const resolvedGame = resolveGameLookup(gameId);

    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameState } = resolvedGame;
    refreshLanPresence(gameState);
    if (gameState.mode !== 'lan') {
      return res.status(400).json({ error: 'Rematch ready is only supported for LAN games' });
    }

    if (gameState.phase !== 'ended') {
      return res.status(409).json({ error: 'Rematch ready can only be set after the game ends' });
    }

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (!requestingPlayerId) {
      return res.status(401).json({ error: 'Missing or invalid player token' });
    }

    markPlayerPresent(gameState.id, requestingPlayerId);

    const session = getOrCreateSession(gameState.id);
    if (ready === false) {
      session.rematchReadyPlayerIds.delete(requestingPlayerId);
    } else {
      session.rematchReadyPlayerIds.add(requestingPlayerId);
    }

    if (canRestartLanRematch(gameState)) {
      const restartedState = GameEngine.restartGame(gameState);
      clearRematchReadyState(restartedState.id);
      games.set(restartedState.id, restartedState);
      return res.json({
        restarted: true,
        gameState: serializeGameState(restartedState, requestingPlayerId),
      });
    }

    return res.json({
      restarted: false,
      gameState: serializeGameState(gameState, requestingPlayerId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
});

/**
 * Restart an ended game with the same players and a fresh deck
 * POST /api/games/:gameId/restart
 */
router.post('/:gameId/restart', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const resolvedGame = resolveGameLookup(gameId);

    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameState } = resolvedGame;
    refreshLanPresence(gameState);

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (gameState.mode === 'lan' && !requestingPlayerId) {
      return res.status(401).json({ error: 'Missing or invalid player token' });
    }

    if (requestingPlayerId) {
      markPlayerPresent(gameState.id, requestingPlayerId);
    }

    if (gameState.phase !== 'ended') {
      return res.status(409).json({ error: 'Game can only be restarted after it ends' });
    }

    if (gameState.mode === 'lan' && !canRestartLanRematch(gameState)) {
      return res.status(409).json({ error: 'All players must tap ready before restarting' });
    }

    const restartedState = GameEngine.restartGame(gameState);
    clearRematchReadyState(restartedState.id);
    getOrCreateSession(restartedState.id).roomNotice = null;
    games.set(restartedState.id, restartedState);

    return res.json({
      gameState: serializeGameState(restartedState, requestingPlayerId || undefined),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
});

/**
 * Leave a LAN room explicitly.
 * POST /api/games/:gameId/leave
 */
router.post('/:gameId/leave', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const resolvedGame = resolveGameLookup(gameId);
    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameState } = resolvedGame;
    if (gameState.mode !== 'lan') {
      games.delete(gameState.id);
      return res.status(204).send();
    }

    refreshLanPresence(gameState);

    const leavingPlayerId = getRequestingPlayerId(req, gameState);
    if (!leavingPlayerId) {
      return res.status(401).json({ error: 'Missing or invalid player token' });
    }

    const leavingPlayer = gameState.players.find((player) => player.id === leavingPlayerId);
    removePlayerFromSession(gameState, leavingPlayerId);

    const leavingName = leavingPlayer?.name || 'A player';
    const session = getOrCreateSession(gameState.id);

    if (gameState.phase === 'playing') {
      concludeLanRoundFromDeparture(gameState, [leavingName]);
    } else if (gameState.phase === 'setup') {
      session.roomNotice = `${leavingName} has left the lobby.`;
    } else if (gameState.phase === 'ended') {
      session.roomNotice = `${leavingName} has left the room.`;
    }

    if (session.claimedPlayerIds.size === 0) {
      closeLanGame(gameState);
      return res.status(204).send();
    }

    games.set(gameState.id, gameState);
    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(400).json({ error: message });
  }
});

/**
 * Close an active LAN room and clear server state
 * DELETE /api/games/:gameId
 */
router.delete('/:gameId', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const resolvedGame = resolveGameLookup(gameId);
    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameState } = resolvedGame;
    if (gameState.mode === 'lan') {
      refreshLanPresence(gameState);
      const requestingPlayerId = getRequestingPlayerId(req, gameState);
      if (!requestingPlayerId) {
        return res.status(401).json({ error: 'Missing or invalid player token' });
      }

      if (requestingPlayerId !== gameState.hostPlayerId) {
        return res.status(403).json({ error: 'Only the host can close the room' });
      }

      const host = gameState.players.find((player) => player.id === requestingPlayerId);
      removePlayerFromSession(gameState, requestingPlayerId);

      const session = getOrCreateSession(gameState.id);
      const hostName = host?.name || 'Host';
      session.roomNotice = `${hostName} closed the room.`;

      if (gameState.phase === 'playing') {
        concludeLanRoundFromDeparture(gameState, [hostName]);
      } else {
        gameState.phase = 'ended';
        gameState.turnPhase = 'turn_complete';
      }

      if (session.claimedPlayerIds.size === 0) {
        closeLanGame(gameState);
      } else {
        games.set(gameState.id, gameState);
      }

      return res.status(204).send();
    }

    games.delete(gameState.id);
    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * Get current game state
 * GET /api/games/:gameId
 */
router.get('/:gameId', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const resolvedGame = resolveGameLookup(gameId);

    if (!resolvedGame) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { gameState } = resolvedGame;
    refreshLanPresence(gameState);

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (gameState.mode === 'lan' && !requestingPlayerId) {
      return res.status(401).json({ error: 'Missing or invalid player token' });
    }

    if (requestingPlayerId) {
      markPlayerPresent(gameState.id, requestingPlayerId);
    }

    res.json({ gameState: serializeGameState(gameState, requestingPlayerId || undefined) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  }
});

/**
 * Draw a card (after discarding)
 * POST /api/games/:gameId/draw
 * Body: { source: 'stockpile' | 'discard' }
 */
router.post('/:gameId/draw', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { source } = req.body;

    const gameState = games.get(gameId);
    if (!gameState) {
      return res.status(404).json({ error: 'Game not found' });
    }

    refreshLanPresence(gameState);

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (gameState.mode === 'lan') {
      if (!requestingPlayerId) {
        return res.status(401).json({ error: 'Missing or invalid player token' });
      }
      markPlayerPresent(gameState.id, requestingPlayerId);
      GameValidator.validateCurrentPlayerTurn(gameState, requestingPlayerId);
    }

    // Validate action
    GameValidator.validateDrawAction(gameState);
    GameValidator.validateDrawSource(gameState, source);

    // Draw card (and complete turn)
    const newState = GameEngine.drawCard(gameState, source);

    games.set(gameId, newState);

    res.json({ gameState: serializeGameState(newState, requestingPlayerId || undefined) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message === 'Not your turn' ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * Discard cards
 * POST /api/games/:gameId/discard
 * Body: { cardIndices: number[] }
 */
router.post('/:gameId/discard', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { cardIndices } = req.body;

    const gameState = games.get(gameId);
    if (!gameState) {
      return res.status(404).json({ error: 'Game not found' });
    }

    refreshLanPresence(gameState);

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (gameState.mode === 'lan') {
      if (!requestingPlayerId) {
        return res.status(401).json({ error: 'Missing or invalid player token' });
      }
      markPlayerPresent(gameState.id, requestingPlayerId);
      GameValidator.validateCurrentPlayerTurn(gameState, requestingPlayerId);
    }

    // Validate action
    GameValidator.validateDiscardAction(gameState, cardIndices);

    // Discard cards
    const newState = GameEngine.discardCards(gameState, cardIndices);
    games.set(gameId, newState);

    res.json({ gameState: serializeGameState(newState, requestingPlayerId || undefined) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message === 'Not your turn' ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * End the current turn and advance to the next player
 * POST /api/games/:gameId/end-turn
 */
router.post('/:gameId/end-turn', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    const gameState = games.get(gameId);
    if (!gameState) {
      return res.status(404).json({ error: 'Game not found' });
    }

    refreshLanPresence(gameState);

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (gameState.mode === 'lan') {
      if (!requestingPlayerId) {
        return res.status(401).json({ error: 'Missing or invalid player token' });
      }
      markPlayerPresent(gameState.id, requestingPlayerId);
      GameValidator.validateCurrentPlayerTurn(gameState, requestingPlayerId);
    }

    // Validate action
    GameValidator.validateEndTurnAction(gameState);

    // End turn
    const newState = GameEngine.endTurn(gameState);

    games.set(gameId, newState);

    res.json({ gameState: serializeGameState(newState, requestingPlayerId || undefined) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message === 'Not your turn' ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * Call Dhumbal to end the game
 * POST /api/games/:gameId/dhumbal
 */
router.post('/:gameId/dhumbal', (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    const gameState = games.get(gameId);
    if (!gameState) {
      return res.status(404).json({ error: 'Game not found' });
    }

    refreshLanPresence(gameState);

    const requestingPlayerId = getRequestingPlayerId(req, gameState);
    if (gameState.mode === 'lan') {
      if (!requestingPlayerId) {
        return res.status(401).json({ error: 'Missing or invalid player token' });
      }
      markPlayerPresent(gameState.id, requestingPlayerId);
      GameValidator.validateCurrentPlayerTurn(gameState, requestingPlayerId);
    }

    // Validate action
    GameValidator.validateDhumbalCall(gameState);

    // Call Dhumbal
    const result = GameEngine.callDhumbal(gameState);
    const newState = gameState;
    newState.phase = 'ended';
    newState.winner = result.winner;
    newState.finalScores = result.allScores;
    newState.dhumbalCalledBy = result.dhumbalCaller;

    games.set(gameId, newState);

    res.json({
      gameState: serializeGameState(newState, requestingPlayerId || undefined),
      result: {
        winner: result.winner,
        scores: Object.fromEntries(result.allScores),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message === 'Not your turn' ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * Serialize GameState for API response
 * Converts Card objects and other complex types to JSON-serializable format
 */
function serializeGameState(gameState: GameState, viewingPlayerId?: string): any {
  const isLanMode = gameState.mode === 'lan';
  const shouldRevealOwnHand = gameState.phase === 'playing' || gameState.phase === 'ended';
  const joinedPlayerIds = getJoinedPlayerIds(gameState);
  const rematchReadyPlayerIds = getRematchReadyPlayerIds(gameState);
  const roomNotice = getOrCreateSession(gameState.id).roomNotice;
  const playerHands = Object.fromEntries(
    Array.from(gameState.playerHands).map(([playerId, cards]) => {
      if (!isLanMode) {
        return [
          playerId,
          cards.map((card) => ({ suit: card.suit, rank: card.rank })),
        ];
      }

      if (shouldRevealOwnHand && viewingPlayerId && playerId === viewingPlayerId) {
        return [
          playerId,
          cards.map((card) => ({ suit: card.suit, rank: card.rank })),
        ];
      }

      return [playerId, []];
    })
  );

  const playerCardCounts = Object.fromEntries(
    Array.from(gameState.playerHands).map(([playerId, cards]) => [playerId, gameState.phase === 'setup' ? 0 : cards.length])
  );

  return {
    id: gameState.id,
    lobbyCode: gameState.lobbyCode,
    hostPlayerId: gameState.hostPlayerId,
    joinedPlayerIds,
    rematchReadyPlayerIds,
    roomNotice,
    canStartGame: canStartLanGame(gameState, viewingPlayerId),
    canRestartRematch: canRestartLanRematch(gameState),
    mode: gameState.mode,
    phase: gameState.phase,
    turnPhase: gameState.turnPhase,
    players: gameState.players,
    currentPlayerIndex: gameState.currentPlayerIndex,
    dealerIndex: gameState.dealerIndex,
    playerHands,
    playerCardCounts,
    viewerPlayerId: viewingPlayerId || null,
    stockpileCount: gameState.stockpile.length,
    pendingDiscard: gameState.pendingDiscard.length > 0
      ? gameState.pendingDiscard.map(card => ({
          suit: card.suit,
          rank: card.rank,
        }))
      : null,
    // send entire discard pile array so frontend can render all discarded cards
    discardPile: gameState.discardPile.length > 0
      ? gameState.discardPile.map(card => ({ suit: card.suit, rank: card.rank }))
      : [],
    drawnCard: gameState.drawnCard
      ? { suit: gameState.drawnCard.suit, rank: gameState.drawnCard.rank }
      : null,
    winner: gameState.winner,
    finalScores: gameState.finalScores
      ? Object.fromEntries(gameState.finalScores)
      : null,
    dhumbalCalledBy: gameState.dhumbalCalledBy,
    roundNumber: gameState.roundNumber,
    turnCount: gameState.turnCount,
  };
}

export default router;
