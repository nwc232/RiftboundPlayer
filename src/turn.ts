import { execute } from "./abilities.js";
import { healAllUnits, killUnits } from "./combat.js";
import { expireModifiers, keywordsOf } from "./layers.js";
import type { DelayedTiming } from "./layers.js";
import type { GameEvent, Progress } from "./events.js";
import { checkForWinner, holdControlledBattlefields } from "./scoring.js";
import { runCleanup } from "./showdown.js";
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

/**
 * R816 — Temporary is functionally "At the start of this permanent's
 * controller's Beginning Phase, *before scoring*, kill this." Read through the
 * layers, so a granted Temporary (Mirror Image) counts like a printed one.
 * R816.2 makes multiple instances redundant, which falls out of killing once.
 *
 * The rules make this a triggered ability, which would put it on the chain.
 * It is run directly here instead, because the "before scoring" ordering is
 * what decides whether a Temporary unit gets to Hold a battlefield for a point
 * — getting that wrong changes who wins. Doing both would need the turn's
 * phases on the task queue so the chain can resolve mid-phase.
 */
function beginningStep(progress: Progress, player: PlayerId): Progress {
  const { state } = progress;
  const doomed = permanentsControlledBy(state, player)
    .filter((permanent) => keywordsOf(state, permanent.cardId).includes("temporary"))
    .map((permanent) => permanent.cardId);

  if (doomed.length === 0) return progress;

  const killed = killUnits(state, doomed);
  // R319.6 — objects leaving the board makes a cleanup outstanding, and R334
  // completes it before anything else. That matters here: R323.6 is where a
  // player loses control of a battlefield they no longer occupy, and it has to
  // happen before the Scoring Step or a dead Temporary still Holds for a point.
  const cleaned = runCleanup(killed.state);
  return {
    state: cleaned.state,
    events: [...progress.events, ...killed.events, ...cleaned.events],
  };
}

/** R315.2.b — the turn player Holds every battlefield they control. */
function scoringStep(progress: Progress, player: PlayerId): Progress {
  const held = holdControlledBattlefields(progress.state, player);
  const won = checkForWinner(held.state);
  return {
    state: won.state,
    events: [...progress.events, ...held.events, ...won.events],
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

/**
 * R317.1.a — run everything scheduled for this moment, then drop it. Each
 * delayed effect fires once; its targets were frozen when it was scheduled.
 */
function fireDelayed(progress: Progress, at: DelayedTiming): Progress {
  const due = progress.state.delayed.filter((entry) => entry.at === at);
  if (due.length === 0) return progress;

  let state: GameState = {
    ...progress.state,
    delayed: progress.state.delayed.filter((entry) => entry.at !== at),
  };
  const events: GameEvent[] = [];

  for (const entry of due) {
    const outcome = execute(state, entry.effect, {
      controller: entry.controller,
      sourceId: entry.sourceId,
      targets: entry.targets,
    });
    state = outcome.state;
    events.push(...outcome.events);
  }

  return { state, events: [...progress.events, ...events] };
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
 * Not modelled yet: Burn Out (R431) when the deck runs dry during the Draw Phase.
 */
export function beginTurn(
  state: GameState,
  player: PlayerId,
  number: number,
): Progress {
  // R470 is per turn, so both players' scoring records reset as the turn starts.
  let progress: Progress = {
    state: {
      ...state,
      turn: { player, phase: "awaken", number },
      players: {
        p1: { ...state.players.p1, scoredThisTurn: [] },
        p2: { ...state.players.p2, scoredThisTurn: [] },
      },
    },
    events: [{ type: "turnBegan", playerId: player, turn: number }],
  };

  progress = enterPhase(progress, player, "awaken");
  progress = awaken(progress, player);
  progress = enterPhase(progress, player, "beginning");
  // R315.2.a then R315.2.b — the Beginning Step runs before the Scoring Step.
  progress = beginningStep(progress, player);
  progress = scoringStep(progress, player);
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
 * The Expiration Step's inserted cleanup steps run in R317.2's order: heal all
 * units (3c), expire "this turn" effects (3d), then empty pools (3e).
 */
export function endTurn(state: GameState): Progress {
  const player = state.turn.player;
  let progress: Progress = { state, events: [] };

  progress = enterPhase(progress, player, "ending");

  // R317.1.a — "At the end of the turn Game Effects take place." This is the
  // Ending Step, and it runs before the Expiration Step below.
  progress = fireDelayed(progress, "endOfTurn");

  // R317.2.b — "3c. Heal all Units."
  progress = { ...progress, state: healAllUnits(progress.state) };

  // R317.2.c — "3d. All 'this turn' effects expire simultaneously."
  const expired = expireModifiers(progress.state, "thisTurn");
  if (expired !== progress.state) {
    progress = {
      state: expired,
      events: [
        ...progress.events,
        { type: "modifiersExpired", duration: "thisTurn" },
      ],
    };
  }

  progress = emptyAllPools(progress);

  const next = opponentOf(player);
  return beginTurn(progress.state, next, state.turn.number + 1);
}
