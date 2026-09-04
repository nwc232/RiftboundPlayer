import { describe, expect, it } from "vitest";
import { validateDeck } from "../src/deck.js";
import { DECK_LISTS, instantiate } from "../src/decks/index.js";
import { blackFlameAltar } from "../src/decks/leblanc.js";
import { keywordsOf } from "../src/layers.js";
import type {
  CardId,
  CardInstance,
  GameState,
  Location,
  PlayerId,
} from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const HERE: Location = { kind: "battlefield", id: "black-flame-altar" };

// A list has ids only once a seat has been given one, so each is instantiated
// before it can be checked.
const SEATED = DECK_LISTS.map((list) => instantiate(list, "p1"));
const registry: Record<CardId, CardInstance> = Object.fromEntries(
  SEATED.flatMap((each) => each.cards).map((card) => [card.id, card]),
);

const LEBLANC_DECK = SEATED[2]!.deck;
const AKALI_DECK = SEATED[3]!.deck;
const DIANA_DECK = SEATED[4]!.deck;

/** R103 — the deck-building requirements, checked on the real list. */
describe("the LeBlanc deck is legal", () => {
  it("passes every R103 check", () => {
    expect(validateDeck(LEBLANC_DECK, registry)).toEqual([]);
  });

  it("is 40 cards and 12 runes", () => {
    expect(LEBLANC_DECK.mainDeck).toHaveLength(40);
    expect(LEBLANC_DECK.runeDeck).toHaveLength(12);
    expect(LEBLANC_DECK.battlefields).toHaveLength(3);
  });
});


/**
 * R190 — a battlefield is a Game Object with rules text, and its passives are
 * passives like any other. `passivesFor` only ever swept `state.permanents`,
 * and a battlefield is not one, so Black Flame Altar did nothing at all.
 */
describe("a battlefield's passive", () => {
  function board(controller: PlayerId | null): GameState {
    const base = makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [
        blackFlameAltar,
        { ...unit("sprite", { might: 3 }), keywords: ["temporary"] },
        unit("plain", { might: 3 }),
        unit("a"),
        unit("b"),
      ],
      permanents: [
        { cardId: "sprite", controller: "p1", location: HERE },
        { cardId: "plain", controller: "p1", location: HERE },
      ],
      battlefields: [
        controller === null ? "black-flame-altar" : ["black-flame-altar", controller],
      ],
    });
    return base;
  }

  it("reaches the units standing at it", () => {
    expect(keywordsOf(board("p1"), "sprite")).toContain("shield");
  });

  it("reaches only the ones its scope names", () => {
    // "Units here **with [Temporary]**" — the plain one is not one of them.
    expect(keywordsOf(board("p1"), "plain")).not.toContain("shield");
  });

  /**
   * R190.6.d — an uncontrolled battlefield's "you" refers to nobody. This
   * passive says no "you", so it applies whoever holds it, including nobody.
   */
  it("applies while nobody controls it", () => {
    expect(keywordsOf(board(null), "sprite")).toContain("shield");
  });
});

/** R103 on the two lists a player sent, checked the same way. */
describe("the sent decks are legal", () => {
  it.each([
    ["Akali", AKALI_DECK],
    ["Diana", DIANA_DECK],
  ])("%s passes every R103 check", (_name, deck) => {
    expect(validateDeck(deck, registry)).toEqual([]);
  });

  it.each([
    ["Akali", AKALI_DECK],
    ["Diana", DIANA_DECK],
  ])("%s is 40 cards, 12 runes and 3 battlefields", (_name, deck) => {
    expect(deck.mainDeck).toHaveLength(40);
    expect(deck.runeDeck).toHaveLength(12);
    expect(deck.battlefields).toHaveLength(3);
  });
});
