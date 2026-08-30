import type { GameEvent } from "./events.js";
import type { CardId, CardInstance, GameState, PlayerId } from "./state.js";

/**
 * R107 — what one player is allowed to see.
 *
 * The engine's `GameState` is the whole truth, which is right for a rules
 * engine and wrong for a screen. This filters it down to one player's view, so
 * that hidden information is hidden *by the engine* rather than by a renderer
 * politely looking away. That distinction is the whole point: a client that
 * never receives a card's identity cannot leak it, however it is written.
 *
 * Four zones are private, and each for its own reason:
 *
 * - **Hands** (R107.1.b) — the opponent's, not your own.
 * - **Main Decks and Rune Decks** (R107.2) — *both* players', including your
 *   own: you know what you put in it, never the order it came out in.
 * - **Facedown Zones** (R107.3.f) — the zone is public and its occupancy is
 *   public, but the card in it is not. Only the opponent's.
 *
 * Everything else — the board, trashes, banishment, points, XP, rune pools,
 * the Legend and Champion Zones — is public and passes through untouched.
 */

/** The stand-in a hidden card is replaced by. Stable per zone and position. */
export const HIDDEN_CARD = "hidden";

/** Whether an id is a stand-in rather than a real card. */
export function isHiddenCard(cardId: CardId): boolean {
  return cardId === HIDDEN_CARD || cardId.startsWith(`${HIDDEN_CARD}:`);
}

function hiddenId(zone: string, index: number): CardId {
  return `${HIDDEN_CARD}:${zone}:${index}`;
}

/**
 * A blank card the viewer can be told about without learning anything. Typed
 * as a unit because something has to render it; nothing reads its
 * characteristics, because it is never on the board.
 */
function blank(id: CardId): CardInstance {
  return {
    id,
    name: "hidden card",
    type: "unit",
    cost: { energy: 0, power: {}, anyPower: 0 },
    keywords: [],
    abilities: [],
  };
}

/** Replaces a list of card ids with stand-ins, keeping its length. */
function conceal(ids: CardId[], zone: string): CardId[] {
  return ids.map((_, index) => hiddenId(zone, index));
}

/**
 * `state` as `viewer` is entitled to see it. The result is a real `GameState`,
 * so everything that reads one — the renderer, `legalActions` for this player,
 * the event log — works against it unchanged.
 */
export function viewOf(state: GameState, viewer: PlayerId): GameState {
  const opponent: PlayerId = viewer === "p1" ? "p2" : "p1";
  const revealed = new Set<CardId>();
  const blanks: Record<CardId, CardInstance> = {};

  const players = { ...state.players };
  for (const id of ["p1", "p2"] as PlayerId[]) {
    const player = state.players[id];
    // R107.2 — a deck's order is private to everyone, its owner included.
    const mainDeck = conceal(player.mainDeck, `${id}-deck`);
    const runeDeck = conceal(player.runeDeck, `${id}-runes`);
    // R107.1.b — a hand is private to its holder.
    const hand =
      id === viewer ? player.hand : conceal(player.hand, `${id}-hand`);

    for (const hiddenCard of [...mainDeck, ...runeDeck, ...hand]) {
      if (hiddenCard.startsWith(`${HIDDEN_CARD}:`)) {
        blanks[hiddenCard] = blank(hiddenCard);
      }
    }
    players[id] = { ...player, mainDeck, runeDeck, hand };
  }

  // R107.3.f — "Facedown Zones are Public Zones", so the fact that a card is
  // there is known; which card it is is not. The zone is keyed by battlefield,
  // so replacing the id leaves the occupancy visible, which is the point.
  const facedown: GameState["facedown"] = {};
  for (const [battlefieldId, entry] of Object.entries(state.facedown)) {
    if (entry.controller === viewer) {
      facedown[battlefieldId] = entry;
      continue;
    }
    const stand = hiddenId("facedown", 0) + `:${battlefieldId}`;
    blanks[stand] = blank(stand);
    facedown[battlefieldId] = { ...entry, cardId: stand };
  }

  // Every card still named anywhere the viewer can see keeps its real entry;
  // the rest are dropped, so the definition never reaches the client at all.
  for (const player of Object.values(players)) {
    for (const cardId of [
      ...player.hand,
      ...player.trash,
      ...player.banished,
      ...player.runes,
      ...player.scoredThisTurn,
      ...(player.legend === null ? [] : [player.legend]),
      ...(player.champion === null ? [] : [player.champion]),
    ]) {
      revealed.add(cardId);
    }
  }
  for (const cardId of Object.keys(state.permanents)) revealed.add(cardId);
  for (const cardId of state.battlefieldOrder) revealed.add(cardId);
  for (const item of state.chain) {
    revealed.add(item.kind === "spell" ? item.cardId : item.sourceId);
  }
  for (const entry of Object.values(facedown)) revealed.add(entry.cardId);

  const cards: Record<CardId, CardInstance> = { ...blanks };
  for (const cardId of revealed) {
    const card = state.cards[cardId];
    if (card !== undefined) cards[cardId] = card;
  }

  // R320.1's outstanding decision, if it is the opponent's — its options can
  // come straight out of a private zone.
  const pending = pendingFor(state, viewer);
  if (pending !== null && pending !== state.pending && "legal" in pending.prompt) {
    for (const stand of pending.prompt.legal) {
      if (typeof stand === "string") blanks[stand] = blank(stand);
    }
  }

  return { ...state, players, facedown, cards: { ...cards, ...blanks }, pending };
}

