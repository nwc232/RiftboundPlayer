import type { GameEvent } from "./events.js";
import { permanentsControlledBy } from "./state.js";
import type { GameState, PlayerId } from "./state.js";

/** R314–317. Awaken through Draw run as automatic tasks; Main waits for the player. */
export type Phase =
  | "awaken"
  | "beginning"
  | "channel"
  | "draw"
  | "main"
  | "ending";

export interface TurnState {
  player: PlayerId;
  phase: Phase;
  number: number;
}

export function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

interface Progress {
  state: GameState;
  events: GameEvent[];
}

function enterPhase(
  progress: Progress,
  player: PlayerId,
  phase: Phase,
): Progress {
  return {
    state: { ...progress.state, turn: { ...progress.state.turn, phase } },
    events: [...progress.events, { type: "phaseBegan", playerId: player, phase }],
  };
}

/** R315.1 — the turn player readies every game object they control. */
function awaken(progress: Progress, player: PlayerId): Progress {
  const { state } = progress;
  const playerState = state.players[player];
  const events: GameEvent[] = [];

  const runes = { ...state.runes };
  for (const runeId of playerState.runes) {
    const rune = runes[runeId];
    if (rune !== undefined && rune.exhausted) {
      runes[runeId] = { ...rune, exhausted: false };
      events.push({ type: "objectReadied", playerId: player, cardId: runeId });
    }
  }

  const permanents = { ...state.permanents };
  for (const permanent of permanentsControlledBy(state, player)) {
    if (permanent.exhausted) {
      permanents[permanent.cardId] = { ...permanent, exhausted: false };
      events.push({
        type: "objectReadied",
        playerId: player,
        cardId: permanent.cardId,
      });
    }
  }

  return {
    state: { ...state, runes, permanents },
    events: [...progress.events, ...events],
  };
}

/** R315.3 — the turn player channels 2 runes, or as many as remain. */
function channelTwo(progress: Progress, player: PlayerId): Progress {
  let { state } = progress;
  const events: GameEvent[] = [];

  for (let i = 0; i < 2; i += 1) {
    const playerState = state.players[player];
    const [runeId, ...rest] = playerState.runeDeck;
    if (runeId === undefined) break;

    const card = state.cards[runeId];
    if (card?.domain === undefined) break;

    state = {
      ...state,
      players: {
        ...state.players,
        [player]: { ...playerState, runeDeck: rest, runes: [...playerState.runes, runeId] },
      },
      runes: {
        ...state.runes,
        [runeId]: { cardId: runeId, domain: card.domain, exhausted: false },
      },
    };
    events.push({ type: "runeChanneled", playerId: player, cardId: runeId });
  }

  return { state, events: [...progress.events, ...events] };
}

/** R315.4 — the turn player draws 1. Burn Out (R431) is not modelled yet. */
function drawOne(progress: Progress, player: PlayerId): Progress {
  const { state } = progress;
  const playerState = state.players[player];
  const [drawnId, ...rest] = playerState.mainDeck;
  if (drawnId === undefined) {
    return progress;
  }

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [player]: { ...playerState, mainDeck: rest, hand: [...playerState.hand, drawnId] },
      },
    },
    events: [
      ...progress.events,
      { type: "cardDrawn", playerId: player, cardId: drawnId },
    ],
  };
}

/** R316.3 and R317.2.e — every player's pool empties, not just the turn player's. */
function emptyAllPools(progress: Progress): Progress {
  const { state } = progress;
  const events: GameEvent[] = [];
  const players = { ...state.players };

  for (const id of ["p1", "p2"] as const) {
    if (players[id].runePool.buckets.length > 0) {
      players[id] = { ...players[id], runePool: { buckets: [] } };
      events.push({ type: "poolEmptied", playerId: id });
    }
  }

  return { state: { ...state, players }, events: [...progress.events, ...events] };
}

/**
 * Runs Awaken through Draw, leaving the turn in its Main Phase.
 *
 * Not modelled yet: the Scoring Step (R315.2.b) needs battlefields, and Burn
 * Out (R431) needs to happen when the deck runs dry during the Draw Phase.
 */
export function beginTurn(
  state: GameState,
  player: PlayerId,
  number: number,
): Progress {
  let progress: Progress = {
    state: { ...state, turn: { player, phase: "awaken", number } },
    events: [{ type: "turnBegan", playerId: player, turn: number }],
  };

  progress = enterPhase(progress, player, "awaken");
  progress = awaken(progress, player);
  progress = enterPhase(progress, player, "beginning");
  progress = enterPhase(progress, player, "channel");
  progress = channelTwo(progress, player);
  progress = enterPhase(progress, player, "draw");
  progress = drawOne(progress, player);
  progress = enterPhase(progress, player, "main");
  progress = emptyAllPools(progress);

  return progress;
}

/**
 * Runs the Ending Phase and hands the turn to the next player.
 *
 * Not modelled yet: healing all units and expiring "this turn" effects
 * (R317.2.b–c), both of which need damage and durations to exist first.
 */
export function endTurn(state: GameState): Progress {
  const player = state.turn.player;
  let progress: Progress = { state, events: [] };

  progress = enterPhase(progress, player, "ending");
  progress = emptyAllPools(progress);

  const next = opponentOf(player);
  return beginTurn(progress.state, next, state.turn.number + 1);
}
