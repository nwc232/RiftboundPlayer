import type { GameEvent } from "./events.js";
import type { GameState, PlayerId } from "./state.js";
import { seatOf } from "./state.js";

/**
 * R430 — Channel.
 *
 * "Channeling is the action of taking one or more Runes from the top of a
 * player's Rune Deck and putting them on the board" (R430.1). It happens in
 * two quite different places, which is why it lives here rather than inside
 * the turn: R430.4.a is the Channel Phase's two, and R430.4.b is "Players may
 * also Channel runes when Game Effects direct them to do so" — which is
 * twenty-two cards in the printed pool, and was the single largest gap in the
 * engine's vocabulary.
 *
 * R430.2.a — "By default, runes are channeled readied", and R430.2's example
 * is a spell reading "Channel 1 rune exhausted", so the state a rune enters in
 * belongs to the instruction rather than to the action.
 */
export interface Channelled {
  state: GameState;
  events: GameEvent[];
  /**
   * How many actually arrived. R430.3 — "If there aren't sufficient runes in
   * the Rune Deck, channel as many as possible" — so this can be short of what
   * was asked, and several cards turn on exactly that: "Channel 2 runes
   * exhausted. If you couldn't channel 2 runes this way, draw 1."
   */
  channelled: number;
}

export function channelRunes(
  state: GameState,
  playerId: PlayerId,
  count: number,
  exhausted = false,
): Channelled {
  const events: GameEvent[] = [];
  let current = state;
  let channelled = 0;

  for (let i = 0; i < count; i += 1) {
    const player = seatOf(current, playerId);
    const [runeId, ...rest] = player.runeDeck;
    // R430.3 — as many as possible, then stop. Not an error, and not a Burn
    // Out either: R431 is about the *Main* Deck.
    if (runeId === undefined) break;

    const card = current.cards[runeId];
    if (card?.domain === undefined) break;

    current = {
      ...current,
      players: {
        ...current.players,
        [playerId]: {
          ...player,
          runeDeck: rest,
          runes: [...player.runes, runeId],
        },
      },
      runes: {
        ...current.runes,
        [runeId]: { cardId: runeId, domain: card.domain, exhausted },
      },
    };
    events.push({ type: "runeChanneled", playerId, cardId: runeId });
    channelled += 1;
  }

  return { state: current, events, channelled };
}
