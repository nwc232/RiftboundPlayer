import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  activated,
  buff,
  dealDamage,
  draw,
  modifyMight,
  recycleFromHand,
} from "../src/builders.js";
import { legalActions } from "../src/legal.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const context = (): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets: [],
});

/** R416 — "Recycle N cards from your hand": to the bottom of the Main Deck. */
describe("recycling from hand (R416)", () => {
  function board(hand: string[], deck: string[] = ["d1", "d2"]): GameState {
    return makeState({
      p1: { hand, mainDeck: deck },
      cards: [...hand, ...deck].map((id) => unit(id)),
    });
  }

  it("asks which cards to recycle", () => {
    const after = execute(board(["a", "b", "c"]), recycleFromHand(1), context());

    expect(after.pause?.decision.prompt).toEqual({
      kind: "chooseFromRevealed",
      legal: ["a", "b", "c"],
      keep: 1,
    });
    // R370.1.c's spirit — nothing has moved while the question stands.
    expect(after.state.players.p1.hand).toEqual(["a", "b", "c"]);
  });

  it("puts the chosen cards on the bottom", () => {
    const paused = execute(board(["a", "b", "c"]), recycleFromHand(1), context());
    const done = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: ["b"],
    });

    expect(done.state.players.p1.hand).toEqual(["a", "c"]);
    expect(done.state.players.p1.mainDeck).toEqual(["d1", "d2", "b"]);
    expect(done.events).toEqual([
      { type: "cardRecycled", playerId: "p1", cardId: "b" },
    ]);
  });

  it("does not ask when the whole hand is going", () => {
    const after = execute(board(["a", "b"]), recycleFromHand(2), context());

    expect(after.pause).toBeUndefined();
    expect(after.state.players.p1.hand).toEqual([]);
    expect(after.state.players.p1.mainDeck).toEqual(["d1", "d2", "a", "b"]);
  });

  it("recycles as many as there are, and nothing on an empty hand", () => {
    const short = execute(board(["a"]), recycleFromHand(3), context());
    expect(short.state.players.p1.hand).toEqual([]);

    const none = execute(board([]), recycleFromHand(2), context());
    expect(none.pause).toBeUndefined();
    expect(none.events).toEqual([]);
  });
});

/** R728 — "Spend 3 XP, [exhaust]: Draw 1." */
describe("spending XP as a cost", () => {
  const sage: CardInstance = {
    ...unit("sage", { might: 2 }),
    abilities: [
      { ...activated([{ kind: "spendXP", amount: 3 }], draw(1)) },
    ],
  };

  function board(xp: number): GameState {
    const base = makeState({
      p1: { mainDeck: ["a", "b"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["c"] },
      cards: [sage, unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "sage", controller: "p1" }],
    });
    return { ...base, players: { ...base.players, p1: { ...base.players.p1, xp } } };
  }

  const USE: Action = {
    type: "activateAbility",
    playerId: "p1",
    sourceId: "sage",
    abilityIndex: 0,
  };

  it("spends the XP and does the thing", () => {
    const result = applyAction(board(5), USE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.players.p1.xp).toBe(2);
    expect(result.state.players.p1.hand).toEqual(["a"]);
  });

  it("cannot be paid without the XP", () => {
    expect(applyAction(board(2), USE)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });

  it("is not offered when it cannot be paid", () => {
    const offered = (state: GameState) =>
      legalActions(state, "p1").some(
        (action) =>
          action.type === "activateAbility" && action.sourceId === "sage",
      );

    expect(offered(board(5))).toBe(true);
    expect(offered(board(2))).toBe(false);
  });
});

/** R701–705 — "Spend my buff: give me +4 [M] this turn." */
describe("spending a buff as a cost", () => {
  const brute: CardInstance = {
    ...unit("brute", { might: 3 }),
    abilities: [
      {
        ...activated([{ kind: "spendBuff" }], modifyMight(4, "thisTurn")),
        targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      },
    ],
  };

  function board(buffed: boolean): GameState {
    const base = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [brute, unit("a"), unit("b")],
      permanents: [{ cardId: "brute", controller: "p1" }],
    });
    return buffed
      ? {
          ...base,
          permanents: {
            ...base.permanents,
            brute: { ...base.permanents.brute!, buffed: true as const },
          },
        }
      : base;
  }

  const USE: Action = {
    type: "activateAbility",
    playerId: "p1",
    sourceId: "brute",
    abilityIndex: 0,
    targets: ["brute"],
  };

  it("consumes the buff", () => {
    const result = applyAction(board(true), USE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.permanents.brute?.buffed).toBeUndefined();
  });

  it("cannot be paid by an unbuffed source", () => {
    expect(applyAction(board(false), USE)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });
});

/** "Use only once per turn." */
describe("an activation limited per turn", () => {
  const well: CardInstance = {
    ...unit("well", { might: 1 }),
    abilities: [{ ...activated([], draw(1)), usesPerTurn: 1 }],
  };

  function board(): GameState {
    return makeState({
      p1: { mainDeck: ["a", "b", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["d"] },
      cards: [well, unit("a"), unit("b"), unit("c"), unit("d")],
      permanents: [{ cardId: "well", controller: "p1" }],
    });
  }

  const USE: Action = {
    type: "activateAbility",
    playerId: "p1",
    sourceId: "well",
    abilityIndex: 0,
  };

  it("works once", () => {
    const result = applyAction(board(), USE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.hand).toEqual(["a"]);
  });

  it("refuses the second use in the same turn", () => {
    const first = applyAction(board(), USE);
    if (!first.ok) throw new Error("rejected");

    expect(applyAction(first.state, USE)).toEqual({
      ok: false,
      reason: "abilityNotFound",
    });
  });

  it("stops being offered once it is spent", () => {
    const offered = (state: GameState) =>
      legalActions(state, "p1").some(
        (action) =>
          action.type === "activateAbility" && action.sourceId === "well",
      );

    const first = applyAction(board(), USE);
    if (!first.ok) throw new Error("rejected");

    expect(offered(board())).toBe(true);
    expect(offered(first.state)).toBe(false);
  });

  /** R383.3.e's tally is cleared as each turn opens, and this shares it. */
  it("comes back next turn", () => {
    const first = applyAction(board(), USE);
    if (!first.ok) throw new Error("rejected");

    const nextTurn: GameState = { ...first.state, triggeredThisTurn: {} };
    expect(applyAction(nextTurn, USE).ok).toBe(true);
  });
});
