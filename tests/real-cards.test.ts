import { describe, expect, it } from "vitest";
import { activateAbility, applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  activated,
  addEnergy,
  addPower,
  additionalCost,
  chosenCost,
  draw,
  exhaustSelf,
  ifThen,
  paidAdditionalCost,
} from "../src/builders.js";
import { totals } from "../src/cost.js";
import { FREE } from "../src/cost.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Plays a spell and lets the chain empty, so its effect has actually run. */
function resolveSpell(state: GameState, action: Action): GameState {
  let current = state;
  for (const each of [
    action,
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p2" },
  ] as Action[]) {
    const result = applyAction(current, each);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

// Three real gear cards, authored purely as data. Nothing in src/ was written
// for any of them specifically — they reuse the vocabulary the runes needed.

/** Energy Conduit — "⟳: [Reaction] — Add 1 Energy." */
const energyConduit: CardInstance = {
  id: "energy-conduit",
  name: "Energy Conduit",
  type: "gear",
  cost: FREE,
  keywords: [],
  abilities: [activated([exhaustSelf], addEnergy(1), "reaction")],
};

/** Seal of Rage — "⟳: [Reaction] — Add 1 Fury Power." */
const sealOfRage: CardInstance = {
  id: "seal-of-rage",
  name: "Seal of Rage",
  type: "gear",
  cost: FREE,
  keywords: [],
  abilities: [activated([exhaustSelf], addPower("fury", 1), "reaction")],
};

/** Seal of Unity — the same shape, a different domain. */
const sealOfUnity: CardInstance = {
  id: "seal-of-unity",
  name: "Seal of Unity",
  type: "gear",
  cost: FREE,
  keywords: [],
  abilities: [activated([exhaustSelf], addPower("order", 1), "reaction")],
};

function onBoard(card: CardInstance) {
  return makeState({
    cards: [card],
    permanents: [{ cardId: card.id, controller: "p1" }],
  });
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

/**
 * R355.1's choosing costs, on three real cards authored from their printed
 * text. Nothing in `src/` was written for any of them: they reuse the `chosen`
 * cost the mechanism added, the additional-cost ability that was already
 * there, and R205's "if you paid the additional cost".
 */
describe("cards whose cost names something", () => {
  /** Cruel Patron — "As an additional cost to play me, kill a friendly unit." */
  const cruelPatron: CardInstance = {
    id: "cruel-patron",
    name: "Cruel Patron",
    type: "unit",
    might: 4,
    cost: FREE,
    keywords: [],
    abilities: [
      additionalCost(
        [chosenCost("kill", { type: "unit", controller: "friendly" })],
        false,
      ),
    ],
  };

  /**
   * Legion Quartermaster — "As an additional cost to play me, return a
   * friendly gear to its owner's hand."
   */
  const legionQuartermaster: CardInstance = {
    id: "legion-quartermaster",
    name: "Legion Quartermaster",
    type: "unit",
    might: 3,
    cost: FREE,
    keywords: [],
    abilities: [
      additionalCost(
        [chosenCost("returnToHand", { type: "gear", controller: "friendly" })],
        false,
      ),
    ],
  };

  /**
   * Meditation — "[Reaction] As an additional cost to play this, you may
   * exhaust a friendly unit. If you do, draw 2. Otherwise, draw 1."
   */
  const meditation: CardInstance = {
    id: "meditation",
    name: "Meditation",
    type: "spell",
    cost: FREE,
    keywords: ["reaction"],
    abilities: [
      activated([], ifThen(paidAdditionalCost, draw(2), draw(1)), "reaction"),
      additionalCost([
        chosenCost("exhaust", { type: "unit", controller: "friendly" }),
      ]),
    ],
  };

  function table(card: CardInstance) {
    return makeState({
      p1: {
        hand: [card.id],
        mainDeck: ["d1", "d2", "d3"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["d4"] },
      cards: [
        card,
        unit("ally"),
        { ...unit("relic"), type: "gear" as const },
        unit("d1"),
        unit("d2"),
        unit("d3"),
        unit("d4"),
      ],
      permanents: [
        { cardId: "ally", controller: "p1" },
        { cardId: "relic", controller: "p1" },
      ],
    });
  }

  it("plays Cruel Patron by killing a friendly unit", () => {
    const result = applyAction(table(cruelPatron), {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: "cruel-patron",
      costChoices: [["ally"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.ally).toBeUndefined();
    expect(result.state.permanents["cruel-patron"]).toBeDefined();
  });

  it("plays Legion Quartermaster by returning a gear", () => {
    const result = applyAction(table(legionQuartermaster), {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: "legion-quartermaster",
      costChoices: [["relic"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.relic).toBeUndefined();
    expect(result.state.players.p1.hand).toContain("relic");
  });

  /** R205 — the effect asks whether the optional cost was actually paid. */
  it("draws 2 for Meditation only when the unit was exhausted", () => {
    const cast = (costChoices: string[][], payOptional: boolean) =>
      resolveSpell(table(meditation), {
        type: "playSpell",
        playerId: "p1",
        cardId: "meditation",
        payOptional,
        costChoices,
      });

    const paid = cast([["ally"]], true);
    expect(paid.permanents.ally?.exhausted).toBe(true);
    expect(paid.players.p1.hand).toHaveLength(2);

    const declined = cast([], false);
    expect(declined.permanents.ally?.exhausted).toBe(false);
    expect(declined.players.p1.hand).toHaveLength(1);
  });
});

