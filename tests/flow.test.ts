import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { activated, counterSpell, dealDamage, flow } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { flowCostsOf, totalCostOf } from "../src/costing.js";
import { legalActions } from "../src/legal.js";
import { playZonesFor } from "../src/zones.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, Cost, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Onslaught — a spell that costs [5] to play, or [3] from the trash. */
function torch(flowCosts: Partial<Cost>[] = [{ energy: 3 }]): CardInstance {
  return {
    id: "torch",
    name: "Onslaught",
    type: "spell",
    cost: { ...FREE, energy: 5 },
    keywords: [],
    abilities: [
      {
        ...activated([], dealDamage(2)),
        targeting: { filters: [{ type: "unit", controller: "enemy" }] },
      },
      ...flowCosts.map((cost) => flow(cost)),
    ],
  };
}

function board(
  card: CardInstance = torch(),
  where: "hand" | "trash" = "trash",
): GameState {
  return makeState({
    p1: {
      hand: where === "hand" ? [card.id] : [],
      trash: where === "trash" ? [card.id] : [],
      mainDeck: ["a"],
      runePool: pool({ energy: 9 }),
    },
    p2: { mainDeck: ["b"] },
    cards: [card, unit("ogre", { might: 9 }), unit("a"), unit("b")],
    permanents: [{ cardId: "ogre", controller: "p2" }],
  });
}

const CAST_FROM_TRASH: Action = {
  type: "playSpell",
  playerId: "p1",
  cardId: "torch",
  targets: ["ogre"],
};

