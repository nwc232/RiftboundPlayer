import type { GameEvent, Progress } from "./events.js";
import type { CardId, GameState, PlayerId } from "./state.js";

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
  const player = state.players[playerId];

  if (player.scoredThisTurn.includes(battlefieldId)) {
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
    const points = state.players[playerId].points;
    const opponentPoints =
      state.players[playerId === "p1" ? "p2" : "p1"].points;

    if (points >= VICTORY_SCORE && points > opponentPoints) {
      return {
        state: { ...state, winner: playerId },
        events: [{ type: "gameWon", playerId, points }],
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
