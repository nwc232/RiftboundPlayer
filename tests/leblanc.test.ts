import { describe, expect, it } from "vitest";
import { validateDeck } from "../src/deck.js";
import { ALL_CARDS, LEBLANC_DECK } from "../src/decks/index.js";
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

const registry: Record<CardId, CardInstance> = Object.fromEntries(
  ALL_CARDS.map((card) => [card.id, card]),
);

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
