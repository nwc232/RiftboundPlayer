import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  additionalCost,
  draw,
  gainXP,
  ifThen,
  paidAdditionalCost,
  ready,
  spell,
} from "../src/builders.js";
import { FREE, totals } from "../src/cost.js";
import { additionalCostsOf, totalCostOf } from "../src/costing.js";
import { legalActions } from "../src/legal.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/**
 * Pyke, Dockside Butcher — "You may pay [Fury] as an additional cost to play
 * me. When you play me, if you paid the additional cost, ready me and give me
 * +2 [M] this turn."
 */
const pyke: CardInstance = {
  ...unit("pyke", { might: 3, cost: { ...FREE, energy: 2 } }),
  name: "Pyke, Dockside Butcher",
  abilities: [
    additionalCost({ ...FREE, power: { fury: 1 } }),
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      requires: paidAdditionalCost,
      effect: ready(0),
      targeting: { count: 1, filter: { type: "unit", controller: "friendly" } },
    },
  ],
};

function board(card: CardInstance, energy = 9, fury = 1): GameState {
  return makeState({
    p1: {
      hand: [card.id],
      mainDeck: ["a", "b"],
      runePool: pool({ energy, power: { fury } }),
    },
    p2: { mainDeck: ["c"] },
    cards: [card, unit("a"), unit("b"), unit("c")],
  });
}

const PLAY = (cardId: string, payOptional: boolean): Action => ({
  type: "playUnitFromHand",
  playerId: "p1",
  cardId,
  payOptional,
});

/** R356.2.b — optional additional costs are declared while playing the card. */
describe("optional additional costs (R356.2.b)", () => {
  it("is not charged when it is not chosen", () => {
    expect(totalCostOf(board(pyke), "p1", "pyke")).toEqual({
      ...FREE,
      energy: 2,
    });
  });

  it("is added to the total cost when it is", () => {
    expect(
      totalCostOf(board(pyke), "p1", "pyke", { payOptional: true }),
    ).toEqual({ energy: 2, power: { fury: 1 }, anyPower: 0 });
  });

  it("actually charges it", () => {
    const paid = run(board(pyke), [PLAY("pyke", true)]);
    const free = run(board(pyke), [PLAY("pyke", false)]);

    expect(totals(paid.players.p1.runePool).power).toEqual({});
    expect(totals(free.players.p1.runePool).power).toEqual({ fury: 1 });
  });

  it("refuses the play when the extra cost cannot be met", () => {
    expect(applyAction(board(pyke, 9, 0), PLAY("pyke", true))).toEqual({
      ok: false,
      reason: "cannotAffordCost",
    });
  });

  it("refuses to pay one the card does not have", () => {
    const plain = unit("plain", { might: 1 });

    expect(applyAction(board(plain), PLAY("plain", true))).toEqual({
      ok: false,
      reason: "noAdditionalCost",
    });
  });

  /** R205 — the later clause checks whether the game action was performed. */
  it("records the payment so a later clause can check it", () => {
    const paid = run(board(pyke), [PLAY("pyke", true)]);
    const free = run(board(pyke), [PLAY("pyke", false)]);

    expect(paid.permanents.pyke?.paidAdditionalCost).toBe(true);
    expect(free.permanents.pyke?.paidAdditionalCost).toBeUndefined();
  });

  it("gates the play trigger on it (R383.2.a.1)", () => {
    expect(run(board(pyke), [PLAY("pyke", true)]).chain).toHaveLength(1);
    expect(run(board(pyke), [PLAY("pyke", false)]).chain).toHaveLength(0);
  });

  it("offers both plays only when the choice exists", () => {
    const withChoice = legalActions(board(pyke), "p1").filter(
      (action) => action.type === "playUnitFromHand",
    );
    expect(withChoice).toHaveLength(2);

    const without = legalActions(board(unit("plain")), "p1").filter(
      (action) => action.type === "playUnitFromHand",
    );
    expect(without).toHaveLength(1);
  });
});

