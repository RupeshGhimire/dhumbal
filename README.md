# Dhumbal: Web Implementation

Dhumbal is a web-based implementation of the Nepalese card game Dhumbal (Jhyap), built with Angular (frontend) and Node.js/Express + TypeScript (backend).

The project supports:
- Local mode (single device): 2 to 5 players, with optional bot players.
- LAN mode: 2 to 5 human players with lobby creation, join codes, and seat claiming.

## What Is Implemented

- Standard 52-card deck, shuffled each game.
- Initial deal: 5 cards per player.
- Dealer rotation across rematches.
- Turn state machine with explicit phases:
  - waiting_for_action
  - waiting_for_draw
  - turn_complete
- Optional Dhumbal call at start of turn (waiting_for_action only).
- Discard validation rules:
  - Single-card discard is always allowed.
  - Multi-card discard supports:
    - same-rank sets of 2 to 4 cards
    - same-suit runs of 3 to 4 cards (including Ace-high runs like Q-K-A and J-Q-K-A)
- Draw from stockpile or discard pile after discard.
- End turn after draw (manual in engine, with optional frontend auto-end-turn convenience).
- Win evaluation on Dhumbal call:
  - lowest hand value wins
  - tie-breaker: Dhumbal caller wins ties
- Local bot turn execution endpoint.
- LAN lobby lifecycle:
  - create lobby
  - join by lobby code
  - host starts game
  - rematch ready flow
  - explicit leave/close room
- Presence handling in LAN lobbies (inactive players time out and room notices are emitted).
- In-memory game storage (no database persistence).

## Card Values

- A = 1
- J = 11
- Q = 12
- K = 13
- 2-10 = face value

## Turn Flow

1. waiting_for_action
   - Current player can call Dhumbal (if eligible), or discard cards.
2. waiting_for_draw
   - Current player draws one card from stockpile or discard pile.
3. turn_complete
   - Current player ends turn.

Notes:
- Discarded cards are kept in a pending buffer until draw resolves, then moved onto discard pile.
- If stockpile becomes empty and discard pile has more than one card, discard pile (except top card) is reshuffled into stockpile.

## Frontend Notes

- Single-device mode supports human and bot seats.
- LAN mode supports human players only.
- Default names are auto-filled for blank names in local mode.
- Polling keeps state in sync.
- Discard supports click-select and drag-and-drop.
- Auto End Turn option can automatically end turn after drawing.
- In LAN mode, each client only sees its own hand cards; opponents are represented by card counts.

## API Endpoints

Base path: /api/games

Core game endpoints:
- POST /
- GET /:gameId
- POST /:gameId/discard
- POST /:gameId/draw
- POST /:gameId/end-turn
- POST /:gameId/dhumbal
- POST /:gameId/restart

LAN lobby endpoints:
- GET /lobbies
- POST /:gameId/join
- POST /:gameId/start
- POST /:gameId/rematch-ready
- POST /:gameId/leave
- DELETE /:gameId

Bot endpoint (local mode only):
- POST /:gameId/execute-bot-turn

LAN requests that act as a player require Authorization: Bearer <token> from join/create response.

## Project Structure

```
dhumbal/
├── backend/
│   ├── src/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── __tests__/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   └── app/
│   │       ├── components/
│   │       ├── models/
│   │       └── services/
│   ├── package.json
│   └── angular.json
├── how_to_play.md
└── core_gameplay_logic_doc.md
```

## Local Development

Prerequisites:
- Node.js 16+
- npm

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend (local):

```bash
cd frontend
npm install
npm start
```

Frontend (LAN host-ready):

```bash
cd frontend
npm run start:lan
```

Default URLs:
- Frontend: http://localhost:4200
- Backend API: http://localhost:3001
- Health: http://localhost:3001/health

Frontend uses proxy.conf.json to forward /api calls to backend.

## Test Commands

Backend tests:

```bash
cd backend
npm test
```

Frontend tests:

```bash
cd frontend
npm test
```

## Additional Docs

- Player and interaction guide: [how_to_play.md](how_to_play.md)
- Engine/state-machine details: [core_gameplay_logic_doc.md](core_gameplay_logic_doc.md)

## License

MIT
