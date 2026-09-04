import { enqueue, runTasks } from "./tasks.js";
import { openTurn } from "./turn.js";
import type { CardId, CardInstance, GameState, PlayerId } from "./state.js";
import { modeById, modeFor } from "./modes-of-play.js";
import type { ModeId } from "./modes-of-play.js";

/**
 * R103 — what a player must bring. The Chosen Champion is counted within the
 * Main Deck's 40 (R103.2) but starts in the Champion Zone (R103.2.a.1), and
 * R485.4.a has each player bring three battlefields of which only one is used.
 */
export interface Deck {
  legend: CardId;
  champion: CardId;
  /** At least 40 including the champion (R103.2). */
  mainDeck: CardId[];
  /** Exactly 12 (R103.3.a). */
  runeDeck: CardId[];
  /** Three, of which setup picks one (R485.4.a). */
  battlefields: CardId[];
}

export type DeckError =
  | "legendNotALegend"
  | "championNotInMainDeck"
  | "championTagMismatch"
  | "championNotAChampionUnit"
  | "tooManySignatureCards"
  | "signatureTagMismatch"
  | "mainDeckTooSmall"
  | "tooManyCopies"
  | "tooManyUniqueCopies"
  | "wrongRuneCount"
  | "notARune"
  | "wrongBattlefieldCount"
  | "duplicateBattlefieldName"
  | "unknownCard"
  /** R115.1 — a seat in the turn order that nobody brought a deck to. */
  | "seatWithoutDeck"
  /** R483.4 — the wrong number of battlefields presented for this mode. */
  | "wrongBattlefieldsInPlay";

export const MAIN_DECK_MINIMUM = 40;
export const RUNE_DECK_SIZE = 12;
export const BATTLEFIELDS_PER_DECK = 3;
export const MAX_COPIES = 3;
/** R103.2.d.1 — "a sum total of 3 Signature cards", regardless of name. */
export const MAX_SIGNATURE_CARDS = 3;
/** R116 — "Players each draw 4." */
export const OPENING_HAND = 4;

/**
 * R103's countable requirements. Domain Identity (R103.1.b) is *not* checked;
 * everything else in R103.2 is, including both halves of R103.2.a.2 and all of
 * R103.2.d's Signature-card limits.
 */
export function validateDeck(
  deck: Deck,
  cards: Record<CardId, CardInstance>,
): DeckError[] {
  const errors: DeckError[] = [];
  const nameOf = (id: CardId) => cards[id]?.name;

  const everyId = [
    deck.legend,
    ...deck.mainDeck,
    ...deck.runeDeck,
    ...deck.battlefields,
  ];
  if (everyId.some((id) => cards[id] === undefined)) errors.push("unknownCard");

  if (cards[deck.legend]?.type !== "legend") errors.push("legendNotALegend");
  if (!deck.mainDeck.includes(deck.champion)) {
    errors.push("championNotInMainDeck");
  }

  // R103.2.a.2 — the Chosen Champion "must be a champion unit with a champion
  // tag that matches the tag on your Champion Legend". Two requirements, and
  // the rule's own example turns on the first: Tibbers has the Annie tag but
  // is a *signature* unit, so it cannot be a Chosen Champion even under an
  // Annie Legend. R133.8.b is what makes the Legend's own tags the champion
  // tags — they are the ones that link a Legend to its Champion Units and
  // Signature cards.
  const legend = cards[deck.legend];
  const champion = cards[deck.champion];
  const legendTags = legend?.tags ?? [];

  if (champion !== undefined) {
    if (champion.supertypes?.includes("champion") !== true) {
      errors.push("championNotAChampionUnit");
    }
    if (!(champion.tags ?? []).some((tag) => legendTags.includes(tag))) {
      errors.push("championTagMismatch");
    }
  }

  // R103.2.d — "Your deck may only contain 3 total Signature cards that have
  // the same Champion tag as your Champion Legend." R103.2.d.1 makes the cap a
  // sum across names, unlike R103.2.b's per-name three.
  const signatures = deck.mainDeck.filter((id) =>
    cards[id]?.supertypes?.includes("signature"),
  );
  if (signatures.length > MAX_SIGNATURE_CARDS) {
    errors.push("tooManySignatureCards");
  }
  // R103.2.d.2 — "All of the Signature cards must have the Champion tag that
  // corresponds to the Champion Legend of the deck."
  if (
    signatures.some(
      (id) => !(cards[id]?.tags ?? []).some((tag) => legendTags.includes(tag)),
    )
  ) {
    errors.push("signatureTagMismatch");
  }
  if (deck.mainDeck.length < MAIN_DECK_MINIMUM) errors.push("mainDeckTooSmall");

  // R103.2.b — up to 3 copies of the same *named* card, the champion included.
  const byName = new Map<string, number>();
  for (const id of deck.mainDeck) {
    const name = nameOf(id) ?? id;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  if ([...byName.values()].some((n) => n > MAX_COPIES)) {
    errors.push("tooManyCopies");
  }

  // R825.3.a — "A deck can contain only one card of a given name if the card
  // has Unique". A narrowing of R103.2.b rather than a separate limit, so it is
  // counted off the same tally. R825.4: that is the whole of what Unique does.
  const uniqueNames = new Set(
    deck.mainDeck
      .filter((id) => cards[id]?.keywords.includes("unique"))
      .map((id) => nameOf(id) ?? id),
  );
  if ([...uniqueNames].some((name) => (byName.get(name) ?? 0) > 1)) {
    errors.push("tooManyUniqueCopies");
  }

  if (deck.runeDeck.length !== RUNE_DECK_SIZE) errors.push("wrongRuneCount");
  if (deck.runeDeck.some((id) => cards[id]?.type !== "rune")) {
    errors.push("notARune");
  }

  if (deck.battlefields.length !== BATTLEFIELDS_PER_DECK) {
    errors.push("wrongBattlefieldCount");
  }
  // R103.4.c — no two battlefields of the same name.
  const bfNames = deck.battlefields.map((id) => nameOf(id) ?? id);
  if (new Set(bfNames).size !== bfNames.length) {
    errors.push("duplicateBattlefieldName");
  }

  return errors;
}

/** Mints `n` distinct instances of one card, since R103.2.b counts by name. */
export function copies(card: CardInstance, n: number): CardInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    ...card,
    id: n === 1 ? card.id : `${card.id}-${i + 1}`,
  }));
}

