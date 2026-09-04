import { execute } from "./abilities.js";
import type { GameEvent, Progress } from "./events.js";
import type { GameState, PlayerId } from "./state.js";
import { seatOf } from "./state.js";
import type { Task } from "./tasks.js";

/**
 * R431 — Burn Out. Not a loss: a player who must draw from an empty Main Deck
 * recycles their trash into it, an opponent gains a point (R431.2.c), and the
 * draw then completes (R431.2.d).
 *
 * R431.2.b says the recycled trash "must be randomized". Deck order is taken as
 * given throughout this engine so games stay reproducible, so the trash is
 * appended in order; a caller wanting randomness shuffles.
 */
export { burnOut };

function burnOut(state: GameState, playerId: PlayerId): Progress {
  const player = seatOf(state, playerId);
  // R431.2.b — the recycle happens whoever ends up with the point.
  const recycled: GameState = {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        mainDeck: [...player.mainDeck, ...player.trash],
        trash: [],
      },
    },
  };
  const burned: GameEvent = { type: "burnedOut", playerId };

  // R431.2.c — "Chooses an opponent to gain 1 point." A Duel offers one
  // answer, so it resolves here rather than stopping the game to ask it.
  const context = {
    controller: playerId,
    // The effect names no card. `PlayerId` is structurally a `CardId`, and
    // this is only ever read back as "whose burn out is this".
    sourceId: playerId,
    targets: [],
  };
  const outcome = execute(recycled, { op: "burnOutPoint" }, context);
  if (outcome.pause === undefined) {
    return { state: outcome.state, events: [burned, ...outcome.events] };
  }

  // More than one opponent, so the choice is real and the queue has to ask
  // it. **Deviation from R431.2's sequence:** the remainder of the draw
  // (R431.2.d) finishes before the question is answered, because a draw is
  // not a task and cannot suspend mid-loop. Written up in the survey.
  const asking: Task = {
    kind: "resumeEffect",
    effect: outcome.pause.resume,
    context: outcome.pause.context,
    decision: outcome.pause.decision,
  };
  return {
    state: { ...outcome.state, tasks: [asking, ...outcome.state.tasks] },
    events: [burned, ...outcome.events],
  };
}

/**
 * Draw `count` cards, burning out (R431.1.a) whenever the deck runs dry
 * mid-draw rather than silently drawing fewer.
 */
export function drawCards(
  state: GameState,
  playerId: PlayerId,
  count: number,
): Progress {
  let current = state;
  const events: GameEvent[] = [];

  for (let i = 0; i < count; i += 1) {
    if (seatOf(current, playerId).mainDeck.length === 0) {
      const burned = burnOut(current, playerId);
      current = burned.state;
      events.push(...burned.events);
      // R431.2.d completes the draw afterwards — but only if the recycled
      // trash gave them anything to draw.
      if (seatOf(current, playerId).mainDeck.length === 0) break;
    }

    const player = seatOf(current, playerId);
    const [drawnId, ...rest] = player.mainDeck;
    if (drawnId === undefined) break;

    current = {
      ...current,
      players: {
        ...current.players,
        [playerId]: { ...player, mainDeck: rest, hand: [...player.hand, drawnId] },
      },
    };
    events.push({ type: "cardDrawn", playerId, cardId: drawnId });
  }

  return { state: current, events };
}
