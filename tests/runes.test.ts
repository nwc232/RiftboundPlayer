import { describe, expect, it } from "vitest";
import {
  channelRune,
  exhaustRuneForEnergy,
  recycleRuneForPower,
} from "../src/actions.js";
import { makeState, runeCard } from "./fixtures.js";

describe("channelRune", () => {
  it("moves the top rune onto the board ready, in channel order", () => {
    const before = makeState({
      p1: { runeDeck: ["r1", "r2"] },
      cards: [runeCard("r1", "fury"), runeCard("r2", "calm")],
    });

    const result = channelRune(before, "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.runes).toEqual(["r1"]);
    expect(result.state.players.p1.runeDeck).toEqual(["r2"]);
    expect(result.state.runes.r1).toEqual({
      cardId: "r1",
      domain: "fury",
      exhausted: false,
    });
  });

  it("rejects when the rune deck is empty", () => {
    const before = makeState({ p1: { runeDeck: [] } });

    expect(channelRune(before, "p1")).toEqual({
      ok: false,
      reason: "runeDeckEmpty",
    });
  });
});

describe("exhaustRuneForEnergy", () => {
  it("exhausts a ready rune and adds 1 energy", () => {
    const channeled = channelRune(
      makeState({
        p1: { runeDeck: ["r1"] },
        cards: [runeCard("r1", "fury")],
      }),
      "p1",
    );
    if (!channeled.ok) throw new Error("setup failed");

    const result = exhaustRuneForEnergy(channeled.state, "p1", "r1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.runes.r1?.exhausted).toBe(true);
    expect(result.state.players.p1.runePool.energy).toBe(1);
    expect(result.events).toEqual([
      { type: "energyAdded", playerId: "p1", amount: 1 },
    ]);
  });

  it("rejects a rune that is already exhausted", () => {
    const channeled = channelRune(
      makeState({
        p1: { runeDeck: ["r1"] },
        cards: [runeCard("r1", "fury")],
      }),
      "p1",
    );
    if (!channeled.ok) throw new Error("setup failed");
    const once = exhaustRuneForEnergy(channeled.state, "p1", "r1");
    if (!once.ok) throw new Error("setup failed");

    expect(exhaustRuneForEnergy(once.state, "p1", "r1")).toEqual({
      ok: false,
      reason: "runeAlreadyExhausted",
    });
  });

  it("rejects a rune the player does not control", () => {
    const channeled = channelRune(
      makeState({
        p1: { runeDeck: ["r1"] },
        cards: [runeCard("r1", "fury")],
      }),
      "p1",
    );
    if (!channeled.ok) throw new Error("setup failed");

    expect(exhaustRuneForEnergy(channeled.state, "p2", "r1")).toEqual({
      ok: false,
      reason: "runeNotControlled",
    });
  });
});

describe("recycleRuneForPower", () => {
  it("returns the rune to the rune deck and adds Power of its domain", () => {
    const channeled = channelRune(
      makeState({
        p1: { runeDeck: ["r1"] },
        cards: [runeCard("r1", "order")],
      }),
      "p1",
    );
    if (!channeled.ok) throw new Error("setup failed");

    const result = recycleRuneForPower(channeled.state, "p1", "r1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.runes).toEqual([]);
    expect(result.state.players.p1.runeDeck).toEqual(["r1"]);
    expect(result.state.players.p1.runePool.power).toEqual({ order: 1 });
    expect(result.state.runes.r1).toBeUndefined();
  });
});
