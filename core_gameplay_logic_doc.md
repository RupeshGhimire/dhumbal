# Core Gameplay Logic: Implemented Specification

This document reflects the actual game logic currently implemented in the backend and used by the frontend.

## Scope

- Single-round game with rematch support.
- 2 to 5 players.
- Two modes:
    - local (single device, human and bot seats)
    - lan (human-only lobby flow)
- In-memory game storage.

## Data Model Summary

The game state tracks:

- phase: setup | playing | ended
- turnPhase: waiting_for_action | waiting_for_draw | turn_complete
- mode: local | lan
- lobbyCode, hostPlayerId
- players, currentPlayerIndex, dealerIndex
- playerHands map
- stockpile and discardPile
- pendingDiscard (buffer used between discard and draw)
- drawnCard (last drawn card for current player)
- winner, finalScores, dhumbalCalledBy
- roundNumber and turnCount

## Setup Rules

1. Validate player count is 2 to 5.
2. Create and shuffle a 52-card deck.
3. Deal 5 cards to each player.
4. Initialize stockpile from remaining cards.
5. Move one card to discard pile.
6. Set dealerIndex = 0.
7. Set currentPlayerIndex = 1 (player to the left of dealer).
8. Set turnPhase = waiting_for_action.
9. Mode-specific phase:
    - local create: phase = playing
    - lan create: phase = setup (host must start game)

Expected initial counts for N players:
- 5N cards in hands total
- 1 card in discard pile
- 52 - (5N + 1) cards in stockpile

## Card Values

- A = 1
- J = 11
- Q = 12
- K = 13
- 2-10 = face value

Hand score is the sum of card values in that player's hand.

## Dhumbal Threshold

Threshold function in valuation service:
- 2 players: 5
- 3 players: 10
- 4+ players: 15

Dhumbal threshold always depends on player count.

## Turn State Machine

### State: waiting_for_action

Allowed actions:
- Discard cards
- Call Dhumbal

Blocked actions:
- Draw
- End Turn

### State: waiting_for_draw

Allowed actions:
- Draw exactly one card from stockpile or discard pile

Blocked actions:
- Discard
- Call Dhumbal
- End Turn

### State: turn_complete

Allowed actions:
- End Turn

Blocked actions:
- Discard
- Draw
- Call Dhumbal

### Transitions

1. waiting_for_action --discard--> waiting_for_draw
2. waiting_for_draw --draw--> turn_complete
3. turn_complete --end-turn--> waiting_for_action (next player)
4. waiting_for_action --dhumbal--> ended

## Discard Validation Rules

Discard input is cardIndices from current player's hand.

Validation:
- Must discard 1 to 4 cards.
- Indices must be valid and unique.

If discarding 1 card:
- Always valid.

If discarding 2 to 4 cards:
- Must satisfy one of:
    - Same-rank set:
        - 2, 3, or 4 cards
        - all cards share same rank
    - Same-suit sequence:
        - 3 or 4 cards
        - all cards same suit
        - consecutive ranks
        - Ace-high conversion allowed so Q-K-A and J-Q-K-A are valid

Processing behavior:
- Selected cards are removed from hand.
- Removed cards are stored in pendingDiscard.
- turnPhase becomes waiting_for_draw.
- Cards are not pushed to discardPile yet.

## Draw Rules

Draw is only valid in waiting_for_draw.

Source options:
- stockpile
- discard

Validation:
- Chosen source must contain at least one card.

Processing:
- Draw one card from selected source and add to current player's hand.
- Set drawnCard to that card.
- Increment turnCount.
- Move pendingDiscard cards to discardPile, then clear pendingDiscard.
- Set turnPhase to turn_complete.

Reshuffle rule:
- If stockpile is empty and discard pile has more than 1 card,
    - keep top discard card in discard pile,
    - shuffle the rest into stockpile.

## End Turn Rules

End Turn is only valid in turn_complete.

Processing:
- Advance currentPlayerIndex to next player.
- Set turnPhase to waiting_for_action.
- Clear drawnCard.

## Dhumbal Call Rules

Dhumbal is only valid in waiting_for_action.

Validation:
- Current player's hand score must be <= threshold for current player count.

On success:
- Compute all player hand scores.
- Winner is lowest score.
- If tie includes caller, caller wins tie-break.
- Set phase to ended.
- Persist winner, finalScores, dhumbalCalledBy.

## Bot Turn Behavior (Local Mode)

- Endpoint: POST /api/games/:gameId/execute-bot-turn
- Allowed only when:
    - mode is local
    - game phase is playing
    - current player is bot
- Bot executes one legal step per call based on turn phase:
    - waiting_for_action:
        - call Dhumbal if eligible, else discard best candidate
    - waiting_for_draw:
        - choose draw source using heuristic (prefer low visible discard top)
    - turn_complete:
        - end turn
- LAN mode rejects bot execution.

## LAN Lobby and Session Rules

Creation:
- LAN lobby is created with mode=lan, playerCount (2-5), hostName.
- Backend creates placeholder player names and assigns host seat.
- phase starts as setup.
- lobbyCode is generated (6 chars, restricted alphabet).

Join:
- Joiners claim unclaimed non-bot seats during setup.
- Join requires playerName.

Start:
- Only host can start.
- Game can start only when all seats are claimed.
- Start transitions phase setup -> playing.

Auth and turn ownership:
- LAN endpoints use bearer token from create/join response.
- Action endpoints validate current-player turn ownership.

Presence:
- Session tracks last-seen per player.
- Inactivity timeout is 20 seconds.
- If players time out/leave during play, round ends and room notice is emitted.

Rematch:
- After ended phase, LAN players set rematch-ready.
- When all players are ready, restart occurs automatically.
- Restart rotates dealer, redeals cards, resets turn metadata.

Room teardown:
- Players can leave room.
- Host can close room.
- Empty rooms are removed from in-memory maps.

## API-Level Behavior Notes

- Endpoints return serialized game state (maps converted to plain objects).
- discardPile is sent as full array to frontend.
- pendingDiscard is serialized for client visibility.
- Games are stored in memory map and lost on server restart.

Serialization in LAN mode:
- viewer sees own hand cards while playing/ended.
- other players' hand arrays are hidden.
- playerCardCounts is included for all players.
- joinedPlayerIds, rematchReadyPlayerIds, canStartGame, canRestartRematch, roomNotice are included.

## Frontend Interaction Notes

- Frontend polls game state (faster during active board interactions).
- Local hot-seat style: active hand and controls are shown for current turn.
- LAN mode shows only self cards; opponents are hidden.
- Discard can be triggered by click-select or drag-drop.
- Turn passes after end-turn call; frontend may auto-send end-turn when Auto End Turn is enabled.

## Differences From Simplified Traditional Summaries

The implemented game is intentionally stricter/more explicit in state handling than many informal rulesheets:

- Uses mandatory End Turn step after drawing.
- Supports richer discard groups (up to 4 cards, including valid runs).
- Uses caller-wins tie-breaker in Dhumbal resolution.

