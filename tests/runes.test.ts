import { describe, expect, it } from "vitest";
import { activateAbility, channelRune } from "../src/actions.js";
import { totals } from "../src/cost.js";
import type { GameState } from "../src/state.js";
import { makeState, runeCard } from "./fixtures.js";

// Basic runes carry two abilities in printed order (R164.2).
const ENERGY = 0;
const POWER = 1;

function withRune(domain: "fury" | "order" = "fury"): GameState {
  const result = channelRune(
    makeState({
      p1: { runeDeck: ["r1"] },
      cards: [runeCard("r1", domain)],
    }),
    "p1",
  );
  if (!result.ok) throw new Error("setup failed");
  return result.state;
}

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
    expect(channelRune(makeState({ p1: { runeDeck: [] } }), "p1")).toEqual({
      ok: false,
      reason: "runeDeckEmpty",
    });
  });
});

describe("the rune's energy ability", () => {
  it("exhausts the rune and adds 1 energy", () => {
    const result = activateAbility(withRune(), "p1", "r1", ENERGY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.runes.r1?.exhausted).toBe(true);
    expect(totals(result.state.players.p1.runePool).energy).toBe(1);
    expect(result.events).toEqual([
      { type: "energyAdded", playerId: "p1", amount: 1 },
    ]);
  });

  it("cannot be paid twice — the rune is already exhausted", () => {
    const once = activateAbility(withRune(), "p1", "r1", ENERGY);
    if (!once.ok) throw new Error("setup failed");

    expect(activateAbility(once.state, "p1", "r1", ENERGY)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });

  it("rejects a source the player does not control", () => {
    expect(activateAbility(withRune(), "p2", "r1", ENERGY)).toEqual({
      ok: false,
      reason: "sourceNotControlled",
    });
  });
});

describe("the rune's power ability", () => {
  it("recycles the rune to the bottom of the rune deck and adds its domain's Power", () => {
    const result = activateAbility(withRune("order"), "p1", "r1", POWER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.runes).toEqual([]);
    expect(result.state.players.p1.runeDeck).toEqual(["r1"]);
    expect(result.state.runes.r1).toBeUndefined();
    expect(totals(result.state.players.p1.runePool).power).toEqual({ order: 1 });
  });
});

describe("one rune, both abilities", () => {
  // R414.1.b blocks re-exhausting, but R416 puts no ready requirement on
  // Recycle — so a single rune can yield 1 Energy and then 1 Power.
  it("allows exhausting for energy and then recycling the same rune", () => {
    const energised = activateAbility(withRune(), "p1", "r1", ENERGY);
    if (!energised.ok) throw new Error("setup failed");

    const result = activateAbility(energised.state, "p1", "r1", POWER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const left = totals(result.state.players.p1.runePool);
    expect(left.energy).toBe(1);
    expect(left.power).toEqual({ fury: 1 });
  });
});

describe("rejections", () => {
  it("rejects an ability index the card does not have", () => {
    expect(activateAbility(withRune(), "p1", "r1", 7)).toEqual({
      ok: false,
      reason: "abilityNotFound",
    });
  });
});
