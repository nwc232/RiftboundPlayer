import { describe, expect, it } from "vitest";
import { drawCard } from "../src/actions.js";
import type { GameState } from "../src/state.js";

function makeState(): GameState {
  return {
    players: {
      p1: { id: "p1", mainDeck: ["c1", "c2"], hand: [], base: [] },
      p2: { id: "p2", mainDeck: [], hand: [], base: [] },
    },
    cards: {
      c1: { id: "c1", name: "Test Card One", type: "unit" },
      c2: { id: "c2", name: "Test Card Two", type: "unit" },
    },
    permanents: {},
  };
}

describe("drawCard", () => {
  it("moves the top card from mainDeck to hand in the returned state", () => {
    const before = makeState();

    const result = drawCard(before, "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.hand).toEqual(["c1"]);
    expect(result.state.players.p1.mainDeck).toEqual(["c2"]);
  });

  it("reports what happened as a cardDrawn event", () => {
    const before = makeState();

    const result = drawCard(before, "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      { type: "cardDrawn", playerId: "p1", cardId: "c1" },
    ]);
  });

  it("leaves the original state object completely untouched", () => {
    const before = makeState();

    drawCard(before, "p1");

    expect(before.players.p1.hand).toEqual([]);
    expect(before.players.p1.mainDeck).toEqual(["c1", "c2"]);
  });

  it("rejects the draw when the deck is empty", () => {
    const before = makeState();

    const result = drawCard(before, "p2");

    expect(result).toEqual({ ok: false, reason: "deckEmpty" });
  });
});
