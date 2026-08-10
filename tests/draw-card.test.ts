import { describe, expect, it } from "vitest";
import { drawCard } from "../src/actions.js";
import { makeState, unit } from "./fixtures.js";

function state() {
  return makeState({
    p1: { mainDeck: ["c1", "c2"] },
    cards: [unit("c1"), unit("c2")],
  });
}

describe("drawCard", () => {
  it("moves the top card from mainDeck to hand in the returned state", () => {
    const result = drawCard(state(), "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.hand).toEqual(["c1"]);
    expect(result.state.players.p1.mainDeck).toEqual(["c2"]);
  });

  it("reports what happened as a cardDrawn event", () => {
    const result = drawCard(state(), "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      { type: "cardDrawn", playerId: "p1", cardId: "c1" },
    ]);
  });

  it("leaves the original state object completely untouched", () => {
    const before = state();

    drawCard(before, "p1");

    expect(before.players.p1.hand).toEqual([]);
    expect(before.players.p1.mainDeck).toEqual(["c1", "c2"]);
  });

  it("rejects the draw when the deck is empty", () => {
    expect(drawCard(state(), "p2")).toEqual({
      ok: false,
      reason: "deckEmpty",
    });
  });
});