export interface SeatSetup {
  deck: Deck;
  /**
   * R485.5 / R487.5 — which of this player's three battlefields is used.
   * Absent for a seat that contributes none: R488.4.b removes the first
   * player's battlefields in War, and R489.5.b does the same in Magma
   * Chamber, so a mode can seat a player who brought three and presents none.
   */
  battlefield?: CardId;
}

export interface GameSetup {
  cards: CardInstance[];
  /**
   * R115.1 — the players, in turn order. Index 0 is the First Player, and
   * R115.1.c makes this a looping queue rather than a list, so it is also the
   * answer to "who goes next" all game.
   */
  turnOrder: PlayerId[];
  seats: Partial<Record<PlayerId, SeatSetup>>;
  /**
   * R483 — which Mode of Play. Omitted, it is the sanctioned mode that seats
   * this many players, which is what a caller almost always means.
   */
  mode?: ModeId;
}

export type SetupResult =
  | { ok: true; state: GameState }
  | { ok: false; errors: Partial<Record<PlayerId, DeckError[]>> };

function emptyPlayer(id: PlayerId, deck: Deck) {
  // R103.2.a.1 — the Chosen Champion starts in the Champion Zone, so it is not
  // among the cards that can be drawn even though it counted toward the 40.
  const drawable = deck.mainDeck.filter((cardId) => cardId !== deck.champion);
  return {
    id,
    // R116 — each player draws 4 before the Mulligan.
    mainDeck: drawable.slice(OPENING_HAND),
    hand: drawable.slice(0, OPENING_HAND),
    trash: [],
    banished: [],
    runeDeck: [...deck.runeDeck],
    runes: [],
    runePool: { buckets: [] },
    points: 0,
    scoredThisTurn: [],
    xp: 0,
    legend: deck.legend,
    champion: deck.champion,
  };
}

/**
 * R103/R104/R485 — validate both decks and lay out a legal starting board.
 * Deck order is taken as given rather than shuffled, so a game is reproducible;
 * a caller that wants randomness shuffles before calling.
 */
export function startGame(setup: GameSetup): SetupResult {
  const cards: Record<CardId, CardInstance> = {};
  for (const card of setup.cards) cards[card.id] = card;

  const seatOrder = setup.turnOrder;
  const mode = modeById(setup.mode ?? modeFor(seatOrder.length).id);
  const errors: Partial<Record<PlayerId, DeckError[]>> = {};
  for (const id of seatOrder) {
    const seat = setup.seats[id];
    if (seat === undefined) {
      errors[id] = ["seatWithoutDeck"];
      continue;
    }
    const found = validateDeck(seat.deck, cards);
    if (found.length > 0) errors[id] = found;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const startingPlayer = seatOrder[0]!;

  // R485.4 / R487.4 — the battlefields in play, one per player who presents
  // one. R488.4.b's War has the first player present none, so this is the
  // seats that brought one rather than a count.
  const battlefieldOrder = seatOrder.flatMap((id) => {
    const chosen = setup.seats[id]?.battlefield;
    return chosen === undefined ? [] : [chosen];
  });
  // R483.4 — "Battlefield Count: Determines how many Battlefields are in play".
  // R488.4.b is why this is checked rather than assumed: in a War the first
  // player presents none, so four seats put three battlefields on the table.
  if (battlefieldOrder.length !== mode.battlefields) {
    return {
      ok: false,
      errors: { [seatOrder[0]!]: ["wrongBattlefieldsInPlay"] },
    };
  }
  const battlefields: GameState["battlefields"] = {};
  for (const id of battlefieldOrder) {
    battlefields[id] = { cardId: id, controller: null, contestedBy: null };
  }

  const players: GameState["players"] = {};
  for (const id of seatOrder) {
    players[id] = emptyPlayer(id, setup.seats[id]!.deck);
  }

  const blank: GameState = {
    turn: { player: startingPlayer, phase: "main", number: 0 },
    mode: mode.id,
    turnOrder: [...seatOrder],
    players,
    cards,
    permanents: {},
    runes: {},
    battlefields,
    battlefieldOrder,
    facedown: {},
    playedThisTurn: Object.fromEntries(seatOrder.map((id) => [id, []])),
    triggeredThisTurn: {},
    pendingDiscounts: [],
    revealed: [],
    damageReplacements: [],
    showdown: null,
    winner: null,
    chain: [],
    priority: null,
    priorityPasses: 0,
    pending: null,
    tasks: [],
    modifiers: [],
    tokensCreated: 0,
    delayed: [],
  };

  // R117 — "In turn order, players perform their Mulligan", and it happens
  // *before* turn 1 begins, so the queue holds every mulligan ahead of the
  // first turn step. The driver stops at each for an answer.
  const opened = openTurn(blank, startingPlayer, 1);
  const queued = enqueue(
    opened.state,
    ...seatOrder.map(
      (player) => ({ kind: "mulligan", player }) as const,
    ),
    { kind: "turnStep", player: startingPlayer, step: "awaken", number: 1 },
  );

  return { ok: true, state: runTasks(queued, opened.events).state };
}
