import { describe, expect, it } from "vitest";
import { startGame, validateDeck } from "../src/deck.js";
import type { CardId, CardInstance } from "../src/state.js";
import { ALL_CARDS, RENGAR_DECK, VEX_DECK, matchup } from "../src/decks/index.js";

const registry: Record<CardId, CardInstance> = {};
for (const card of ALL_CARDS) registry[card.id] = card;

/** R103 — what a player must bring. Both lists are real, so both must pass. */
describe("the two real decks", () => {
  it("are legal (R103)", () => {
    expect(validateDeck(VEX_DECK, registry)).toEqual([]);
    expect(validateDeck(RENGAR_DECK, registry)).toEqual([]);
  });

  it("hold 40 main-deck cards each, champion included (R103.2)", () => {
    expect(VEX_DECK.mainDeck).toHaveLength(40);
    expect(RENGAR_DECK.mainDeck).toHaveLength(40);
  });

  it("never exceed three copies of a name (R103.2.b)", () => {
    for (const deck of [VEX_DECK, RENGAR_DECK]) {
      const byName = new Map<string, number>();
      for (const id of deck.mainDeck) {
        const name = registry[id]!.name;
        byName.set(name, (byName.get(name) ?? 0) + 1);
      }
      expect(Math.max(...byName.values())).toBeLessThanOrEqual(3);
    }
  });

  it("give every copy its own id", () => {
    const ids = ALL_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("start a game", () => {
    const result = startGame(matchup());

    expect(result.ok).toBe(true);
  });
});

/**
 * Every ability is data, so nothing in a deck should contain a function. The
 * roadmap's serialization item turns on this staying true.
 */
describe("cards are plain data", () => {
  it("survive a JSON round trip unchanged", () => {
    const copy = JSON.parse(JSON.stringify(ALL_CARDS)) as CardInstance[];

    expect(copy).toEqual(ALL_CARDS);
  });
});
