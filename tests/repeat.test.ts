import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { shiftTargets } from "../src/abilities.js";
import type { Effect } from "../src/abilities.js";
import {
  activated,
  controlsOtherUnits,
  dealDamage,
  discardCost,
  draw,
  ifThen,
  lookAtTop,
  repeat,
  seq,
} from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { repeatCostsOf, totalCostOf } from "../src/costing.js";
import { legalActions } from "../src/legal.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Piercing Light — "[Repeat] [2][Fury]. Deal 2 to a unit at a battlefield." */
function bolt(cost = { energy: 1 }, repeats = [{ energy: 2 }]): CardInstance {
  return {
    id: "bolt",
    name: "Piercing Light",
    type: "spell",
    cost: { ...FREE, ...cost },
    keywords: [],
    abilities: [
      {
        ...activated([], dealDamage(2)),
        targeting: { filters: [{ type: "unit", controller: "enemy" }] },
      },
      ...repeats.map((each) => repeat(each)),
    ],
  };
}

function board(card: CardInstance, energy = 20): GameState {
  return makeState({
    p1: { hand: [card.id], mainDeck: ["a", "b", "c"], runePool: pool({ energy }) },
    p2: { mainDeck: ["d"] },
    cards: [
      card,
      unit("ogre", { might: 9 }),
      unit("imp", { might: 9 }),
      ...["a", "b", "c", "d"].map((id) => unit(id)),
    ],
    permanents: [
      { cardId: "ogre", controller: "p2" },
      { cardId: "imp", controller: "p2" },
    ],
  });
}

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

/**
 * R820.1.d — "You may pay [Cost] as an additional cost as you play this. If you
 * do, execute the instructions of this chain item one additional time."
 */
