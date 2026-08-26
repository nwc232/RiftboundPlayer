import { execute } from "./abilities.js";
import { healAllUnits } from "./combat.js";
import { drawCards } from "./draw.js";
import { expireModifiers } from "./layers.js";
import type { DelayedTiming } from "./layers.js";
import type { GameEvent, Progress } from "./events.js";
import { checkForWinner, holdControlledBattlefields } from "./scoring.js";
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

/**
 * A phase begins once, even though several steps belong to it — R315.2's
 * Beginning Phase holds both the Beginning Step and the Scoring Step.
 */
function enterPhase(
  progress: Progress,
  player: PlayerId,
  phase: Phase,
): Progress {
  if (progress.state.turn.phase === phase) return progress;
  return {
    state: { ...progress.state, turn: { ...progress.state.turn, phase } },
    events: [...progress.events, { type: "phaseBegan", playerId: player, phase }],
  };
}

/** R423.1.a.2 — every Stunned unit loses the status in the Expiration Step. */
function clearStuns(state: GameState): GameState {
  const permanents: Record<string, (typeof state.permanents)[string]> = {};
  for (const [cardId, permanent] of Object.entries(state.permanents)) {
    const { stunned: _cleared, ...rest } = permanent;
    permanents[cardId] = rest;
  }
  return { ...state, permanents };
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

  // R107.4.c — the Champion Legend is a Game Object too, so it readies here
  // along with everything else its controller has exhausted.
  const players = { ...state.players };
  if (playerState.legendExhausted === true) {
    players[player] = { ...playerState, legendExhausted: false };
    if (playerState.legend !== null) {
      events.push({
        type: "objectReadied",
        playerId: player,
        cardId: playerState.legend,
      });
    }
  }

  return {
    state: { ...state, runes, permanents, players },
    events: [...progress.events, ...events],
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

/**
 * R315.3 — the turn player channels 2 runes, or as many as remain.
 *
 * R485.7 is the 1v1 First Turn Process: "the player going second channels an
 * extra Rune from their Rune Deck during their first Channel Phase of the
 * game" — their first Channel Phase being turn 2.
 */
function channelTwo(progress: Progress, player: PlayerId, number: number): Progress {
  let { state } = progress;
  const events: GameEvent[] = [];
  const count =
    number === 2 && player !== state.startingPlayer ? 3 : 2;

  for (let i = 0; i < count; i += 1) {
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

/** R315.4 — the turn player draws 1, burning out if the deck is dry (R431). */
function drawOne(progress: Progress, player: PlayerId): Progress {
  const drawn = drawCards(progress.state, player, 1);
  return { state: drawn.state, events: [...progress.events, ...drawn.events] };
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
 * R314-317 in order. Each is one entry on the outstanding-task queue rather
 * than a line in a single function, because R335 only lets the game "proceed
 * to the next substep, step, phase, or turn" once there are no outstanding
 * tasks *and no pending chain items*. A trigger raised during one step
 * therefore has to resolve before the next step runs.
 */
export type TurnStep =
  | "awaken"
  | "beginning"
  | "scoring"
  | "channel"
  | "draw"
  | "main"
  | "ending"
  | "expiration"
  | "handover";

/** Which phase each step belongs to, for the phase marker on the state. */
const STEP_PHASE: Record<TurnStep, Phase> = {
  awaken: "awaken",
  beginning: "beginning",
  scoring: "beginning",
  channel: "channel",
  draw: "draw",
  main: "main",
  ending: "ending",
  expiration: "ending",
  handover: "ending",
};

export interface NextStep {
  player: PlayerId;
  step: TurnStep;
  number: number;
}

export interface TurnStepOutcome {
  state: GameState;
  events: GameEvent[];
  /** The step to run next, or null when the game waits for the player. */
  next: NextStep | null;
}

/** R470 is per turn, so both players' scoring records reset as it starts. */
export function openTurn(
  state: GameState,
  player: PlayerId,
  number: number,
): Progress {
  return {
    state: {
      ...state,
      // The phase is left alone; the Awaken step sets it, so its phaseBegan
      // event still fires.
      turn: { ...state.turn, player, number },
      players: {
        p1: { ...state.players.p1, scoredThisTurn: [] },
        p2: { ...state.players.p2, scoredThisTurn: [] },
      },
      // R812.1.c's "on the same turn" — both players' lists, since a card can
      // be finalized on an opponent's turn with [Reaction] timing.
      playedThisTurn: { p1: [], p2: [] },
      // R383.3.e.1 — "each turn" counts reset with the turn.
      triggeredThisTurn: {},
    },
    events: [{ type: "turnBegan", playerId: player, turn: number }],
  };
}

export function runTurnStep(
  state: GameState,
  player: PlayerId,
  step: TurnStep,
  number: number,
): TurnStepOutcome {
  let progress: Progress = { state, events: [] };
  progress = enterPhase(progress, player, STEP_PHASE[step]);

  const at = (next: TurnStep): NextStep => ({ player, step: next, number });

  switch (step) {
    case "awaken":
      return { ...awaken(progress, player), next: at("beginning") };

    // R315.2.a.1 — "at the start of Beginning Phase game effects take place".
    // [Temporary] triggers here (R816.1.c); R335 then holds the Scoring Step
    // until that trigger has resolved, which is what stops a Temporary unit
    // Holding a battlefield for a point on the way out.
    case "beginning":
      return { ...progress, next: at("scoring") };

    case "scoring":
      return { ...scoringStep(progress, player), next: at("channel") };

    case "channel":
      return { ...channelTwo(progress, player, number), next: at("draw") };

    case "draw":
      return { ...drawOne(progress, player), next: at("main") };

    // R316 — the Main Phase is where the turn player acts, so the queue stops.
    case "main":
      return { ...emptyAllPools(progress), next: null };

    // R317.1 — the Ending Step, which runs before the Expiration Step.
    case "ending":
      return { ...fireDelayed(progress, "endOfTurn"), next: at("expiration") };

    case "expiration": {
      // R317.2.b, then R317.2.c, then R317.2.e, in that order.
      progress = { ...progress, state: healAllUnits(progress.state) };
      // R423.1.a.2 — Stunned is lost "during step 3d", alongside the "this
      // turn" effects that expire there.
      progress = { ...progress, state: clearStuns(progress.state) };
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
      return { ...emptyAllPools(progress), next: at("handover") };
    }

    // R317.3 — the next player with their turn queued becomes the Turn Player.
    case "handover": {
      const next = opponentOf(player);
      const opened = openTurn(progress.state, next, number + 1);
      return {
        state: opened.state,
        events: [...progress.events, ...opened.events],
        next: { player: next, step: "awaken", number: number + 1 },
      };
    }

    default: {
      const unhandled: never = step;
      return { state: progress.state, events: progress.events, next: null };
    }
  }
}
