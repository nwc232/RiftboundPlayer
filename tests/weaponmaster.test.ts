import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { attachSelf, dealDamage } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { abilitiesOf, mightOf } from "../src/layers.js";
import { legalActions } from "../src/legal.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, Cost, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** A gear whose Equip ability costs `equipCost`, worth +2 Might attached. */
function gear(id: string, equipCost: Partial<Cost>): CardInstance {
  return {
    id,
    name: id,
    type: "gear",
    cost: { ...FREE, energy: 1 },
    keywords: [],
    // R150 — "Gear can have the Equipment tag", and R821.1.c chooses by it.
    tags: ["Equipment"],
    abilities: [
      {
        kind: "activated",
        timing: "default",
        costs: [{ kind: "pay", cost: { ...FREE, ...equipCost } }],
        effect: attachSelf(),
        targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      },
    ],
    attachment: { mightBonus: 2, keywords: [] },
  };
}

/** Jax, Unrelenting — "[Weaponmaster]". */
const jax: CardInstance = unit("jax", {
  might: 3,
  keywords: ["weaponmaster"],
});

function board(
  equipCost: Partial<Cost>,
  options: { energy?: number; gearOnBoard?: boolean } = {},
): GameState {
  const sword = gear("sword", equipCost);
  return makeState({
    p1: {
      hand: ["jax"],
      mainDeck: ["a"],
      runePool: pool({ energy: options.energy ?? 9, universalPower: 4 }),
    },
    p2: { mainDeck: ["b"] },
    cards: [jax, sword, unit("a"), unit("b")],
    permanents:
      options.gearOnBoard === false
        ? []
        : [{ cardId: "sword", controller: "p1" }],
  });
}

const PLAY: Action = { type: "playUnitFromHand", playerId: "p1", cardId: "jax" };

/** Answer the "you may" (R383.3.a), then the choice, then let it resolve. */
function equipping(
  state: GameState,
  answers: Action[] = [
    { type: "decide", playerId: "p1", perform: true },
    { type: "decide", playerId: "p1", targets: ["sword"] },
  ],
): GameState {
  let current = state;
  for (const action of [
    PLAY,
    ...answers,
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p2" },
  ] as Action[]) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/**
 * R821.1.c — "When you play me, you may choose a Card you control with the
 * Equipment tag … Pay the cost of its Equip ability, reduced by [A], to attach
 * it to this unit."
 */
describe("[Weaponmaster] (R821)", () => {
  it("expands into an optional play trigger that chooses a gear", () => {
    const state = makeState({
      cards: [jax],
      permanents: [{ cardId: "jax", controller: "p1" }],
    });

    expect(abilitiesOf(state, "jax")).toEqual([
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        optional: true,
        targeting: {
          filters: [{ type: "gear", controller: "friendly", tag: "Equipment" }],
        },
        effect: {
          op: "equipChosen",
          targetIndex: 0,
          reduce: { energy: 0, power: {}, anyPower: 1 },
        },
      },
    ]);
  });

  it("attaches the chosen gear to the unit that played", () => {
    const after = equipping(board({ energy: 1, anyPower: 1 }));

    expect(after.permanents.sword?.attachedTo).toBe("jax");
    // R477.3.d — the Might Bonus now applies.
    expect(mightOf(after, "jax")).toBe(5);
  });

  /** R821.1.c — the Equip cost is paid "reduced by [A]". */
  it("takes one [A] off the Equip cost", () => {
    const before = board({ energy: 1, anyPower: 1 });
    const after = equipping(before);

    // The gear cost [1][A]; only the [1] came out of the pool.
    const paid = seatOf(after, "p1").runePool.buckets[0]!;
    expect(paid.energy).toBe(8);
    expect(paid.universalPower).toBe(4);
  });

  /**
   * R821.1.c.3 — "If the chosen card's Equip cost does not contain [A], it can
   * still be paid, but will not be reduced." The reduction floors at zero
   * rather than eating something else.
   */
  it("pays an Equip cost with no [A] in it in full", () => {
    const after = equipping(board({ energy: 2 }));

    expect(after.permanents.sword?.attachedTo).toBe("jax");
    expect(seatOf(after, "p1").runePool.buckets[0]!.energy).toBe(7);
  });

  /**
   * R821.1.c.5 — "If the chosen card's Equip cost can't be paid … it stays in
   * its current location, Attached to anything it was already Attached to."
   * Not a rejection: the ability resolves and does nothing.
   */
  it("does nothing when the Equip cost cannot be paid", () => {
    const after = equipping(board({ energy: 5 }, { energy: 2 }));

    expect(after.permanents.sword?.attachedTo).toBeUndefined();
    expect(mightOf(after, "jax")).toBe(3);
  });

  /** R821.1.c.4 — "If the chosen card doesn't have an Equip cost, it can't be paid." */
  it("does nothing with a gear that has no Equip ability", () => {
    const inert: CardInstance = {
      id: "sword",
      name: "sword",
      type: "gear",
      cost: { ...FREE, energy: 1 },
      keywords: [],
      tags: ["Equipment"],
      abilities: [
        { kind: "activated", timing: "default", costs: [], effect: dealDamage(1) },
      ],
      attachment: { mightBonus: 2, keywords: [] },
    };
    const state = makeState({
      p1: { hand: ["jax"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [jax, inert, unit("a"), unit("b")],
      permanents: [{ cardId: "sword", controller: "p1" }],
    });

    const after = equipping(state);
    expect(after.permanents.sword?.attachedTo).toBeUndefined();
  });

  /** R383.3.a — "you may" is answered before anything is chosen. */
  it("can be declined outright", () => {
    let current = board({ energy: 1, anyPower: 1 });
    for (const action of [
      PLAY,
      { type: "decide", playerId: "p1", perform: false },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    expect(current.chain).toEqual([]);
    expect(current.permanents.sword?.attachedTo).toBeUndefined();
    // Declining costs nothing — and Jax himself is free in this fixture, so
    // the pool is untouched.
    expect(seatOf(current, "p1").runePool.buckets[0]!.energy).toBe(9);
  });

  /**
   * R355.8 — with no Equipment to choose, the trigger has no valid choice and
   * comes back off the chain rather than deadlocking.
   */
  it("leaves the game playable with no gear on the board", () => {
    const result = applyAction(
      board({ energy: 1 }, { gearOnBoard: false }),
      PLAY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(legalActions(result.state, "p1").length).toBeGreaterThan(0);
  });

  /**
   * R821.1.b — "regardless of the usual timing of the Equip ability". The
   * gear's own [Equip] is an activated ability at default timing; this pays it
   * from inside a play trigger, so the timing never comes up.
   */
  it("equips without activating the Equip ability (R821.1.c.6)", () => {
    const after = equipping(board({ energy: 1, anyPower: 1 }));

    // Nothing was put on the chain by the gear: the trigger did it directly.
    expect(after.chain).toEqual([]);
    expect(after.permanents.sword?.attachedTo).toBe("jax");
  });
});
