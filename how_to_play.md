# How To Play Dhumbal (This Project)

This guide describes how to play the implemented web version in this repository.

## Objective

Get the lowest hand value and call Dhumbal when eligible.

## Supported Modes

- Single Device mode:
  - 2 to 5 players.
  - each seat can be human or bot.
- LAN mode:
  - 2 to 5 players.
  - human-only seats.
  - host creates a lobby and others join via code.

## Setup

1. Start backend.
2. Start frontend.
3. Open the app (default: http://localhost:4200).
4. Choose one of:
   - Single Device
   - Host LAN Game
   - Join LAN Game

Initial game state when a round begins:
- Each player gets 5 cards.
- One card is placed on discard pile.
- Remaining cards form stockpile.
- Dealer starts at player index 0.
- First active turn starts at player index 1 (left of dealer).

## Card Values

- A = 1
- J = 11
- Q = 12
- K = 13
- 2-10 = face value

## Turn Phases

Each turn is split into three phases.

1. waiting_for_action
  - You may call Dhumbal if your score is at or below threshold.
  - Or you discard cards.

2. waiting_for_draw
  - Draw exactly one card from stockpile or discard pile.

3. turn_complete
  - End turn to pass to the next player.

Note:
- The engine always uses turn_complete.
- In UI, Auto End Turn may submit end-turn automatically after draw.

## Discard Rules

You can discard:
- 1 card (any card), or
- a same-rank set of 2 to 4 cards, or
- a same-suit run of 3 to 4 consecutive cards.

Run details:
- Must be same suit.
- Must be consecutive by rank.
- Ace-high runs are allowed (for example, Q-K-A and J-Q-K-A).

Invalid examples:
- Two cards of different ranks.
- Mixed-suit sequences.
- Non-consecutive same-suit cards.

## How To Perform Actions In UI

Discard:
- Click cards to select (up to 4), then click Discard Selected Cards.
- Or drag cards to discard zone/discard pile for quick discard.
- You can also drag one card onto another matching rank card and use Discard Pair.

Draw:
- Click Draw from Stockpile or Draw from Discard.

End turn:
- Click End Turn after draw if Auto End Turn is off.
- If Auto End Turn is on, turn may pass automatically after draw.

Dhumbal:
- Click Call Dhumbal only in waiting_for_action when eligible.

## Dhumbal Eligibility And Winner

- Threshold rule in code: 2 players = 5, 3 players = 10, 4+ players = 15.
- Calling Dhumbal ends the game immediately.
- Winner is the player with the lowest hand score.
- Tie-breaker: Dhumbal caller wins ties.

## LAN-specific Behavior

- Host creates room and shares 6-character lobby code.
- Joiners claim available seats in setup phase.
- Only host can start the lobby game.
- Each client sees only its own hand cards while playing.
- Opponent cards are hidden; only counts are shown.
- After round end, LAN rematch starts when all players are ready.

## Quick Run

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend (default local):

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

## Troubleshooting

- If actions fail, check current turn phase shown in UI.
- If draw is blocked, you likely have not discarded yet.
- If End Turn is unavailable, turn is not complete yet or Auto End Turn is enabled.
- If Call Dhumbal is disabled, your hand is above threshold or you are not in waiting_for_action.
- If LAN join fails, verify host URL, code, and backend availability.