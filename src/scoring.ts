import { cannotScore } from "./restrictions.js";
import { revealFacedown } from "./hidden.js";
import type { GameEvent, Progress } from "./events.js";
import type { CardId, GameState, PlayerId } from "./state.js";
import { seatOf } from "./state.js";

/** R194.3 — 8 by default. Modes of play and card effects can change it. */
export const VICTORY_SCORE = 8;

export type ScoreMethod = "conquer" | "hold";

/**
 * R468–471. A player scores at most once per battlefield per turn (R470).
 *
 * R471.1.b adds a restriction that applies to Conquer only: within 1 point of
 * the Victory Score, conquering gains the final point only if that player has
 * scored *every* battlefield this turn — otherwise they draw instead. Points
 * from other sources, including Hold, are explicitly exempt (R471.1.a.1).
 */
export function score(
  state: GameState,
  playerId: PlayerId,
  battlefieldId: CardId,
  method: ScoreMethod,
): Progress {
  const player = seatOf(state, playerId);

  if (player.scoredThisTurn.includes(battlefieldId)) {
    return { state, events: [] };
  }

  // Tianna Crownguard — "opponents can't score points"; Forgotten Monument —
  // "players can't score here until their third turn". R470's scoring is the
  // consequence of holding, so a forbidden score is a hold that pays nothing
  // rather than a hold that does not happen.
  if (cannotScore(state, playerId, battlefieldId)) {
    return { state, events: [] };
  }

  const scoredThisTurn = [...player.scoredThisTurn, battlefieldId];
  const events: GameEvent[] = [
    { type: "battlefieldScored", playerId, battlefieldId, method },
  ];

  const withinOneOfVictory = player.points >= VICTORY_SCORE - 1;
  const scoredEverything = state.battlefieldOrder.every((id) =>
    scoredThisTurn.includes(id),
  );

  // The final-point restriction: conquer can't close out the game unless you
  // hold the whole board this turn.
  if (method === "conquer" && withinOneOfVictory && !scoredEverything) {
    const [drawnId, ...restOfDeck] = player.mainDeck;
    const drew = drawnId !== undefined;
    if (drew) {
      events.push({ type: "cardDrawn", playerId, cardId: drawnId });
    }
    return {
      state: {
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            scoredThisTurn,
            ...(drew ? { mainDeck: restOfDeck, hand: [...player.hand, drawnId] } : {}),
          },
        },
      },
      events,
    };
  }

  events.push({ type: "pointGained", playerId, points: player.points + 1 });

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...player, points: player.points + 1, scoredThisTurn },
      },
    },
    events,
  };
}

/**
 * R194.2 / R323.1 — checked during a cleanup: at or past the Victory Score, and
 * strictly ahead of every opponent.
 */
export function checkForWinner(state: GameState): Progress {
  if (state.winner !== null) {
    return { state, events: [] };
  }

  for (const playerId of ["p1", "p2"] as const) {
    const points = seatOf(state, playerId).points;
    const opponentPoints =
      seatOf(state, playerId === "p1" ? "p2" : "p1").points;

    if (points >= VICTORY_SCORE && points > opponentPoints) {
      const shown = revealEveryFacedown(state);
      return {
        // R194.2 — setting the winner is the whole of this. Stopping the
        // game is `runTasks` and `awaitDecisions`' business: clearing state
        // here looked like a fix and was not one, because the triggers the
        // winning score itself raised are collected *after* this returns and
        // put a decision straight back.
        //
        // R421.4's other clause is the exception — "or if the game ends, its
        // owner reveals it to all players" — so what is still hidden comes up
        // here, where the game ending is known.
        state: { ...shown.state, winner: playerId },
        events: [{ type: "gameWon", playerId, points }, ...shown.events],
      };
    }
  }

  return { state, events: [] };
}

/** R315.2.b — the turn player Holds every battlefield they control. */
export function holdControlledBattlefields(
  state: GameState,
  playerId: PlayerId,
): Progress {
  let current = state;
  const events: GameEvent[] = [];

  for (const battlefieldId of state.battlefieldOrder) {
    if (current.battlefields[battlefieldId]?.controller !== playerId) continue;
    const held = score(current, playerId, battlefieldId, "hold");
    current = held.state;
    events.push(...held.events);
  }

  return { state: current, events };
}

/**
 * R421.4's second clause — "or if the game ends, its owner reveals it to all
 * players". The one moment Noxus Saboteur's "can't be revealed here" has a
 * visible effect in the current pool: every other reveal it could stop is of
 * a card already on its way to a public zone.
 */
function revealEveryFacedown(state: GameState): Progress {
  let current = state;
  const events: GameEvent[] = [];

  for (const [battlefieldId, entry] of Object.entries(state.facedown)) {
    const shown = revealFacedown(
      current,
      entry.cardId,
      battlefieldId,
      entry.controller,
    );
    current = shown.state;
    events.push(...shown.events);
  }

  return { state: current, events };
}