describe("[Repeat] (R820)", () => {
  it("costs nothing extra when it is not paid", () => {
    const state = board(bolt());

    expect(totalCostOf(state, "p1", "bolt", {})).toEqual({ ...FREE, energy: 1 });
    // R820.1.c.1 — the Repeat cost is an Additional Cost, so it lands in
    // R356's step 2 on top of the base cost rather than replacing it.
    expect(totalCostOf(state, "p1", "bolt", { payRepeats: [0] })).toEqual({
      ...FREE,
      energy: 3,
    });
  });

  it("runs the instructions twice when it is paid", () => {
    const once = resolve(board(bolt()), {
      type: "playSpell",
      playerId: "p1",
      cardId: "bolt",
      targets: ["ogre"],
    });
    expect(once.permanents.ogre?.damage).toBe(2);

    const twice = resolve(board(bolt()), {
      type: "playSpell",
      playerId: "p1",
      cardId: "bolt",
      targets: ["ogre", "ogre"],
      payRepeats: [0],
    });
    expect(twice.permanents.ogre?.damage).toBe(4);
  });

  /** R820.2.a — "may choose the same target or a different one". */
  it("lets the second execution choose someone else", () => {
    const after = resolve(board(bolt()), {
      type: "playSpell",
      playerId: "p1",
      cardId: "bolt",
      targets: ["ogre", "imp"],
      payRepeats: [0],
    });

    expect(after.permanents.ogre?.damage).toBe(2);
    expect(after.permanents.imp?.damage).toBe(2);
  });

  /** R820.3.a — however many times it executes, it was Played once. */
  it("goes to the trash once and counts as one play", () => {
    const after = resolve(board(bolt()), {
      type: "playSpell",
      playerId: "p1",
      cardId: "bolt",
      targets: ["ogre", "imp"],
      payRepeats: [0],
    });

    expect(seatOf(after, "p1").trash).toEqual(["bolt"]);
    expect(after.playedThisTurn.p1).toEqual(["bolt"]);
  });

  it("wants one set of targets per execution", () => {
    const state = board(bolt());

    expect(
      applyAction(state, {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["ogre"],
        payRepeats: [0],
      }),
    ).toEqual({ ok: false, reason: "wrongTargetCount" });
  });

  /** R820.1.c.3 — "Each Repeat Cost can be paid only a single time." */
  it("refuses to pay one Repeat cost twice", () => {
    const state = board(bolt());

    expect(
      applyAction(state, {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["ogre", "ogre"],
        payRepeats: [0, 0],
      }),
    ).toEqual({ ok: false, reason: "noAdditionalCost" });
  });

  it("refuses a Repeat cost the card does not have", () => {
    const state = board(bolt());

    expect(
      applyAction(state, {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["ogre", "ogre"],
        payRepeats: [1],
      }),
    ).toEqual({ ok: false, reason: "noAdditionalCost" });
  });

  it("still needs the money", () => {
    const state = board(bolt(), 2);

    expect(
      applyAction(state, {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["ogre", "ogre"],
        payRepeats: [0],
        costChoices: [[]],
      }),
    ).toEqual({ ok: false, reason: "cannotAffordCost" });
  });

  /**
   * R820.1.c.2 — Curtain Call prints three Repeat costs and says "you may pay
   * each additional cost". Which subset is paid is the answer, not a count:
   * the costs differ from each other.
   */
  describe("several instances (R820.1.c.2)", () => {
    const three = () =>
      bolt({ energy: 1 }, [{ energy: 1 }, { energy: 2 }, { energy: 4 }]);

    it("reads them all off the card in printed order", () => {
      expect(repeatCostsOf(board(three()), "bolt")).toEqual([
        [{ kind: "pay", cost: { ...FREE, energy: 1 } }],
        [{ kind: "pay", cost: { ...FREE, energy: 2 } }],
        [{ kind: "pay", cost: { ...FREE, energy: 4 } }],
      ]);
    });

    it("prices the subset chosen, not the number of them", () => {
      const state = board(three());

      expect(totalCostOf(state, "p1", "bolt", { payRepeats: [0] })).toEqual({
        ...FREE,
        energy: 2,
      });
      expect(totalCostOf(state, "p1", "bolt", { payRepeats: [2] })).toEqual({
        ...FREE,
        energy: 5,
      });
      expect(totalCostOf(state, "p1", "bolt", { payRepeats: [0, 2] })).toEqual({
        ...FREE,
        energy: 6,
      });
    });

    /** R820.3 — "executed an additional time … for each instance paid for." */
    it("executes once more for each instance paid", () => {
      const after = resolve(board(three()), {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["ogre", "ogre", "ogre"],
        payRepeats: [0, 2],
      });

      expect(after.permanents.ogre?.damage).toBe(6);
    });
  });

  /**
   * R820.2's real cost: an execution can stop mid-way to ask. The second must
   * wait for the first to be answered rather than running past it, which is
   * exactly what a `seq` of executions buys.
   */
  it("waits for a question raised by the first execution", () => {
    // Double Trouble — "[Repeat] [2]. Look at the top 3 … put 1 in your hand."
    const stacked: CardInstance = {
      id: "stacked",
      name: "Double Trouble",
      type: "spell",
      cost: FREE,
      keywords: [],
      abilities: [activated([], lookAtTop(3, 1)), repeat({ energy: 1 })],
    };
    const state = makeState({
      p1: {
        hand: ["stacked"],
        mainDeck: ["a", "b", "c", "d", "e"],
        runePool: pool({ energy: 5 }),
      },
      p2: { mainDeck: ["z"] },
      cards: [stacked, ...["a", "b", "c", "d", "e", "z"].map((id) => unit(id))],
    });

    let current = state;
    for (const action of [
      {
        type: "playSpell",
        playerId: "p1",
        cardId: "stacked",
        payRepeats: [0],
      },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    // The first execution is asking; the second has not touched the deck.
    expect(current.pending?.prompt).toEqual({
      kind: "chooseFromRevealed",
      legal: ["a", "b", "c"],
      keep: 1,
    });
    expect(seatOf(current, "p1").hand).toEqual([]);

    const answered = applyAction(current, {
      type: "decide",
      playerId: "p1",
      targets: ["b"],
    });
    if (!answered.ok) throw new Error("rejected");

    // Only now does the second execution look, and at what is left.
    expect(seatOf(answered.state, "p1").hand).toEqual(["b"]);
    expect(answered.state.pending?.prompt).toEqual({
      kind: "chooseFromRevealed",
      legal: ["d", "e", "a"],
      keep: 1,
    });
  });
});

/**
 * R820.1.c.2 — "Repeat costs may include both resource costs and non-resource
 * costs." Square Up prints "[Repeat] — Discard 1", which is the whole reason a
 * cost keyword carries an `AbilityCost[]` rather than a bare resource amount.
 */
describe("a non-resource Repeat cost (R820.1.c.2)", () => {
  const squareUp = (): CardInstance => ({
    id: "bolt",
    name: "Square Up",
    type: "spell",
    cost: FREE,
    keywords: [],
    abilities: [
      {
        ...activated([], dealDamage(2)),
        targeting: { filters: [{ type: "unit", controller: "enemy" }] },
      },
      repeat(discardCost()),
    ],
  });

  function handOf(cards: string[]): GameState {
    const card = squareUp();
    return makeState({
      p1: {
        hand: [card.id, ...cards],
        mainDeck: ["a"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["b"] },
      cards: [
        card,
        unit("ogre", { might: 9 }),
        unit("a"),
        unit("b"),
        ...cards.map((id) => unit(id)),
      ],
      permanents: [{ cardId: "ogre", controller: "p2" }],
    });
  }

  it("costs nothing in resources", () => {
    expect(totalCostOf(handOf(["x"]), "p1", "bolt", { payRepeats: [0] })).toEqual(
      FREE,
    );
  });

  it("pays it by discarding, and repeats", () => {
    const after = resolve(handOf(["x"]), {
      type: "playSpell",
      playerId: "p1",
      cardId: "bolt",
      targets: ["ogre", "ogre"],
      payRepeats: [0],
      costChoices: [["x"]],
    });

    expect(seatOf(after, "p1").trash).toContain("x");
    expect(after.permanents.ogre?.damage).toBe(4);
  });

  /** R422.3 — a cost that cannot be completed is not paid. */
  it("cannot be paid with nothing to discard", () => {
    expect(
      applyAction(handOf([]), {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["ogre", "ogre"],
        payRepeats: [0],
      }),
    ).toEqual({ ok: false, reason: "cannotAffordCost" });
  });

  it("is still playable without paying it", () => {
    const after = resolve(handOf([]), {
      type: "playSpell",
      playerId: "p1",
      cardId: "bolt",
      targets: ["ogre"],
    });

    expect(after.permanents.ogre?.damage).toBe(2);
  });
});

/**
 * A general property of the queue, found by building [Repeat] on top of it: an
 * effect that stops to ask *twice* has to keep the rest of itself both times.
 * `runTasks` used to rebuild the queue from the tasks that were there before
 * the head ran, which threw away the continuation the second pause enqueued —
 * so the tail of the effect silently never happened.
 */
describe("an effect that asks twice", () => {
  it("keeps the rest of itself across both questions", () => {
    const twice: CardInstance = {
      id: "twice",
      name: "Twice Over",
      type: "spell",
      cost: FREE,
      keywords: [],
      abilities: [activated([], seq(lookAtTop(3, 1), lookAtTop(3, 1)))],
    };
    const state = makeState({
      p1: {
        hand: ["twice"],
        mainDeck: ["a", "b", "c", "d", "e"],
        runePool: pool({ energy: 1 }),
      },
      p2: { mainDeck: ["z"] },
      cards: [twice, ...["a", "b", "c", "d", "e", "z"].map((id) => unit(id))],
    });

    let current = state;
    for (const action of [
      { type: "playSpell", playerId: "p1", cardId: "twice" },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
      { type: "decide", playerId: "p1", targets: ["b"] },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    // The second look is asking, rather than the effect having ended quietly.
    expect(current.pending?.prompt).toEqual({
      kind: "chooseFromRevealed",
      legal: ["d", "e", "a"],
      keep: 1,
    });

    const done = applyAction(current, {
      type: "decide",
      playerId: "p1",
      targets: ["e"],
    });
    if (!done.ok) throw new Error("rejected");
    expect(seatOf(done.state, "p1").hand).toEqual(["b", "e"]);
  });
});

/**
 * The transform that makes a repeat possible without a second context: since
 * abilities are data, "aim these instructions at a later set of choices" is a
 * rewrite of the indices.
 */
describe("shifting an effect's target indices", () => {
  it("walks nested effects and leaves everything else alone", () => {
    const effect: Effect = seq(
      dealDamage(2, 0),
      ifThen(controlsOtherUnits(1), dealDamage(3, 1), draw(2)),
    );

    expect(shiftTargets(effect, 2)).toEqual(
      seq(
        dealDamage(2, 2),
        ifThen(controlsOtherUnits(1), dealDamage(3, 3), draw(2)),
      ),
    );
  });

  it("is the identity at zero", () => {
    const effect: Effect = seq(dealDamage(2, 0), draw(1));
    expect(shiftTargets(effect, 0)).toBe(effect);
  });
});

/**
 * `legalActions` is the only legality authority. A Repeat nobody can be
 * offered is a Repeat nobody can play — the same shape of gap as the
 * two-target spell the CLI playthrough turned up.
 */
describe("finding a Repeat", () => {
  it("offers the play both with and without the cost paid", () => {
    const moves = legalActions(board(bolt()), "p1").filter(
      (action) => action.type === "playSpell" && action.cardId === "bolt",
    );

    const paid = moves.filter(
      (action) =>
        action.type === "playSpell" && (action.payRepeats ?? []).length === 1,
    );
    const unpaid = moves.filter(
      (action) =>
        action.type === "playSpell" && (action.payRepeats ?? []).length === 0,
    );

    expect(unpaid.length).toBeGreaterThan(0);
    expect(paid.length).toBeGreaterThan(0);
    // R820.2.a — the two executions are offered independently, so hitting the
    // same unit twice and hitting two different ones are both on the list.
    const paidTargets = paid.map((action) =>
      action.type === "playSpell" ? action.targets : [],
    );
    expect(paidTargets).toContainEqual(["ogre", "ogre"]);
    expect(paidTargets).toContainEqual(["ogre", "imp"]);
  });

  it("offers nothing that applyAction would refuse", () => {
    const state = board(bolt());
    for (const action of legalActions(state, "p1")) {
      expect(applyAction(state, action).ok).toBe(true);
    }
  });
});
