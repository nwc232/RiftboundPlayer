import { enqueue, runTasks } from "./tasks.js";
import { openTurn } from "./turn.js";
import type { CardId, CardInstance, GameState, PlayerId } from "./state.js";

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
  | "mainDeckTooSmall"
  | "tooManyCopies"
  | "wrongRuneCount"
  | "notARune"
  | "wrongBattlefieldCount"
  | "duplicateBattlefieldName"
  | "unknownCard";

export const MAIN_DECK_MINIMUM = 40;
export const RUNE_DECK_SIZE = 12;
export const BATTLEFIELDS_PER_DECK = 3;
export const MAX_COPIES = 3;
/** R116 — "Players each draw 4." */
export const OPENING_HAND = 4;

/**
 * R103's countable requirements. Domain Identity (R103.1.b) and the Chosen
 * Champion's tag matching the Legend's (R103.2.a.2) are *not* checked: both
 * need the tag system, which the engine does not have. See the survey.
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

export interface SetupChoice {
  /** R485.5 — which of this player's three battlefields is used. */
  battlefield: CardId;
}

export interface GameSetup {
  cards: CardInstance[];
  p1: Deck;
  p2: Deck;
  choices: Record<PlayerId, SetupChoice>;
  /** R485.7 keys the extra rune off this. */
  startingPlayer?: PlayerId;
}

export type SetupResult =
  | { ok: true; state: GameState }
  | { ok: false; errors: Record<PlayerId, DeckError[]> };

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

  const errors = {
    p1: validateDeck(setup.p1, cards),
    p2: validateDeck(setup.p2, cards),
  };
  if (errors.p1.length > 0 || errors.p2.length > 0) {
    return { ok: false, errors };
  }

  const startingPlayer = setup.startingPlayer ?? "p1";
  const second: PlayerId = startingPlayer === "p1" ? "p2" : "p1";

  // R485.4 — two battlefields in play, one contributed by each player.
  const battlefieldOrder = [
    setup.choices.p1.battlefield,
    setup.choices.p2.battlefield,
  ];
  const battlefields: GameState["battlefields"] = {};
  for (const id of battlefieldOrder) {
    battlefields[id] = { cardId: id, controller: null, contestedBy: null };
  }

  const blank: GameState = {
    turn: { player: startingPlayer, phase: "main", number: 0 },
    players: {
      p1: emptyPlayer("p1", setup.p1),
      p2: emptyPlayer("p2", setup.p2),
    },
    cards,
    permanents: {},
    runes: {},
    battlefields,
    battlefieldOrder,
    facedown: {},
    playedThisTurn: { p1: [], p2: [] },
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
    startingPlayer,
  };

  // R117 — the Mulligan happens in turn order, *before* turn 1 begins, so the
  // queue holds both mulligans ahead of the first turn step. The driver stops
  // at each for an answer.
  const opened = openTurn(blank, startingPlayer, 1);
  const queued = enqueue(
    opened.state,
    { kind: "mulligan", player: startingPlayer },
    { kind: "mulligan", player: second },
    { kind: "turnStep", player: startingPlayer, step: "awaken", number: 1 },
  );

  return { ok: true, state: runTasks(queued, opened.events).state };
}
