import { describe, expect, it } from "vitest";
import { activateAbility } from "../src/actions.js";
import { activated, addEnergy, addPower, exhaustSelf } from "../src/builders.js";
import { totals } from "../src/cost.js";
import { FREE } from "../src/cost.js";
import type { CardInstance } from "../src/state.js";
import { makeState } from "./fixtures.js";

// Three real gear cards, authored purely as data. Nothing in src/ was written
// for any of them specifically — they reuse the vocabulary the runes needed.

/** Energy Conduit — "⟳: [Reaction] — Add 1 Energy." */
const energyConduit: CardInstance = {
  id: "energy-conduit",
  name: "Energy Conduit",
  type: "gear",
  cost: FREE,
  abilities: [activated([exhaustSelf], addEnergy(1), "reaction")],
};

/** Seal of Rage — "⟳: [Reaction] — Add 1 Fury Power." */
const sealOfRage: CardInstance = {
  id: "seal-of-rage",
  name: "Seal of Rage",
  type: "gear",
  cost: FREE,
  abilities: [activated([exhaustSelf], addPower("fury", 1), "reaction")],
};

/** Seal of Unity — the same shape, a different domain. */
const sealOfUnity: CardInstance = {
  id: "seal-of-unity",
  name: "Seal of Unity",
  type: "gear",
  cost: FREE,
  abilities: [activated([exhaustSelf], addPower("order", 1), "reaction")],
};

function onBoard(card: CardInstance) {
  const state = makeState({ p1: { base: [card.id] }, cards: [card] });
  return {
    ...state,
    permanents: { [card.id]: { cardId: card.id, exhausted: false } },
  };
}

describe("real cards expressed as data", () => {
  it("Energy Conduit exhausts for 1 energy", () => {
    const result = activateAbility(onBoard(energyConduit), "p1", energyConduit.id, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totals(result.state.players.p1.runePool).energy).toBe(1);
    expect(result.state.permanents[energyConduit.id]?.exhausted).toBe(true);
  });

  it("Seal of Rage exhausts for 1 Fury power", () => {
    const result = activateAbility(onBoard(sealOfRage), "p1", sealOfRage.id, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totals(result.state.players.p1.runePool).power).toEqual({ fury: 1 });
  });

  it("Seal of Unity differs only in its data, not its code path", () => {
    const result = activateAbility(onBoard(sealOfUnity), "p1", sealOfUnity.id, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(totals(result.state.players.p1.runePool).power).toEqual({ order: 1 });
  });

  it("refuses to activate an already-exhausted gear", () => {
    const once = activateAbility(onBoard(energyConduit), "p1", energyConduit.id, 0);
    if (!once.ok) throw new Error("setup failed");

    expect(activateAbility(once.state, "p1", energyConduit.id, 0)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });
});