function resolve(state: GameState, action: Action): GameState {
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

/** R829.1.b — "You may play this from your trash for its flow cost. Then banish it." */
describe("[Flow] (R829)", () => {
  it("makes the trash a zone the spell can be played from", () => {
    expect(playZonesFor(board(), "p1", "torch")).toEqual([
      {
        source: "trash",
        alternateCost: { ...FREE, energy: 3 },
        extraCosts: [],
        banishOnLeave: true,
      },
    ]);
  });

  it("offers no such zone while the card is in hand", () => {
    expect(playZonesFor(board(torch(), "hand"), "p1", "torch")).toEqual([
      { source: "hand" },
    ]);
  });

  /**
   * R829.1.c.1 — "an alternate cost that replaces the base cost", not a
   * discount on it and not a zero like the Facedown Zone's R356.1.b.
   */
  it("replaces the base cost rather than reducing it", () => {
    const state = board();

    expect(totalCostOf(state, "p1", "torch", {})).toEqual({
      ...FREE,
      energy: 5,
    });
    expect(
      totalCostOf(state, "p1", "torch", {
        alternateCost: { ...FREE, energy: 3 },
      }),
    ).toEqual({ ...FREE, energy: 3 });
  });

  it("pays the flow cost and does what the card says", () => {
    const after = resolve(board(), CAST_FROM_TRASH);

    expect(after.permanents.ogre?.damage).toBe(2);
    expect(seatOf(after, "p1").runePool.buckets[0]!.energy).toBe(6);
  });

  /** R829.1.b — "Then banish it", rather than back to the trash. */
  it("banishes it instead of trashing it on resolution", () => {
    const after = resolve(board(), CAST_FROM_TRASH);

    expect(seatOf(after, "p1").banished).toEqual(["torch"]);
    expect(seatOf(after, "p1").trash).toEqual([]);
  });

  it("still goes to the trash when it was played from hand", () => {
    const after = resolve(board(torch(), "hand"), CAST_FROM_TRASH);

    expect(seatOf(after, "p1").trash).toEqual(["torch"]);
    expect(seatOf(after, "p1").banished).toEqual([]);
  });

  /**
   * R829.1.b.1 replaces the spell *leaving the chain*, not its resolution. A
   * countered [Flow] spell never resolves and is banished all the same, which
   * is why both exits go through the one door.
   */
  it("banishes it when it is countered rather than resolved", () => {
    const defy: CardInstance = {
      id: "defy",
      name: "Defy",
      type: "spell",
      cost: FREE,
      keywords: ["reaction"],
      abilities: [
        {
          ...activated([], counterSpell()),
          targeting: { filters: [{ type: "spellOnChain", controller: "enemy" }] },
        },
      ],
    };
    const state = makeState({
      p1: { trash: ["torch"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { hand: ["defy"], mainDeck: ["b"], runePool: pool({ energy: 9 }) },
      cards: [torch(), defy, unit("ogre", { might: 9 }), unit("a"), unit("b")],
      permanents: [{ cardId: "ogre", controller: "p2" }],
    });

    let current = state;
    for (const action of [
      CAST_FROM_TRASH,
      // R337.4 — the caster holds priority; p2 only gets a window once it is
      // passed. R340.1 then resolves Defy first, LIFO.
      { type: "passPriority", playerId: "p1" },
      { type: "playSpell", playerId: "p2", cardId: "defy", targets: ["torch"] },
      { type: "passPriority", playerId: "p2" },
      { type: "passPriority", playerId: "p1" },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    expect(seatOf(current, "p1").banished).toEqual(["torch"]);
    expect(seatOf(current, "p1").trash).toEqual([]);
    // R370.1.a.1's shape — the trip to the trash never happened, and there is
    // no event for a thing that did not occur, so the replacement logs itself.
    expect(current.permanents.ogre?.damage ?? 0).toBe(0);
  });

  /**
   * R829.1.b.2 — "Playing a spell for its Flow cost does not change the timing
   * at which it can be played." Unlike the Facedown Zone, which grants
   * [Reaction] (R811.1.b), the trash grants nothing.
   */
  it("does not grant [Reaction] the way the facedown zone does", () => {
    const state = board();
    const opened = applyAction(state, {
      type: "playSpell",
      playerId: "p1",
      cardId: "torch",
      targets: ["ogre"],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // With the chain up, a spell without [Reaction] cannot be played (R813) —
    // being in the trash does not change that.
    const again = applyAction(opened.state, {
      type: "playSpell",
      playerId: "p1",
      cardId: "torch",
      targets: ["ogre"],
    });
    expect(again).toEqual({ ok: false, reason: "notInHand" });
  });

  /**
   * R829.1.c.3 — "If a spell has multiple instances of the Flow keyword with
   * different costs, its controller may choose which cost to apply."
   */
  describe("several flow costs (R829.1.c.3)", () => {
    const twoWays = () => torch([{ energy: 3 }, { energy: 1, anyPower: 2 }]);

    it("reads them all off the card", () => {
      expect(flowCostsOf(board(twoWays()), "torch")).toEqual([
        [{ kind: "pay", cost: { ...FREE, energy: 3 } }],
        [{ kind: "pay", cost: { ...FREE, energy: 1, anyPower: 2 } }],
      ]);
    });

    it("offers one way to play it per cost", () => {
      expect(playZonesFor(board(twoWays()), "p1", "torch")).toHaveLength(2);
    });

    it("charges whichever one was named", () => {
      const cheap = resolve(board(twoWays()), {
        ...CAST_FROM_TRASH,
        playFrom: 0,
      });
      expect(seatOf(cheap, "p1").runePool.buckets[0]!.energy).toBe(6);

      // The second costs [1][A][A], and the pool holds no Power at all.
      expect(
        applyAction(board(twoWays()), { ...CAST_FROM_TRASH, playFrom: 1 }),
      ).toEqual({ ok: false, reason: "cannotAffordCost" });
    });
  });

  /**
   * `legalActions` is the only legality authority — a Flow play it cannot
   * offer is one no player can find.
   */
  describe("finding a Flow play", () => {
    it("offers the card in the trash", () => {
      const moves = legalActions(board(), "p1").filter(
        (action) => action.type === "playSpell" && action.cardId === "torch",
      );

      expect(moves.length).toBeGreaterThan(0);
    });

    it("offers one play per flow cost", () => {
      const state = board(torch([{ energy: 3 }, { energy: 4 }]));
      const indices = legalActions(state, "p1")
        .filter(
          (action) => action.type === "playSpell" && action.cardId === "torch",
        )
        .map((action) => (action.type === "playSpell" ? action.playFrom : -1));

      expect(new Set(indices)).toEqual(new Set([0, 1]));
    });

    it("offers nothing that applyAction would refuse", () => {
      const state = board();
      for (const action of legalActions(state, "p1")) {
        expect(applyAction(state, action).ok).toBe(true);
      }
    });
  });
});