/** R805.1.a — "you may pay [1][C] as an additional cost. If you do, I enter ready." */
describe("[Accelerate] (R805)", () => {
  const kaisa: CardInstance = {
    ...unit("kaisa", { might: 3, cost: { ...FREE, energy: 2 } }),
    name: "Kai'Sa, Survivor",
    keywords: ["accelerate"],
    domains: ["body"],
  };

  it("derives its cost from the keyword, in the card's own domain (R135.2.e.6.c)", () => {
    expect(additionalCostsOf(board(kaisa), "kaisa")).toEqual([
      { optional: true, cost: { energy: 1, power: { body: 1 }, anyPower: 0 } },
    ]);
  });

  it("enters ready when the cost is paid, exhausted when it is not", () => {
    const state = makeState({
      p1: {
        hand: ["kaisa"],
        mainDeck: ["a"],
        runePool: pool({ energy: 9, power: { body: 1 } }),
      },
      cards: [kaisa, unit("a")],
    });

    expect(run(state, [PLAY("kaisa", true)]).permanents.kaisa?.exhausted).toBe(
      false,
    );
    expect(run(state, [PLAY("kaisa", false)]).permanents.kaisa?.exhausted).toBe(
      true,
    );
  });

  /** R135.2.e.6.c — a multi-domain card's [C] is any of its domains. */
  it("falls back to [A] for a multi-domain card", () => {
    const dual: CardInstance = { ...kaisa, id: "dual", domains: ["body", "fury"] };

    expect(additionalCostsOf(board(dual), "dual")).toEqual([
      { optional: true, cost: { energy: 1, power: {}, anyPower: 1 } },
    ]);
  });
});

/**
 * Rampage — "As you play this, you may pay [Body] as an additional cost… If
 * you paid the additional cost, give the friendly unit +2 [M] this turn."
 */
describe("a spell's additional cost", () => {
  const rampage: CardInstance = {
    ...spell("rampage", "Rampage", { ...FREE, energy: 1 }, draw(1)),
    abilities: [
      additionalCost({ ...FREE, power: { body: 1 } }),
      {
        kind: "activated",
        timing: "default",
        costs: [],
        effect: ifThen(paidAdditionalCost, draw(2), draw(1)),
      },
    ],
  };

  function spellBoard(body: number): GameState {
    return makeState({
      p1: {
        hand: ["rampage"],
        mainDeck: ["a", "b", "c"],
        runePool: pool({ energy: 9, power: { body } }),
      },
      p2: { mainDeck: ["d"] },
      cards: [rampage, unit("a"), unit("b"), unit("c"), unit("d")],
    });
  }

  const CAST = (payOptional: boolean): Action[] => [
    { type: "playSpell", playerId: "p1", cardId: "rampage", targets: [], payOptional },
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p2" },
  ];

  it("carries the payment through to resolution", () => {
    expect(run(spellBoard(1), CAST(true)).players.p1.hand).toEqual(["a", "b"]);
    expect(run(spellBoard(1), CAST(false)).players.p1.hand).toEqual(["a"]);
  });
});

/** R728–733 — XP is a plain number on the player. */
describe("XP (R730)", () => {
  it("accrues on the controller", () => {
    const state = makeState({ cards: [unit("source")] });

    const after = execute(state, gainXP(2), {
      controller: "p1",
      sourceId: "source",
      targets: [],
    });

    expect(after.state.players.p1.xp).toBe(2);
    expect(after.state.players.p2.xp).toBe(0);
    expect(after.events).toEqual([
      { type: "xpGained", playerId: "p1", amount: 2 },
    ]);
  });

  /** R733 — "There is no limit to an amount of XP a player can accrue." */
  it("has no ceiling", () => {
    let state = makeState({ cards: [unit("source")] });
    for (let i = 0; i < 5; i += 1) {
      state = execute(state, gainXP(3), {
        controller: "p1",
        sourceId: "source",
        targets: [],
      }).state;
    }

    expect(state.players.p1.xp).toBe(15);
  });
});
