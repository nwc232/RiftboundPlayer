import type { GameEvent, Progress } from "./events.js";
import type { GameState, PlayerId } from "./state.js";

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
  const player = state.players[playerId];
  const opponent: PlayerId = playerId === "p1" ? "p2" : "p1";
  const other = state.players[opponent];

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          mainDeck: [...player.mainDeck, ...player.trash],
          trash: [],
        },
        [opponent]: { ...other, points: other.points + 1 },
      },
    },
    events: [
      { type: "burnedOut", playerId },
      { type: "pointGained", playerId: opponent, points: 1 },
    ],
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
    if (current.players[playerId].mainDeck.length === 0) {
      const burned = burnOut(current, playerId);
      current = burned.state;
      events.push(...burned.events);
      // R431.2.d completes the draw afterwards — but only if the recycled
      // trash gave them anything to draw.
      if (current.players[playerId].mainDeck.length === 0) break;
    }

    const player = current.players[playerId];
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
