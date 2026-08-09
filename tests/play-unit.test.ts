import { describe, expect, it } from "vitest";
import { playUnitFromHand } from "../src/actions.js";
import type { GameState } from "../src/state.js";

function makeState(): GameState {
  return {
    players: {
      p1: { id: "p1", mainDeck: [], hand: ["u1", "s1"], base: [] },
      p2: { id: "p2", mainDeck: [], hand: [], base: [] },
    },
    cards: {
      u1: { id: "u1", name: "Test Unit", type: "unit" },
      s1: { id: "s1", name: "Test Spell", type: "spell" },
    },
    permanents: {},
  };
}

describe("playUnitFromHand", () => {
  it("moves a unit from hand to base and creates it as an exhausted permanent", () => {
    const before = makeState();

    const { state } = playUnitFromHand(before, "p1", "u1");

    expect(state.players.p1.hand).toEqual(["s1"]);
    expect(state.players.p1.base).toEqual(["u1"]);
    expect(state.permanents.u1).toEqual({ cardId: "u1", exhausted: true });
  });

  it("reports what happened as a unitPlayed event", () => {
    const before = makeState();

    const { events } = playUnitFromHand(before, "p1", "u1");

    expect(events).toEqual([
      { type: "unitPlayed", playerId: "p1", cardId: "u1" },
    ]);
  });

  it("leaves the original state object completely untouched", () => {
    const before = makeState();

    playUnitFromHand(before, "p1", "u1");

    expect(before.players.p1.hand).toEqual(["u1", "s1"]);
    expect(before.players.p1.base).toEqual([]);
    expect(before.permanents.u1).toBeUndefined();
  });

  it("does nothing if the card is not a unit", () => {
    const before = makeState();

    const { state, events } = playUnitFromHand(before, "p1", "s1");

    expect(events).toEqual([]);
    expect(state).toBe(before);
  });

  it("does nothing if the card is not in that player's hand", () => {
    const before = makeState();

    const { state, events } = playUnitFromHand(before, "p2", "u1");

    expect(events).toEqual([]);
    expect(state).toBe(before);
  });
});