/**
 * R320.1 — an outstanding decision belongs to one player, and only that player
 * may answer it. The *fact* that they are choosing is public; what they are
 * choosing between need not be, and for a Mulligan or a Predict it is drawn
 * straight out of a private zone.
 *
 * Redacted wholesale rather than per prompt kind. `legalActions` already
 * returns nothing to a player who does not hold the decision, so the list is
 * of no use to them — and an allowlist of "prompts whose options are private"
 * is a list that goes stale the next time a prompt is added.
 */
function pendingFor(
  state: GameState,
  viewer: PlayerId,
): GameState["pending"] {
  const pending = state.pending;
  if (pending === null || pending.player === viewer) return pending;

  const { prompt } = pending;
  if (!("legal" in prompt)) return pending;
  // `chooseMode`'s options are arm indices off a card already on the chain,
  // not objects out of a zone, so there is nothing in it to withhold.
  if (prompt.kind === "chooseMode") return pending;

  return {
    ...pending,
    prompt: {
      ...prompt,
      // The count survives: "they are choosing among three" gives nothing away
      // and is what a UI needs in order to render the wait.
      legal: prompt.legal.map((_, index) => hiddenId("pending", index)),
    },
  };
}

/**
 * R107 — the event stream as `viewer` is entitled to see it.
 *
 * `viewOf` closes the state half and this closes the other, because a card's
 * identity travels through both. Three events name a card while it is in, or
 * on its way into, a private zone:
 *
 * - **`cardDrawn`** (R107.2) — Main Deck to hand, private at both ends.
 * - **`cardHidden`** (R107.3.f) — hand to a Facedown Zone, whose occupancy is
 *   public and whose contents are not.
 * - **`cardRecycled`** (R416.1) — to the bottom of a Main Deck, from a hand or
 *   from a Predict's look at the top. Private wherever it came from.
 *
 * Everything else names a card that is already public by the time it is
 * logged: a discard and a burn both land in a trash, and a play lands on the
 * chain.
 */
export function eventsFor(
  events: readonly GameEvent[],
  viewer: PlayerId,
): GameEvent[] {
  return events.map((event) => {
    switch (event.type) {
      case "cardDrawn":
      case "cardHidden":
      case "cardRecycled":
        // R107 draws the line at the owner, so the owner's own log is intact.
        return event.playerId === viewer
          ? event
          : { ...event, cardId: HIDDEN_CARD };
      default:
        return event;
    }
  });
}
