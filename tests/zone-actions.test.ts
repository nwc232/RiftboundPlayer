import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  activated,
  burn,
  dealDamage,
  discard,
  discardCost,
  draw,
} from "../src/builders.js";
import { VICTORY_SCORE } from "../src/scoring.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const context = (targets: string[] = []): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

function board(options: {
  p1Hand?: string[];
  p2Hand?: string[];
  p1Deck?: string[];
  p1Trash?: string[];
}): GameState {
  const ids = [
    ...(options.p1Hand ?? []),
    ...(options.p2Hand ?? []),
    ...(options.p1Deck ?? []),
    ...(options.p1Trash ?? []),
  ];
  return makeState({
    p1: {
      hand: options.p1Hand ?? [],
      mainDeck: options.p1Deck ?? ["d1"],
      trash: options.p1Trash ?? [],
    },
    p2: { hand: options.p2Hand ?? [], mainDeck: ["e1"] },
    cards: [...new Set([...ids, "d1", "e1"])].map((id) => unit(id)),
  });
}

/** R422 — "Discard X": hand straight to trash, rules text never executed. */
describe("discarding (R422)", () => {
  it("asks the discarding player which cards", () => {
    const after = execute(
      board({ p1Hand: ["a", "b", "c"] }),
      discard(1),
      context(),
    );

    expect(after.pause?.decision).toEqual({
      player: "p1",
      prompt: { kind: "chooseFromRevealed", legal: ["a", "b", "c"], keep: 1 },
    });
  });

  it("moves the chosen cards to that player's trash", () => {
    const paused = execute(board({ p1Hand: ["a", "b"] }), discard(1), context());
    const done = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: ["b"],
    });

    expect(seatOf(done.state, "p1").hand).toEqual(["a"]);
    expect(seatOf(done.state, "p1").trash).toEqual(["b"]);
    expect(done.events).toEqual([
      { type: "cardDiscarded", playerId: "p1", cardId: "b" },
    ]);
  });

  /**
   * R422.1.a — "the player who is performing the action chooses which cards to
   * send to their Trash", so "Choose a player. They discard 1" asks *them*,
   * not the player who cast it.
   */
  it("asks the opponent when the opponent is the one discarding", () => {
    const after = execute(
      board({ p1Hand: ["a"], p2Hand: ["x", "y"] }),
      discard(1, 0),
      context(["p2"]),
    );

    expect(after.pause?.decision.player).toBe("p2");
    expect(after.pause?.decision.prompt).toEqual({
      kind: "chooseFromRevealed",
      legal: ["x", "y"],
      keep: 1,
    });
  });

  /**
   * R422.4 — "a player must Discard as many cards as possible. If instructed
   * to discard more than they have, further discard instructions are ignored."
   */
  it("discards as many as it can, and asks nothing when that is all of them", () => {
    const after = execute(board({ p1Hand: ["a"] }), discard(3), context());

    expect(after.pause).toBeUndefined();
    expect(seatOf(after.state, "p1").hand).toEqual([]);
    expect(seatOf(after.state, "p1").trash).toEqual(["a"]);
  });

  it("does nothing at all on an empty hand", () => {
    const after = execute(board({ p1Hand: [] }), discard(2), context());

    expect(after.pause).toBeUndefined();
    expect(after.events).toEqual([]);
  });
});

/** R440 — "[Burn X]": the top X of a Main Deck into that player's trash. */
describe("burning (R440)", () => {
  it("moves cards from the top of the deck to the trash", () => {
    const after = execute(
      board({ p1Deck: ["a", "b", "c"] }),
      burn(2),
      context(),
    );

    expect(seatOf(after.state, "p1").mainDeck).toEqual(["c"]);
    expect(seatOf(after.state, "p1").trash).toEqual(["a", "b"]);
    expect(after.events).toEqual([
      { type: "cardBurned", playerId: "p1", cardId: "a" },
      { type: "cardBurned", playerId: "p1", cardId: "b" },
    ]);
  });

  it("burns a chosen player's deck", () => {
    const state = makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["x", "y"] },
      cards: ["a", "x", "y"].map((id) => unit(id)),
    });

    const after = execute(state, burn(1, 0), context(["p2"]));

    expect(seatOf(after.state, "p2").mainDeck).toEqual(["y"]);
    expect(seatOf(after.state, "p2").trash).toEqual(["x"]);
  });

  /**
   * R440.4 — "if instructed to burn more cards than they have in their main
   * deck, they burn that many cards, burn out and then burn the rest." R431
   * recycles the trash back into the deck, so the burn continues into it.
   */
  it("burns out partway through and carries on", () => {
    const after = execute(
      board({ p1Deck: ["a"], p1Trash: ["old"] }),
      burn(2),
      context(),
    );

    const types = after.events.map((event) => event.type);
    expect(types).toContain("cardBurned");
    expect(types).toContain("burnedOut");
    // R431 — the burn-out handed the opponent a point on the way past.
    expect(seatOf(after.state, "p2").points).toBe(1);
    // "old" was recycled into the deck by the burn out, then burned itself.
    expect(seatOf(after.state, "p1").trash).toEqual(["old"]);
  });

  it("stops rather than looping when there is nothing left anywhere", () => {
    const after = execute(board({ p1Deck: [], p1Trash: [] }), burn(3), context());

    expect(seatOf(after.state, "p1").mainDeck).toEqual([]);
    expect(seatOf(after.state, "p2").points).toBeLessThanOrEqual(VICTORY_SCORE);
  });
});

/** R422.3 — as a *cost*, discarding must be completable or it is not paid. */
describe("discarding as a cost (R422.3)", () => {
  const forge: CardInstance = {
    ...unit("forge", { might: 2 }),
    abilities: [{ ...activated([discardCost(2)], draw(1)) }],
  };

  function costBoard(hand: string[]): GameState {
    return makeState({
      p1: { hand, mainDeck: ["d1", "d2"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["e1"] },
      cards: [forge, ...hand, "d1", "d2", "e1"].map((each) =>
        typeof each === "string" ? unit(each) : each,
      ),
      permanents: [{ cardId: "forge", controller: "p1" }],
    });
  }

  const use = (costChoices: string[][]): Action => ({
    type: "activateAbility",
    playerId: "p1",
    sourceId: "forge",
    abilityIndex: 0,
    costChoices,
  });

  it("pays with two cards and does the thing", () => {
    const result = applyAction(costBoard(["a", "b"]), use([["a", "b"]]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(seatOf(result.state, "p1").trash).toEqual(["a", "b"]);
    expect(seatOf(result.state, "p1").hand).toEqual(["d1"]);
  });

  /** Unlike R422.4's effect, a cost of Discard 2 with one card cannot be paid. */
  it("cannot be paid from a short hand", () => {
    expect(applyAction(costBoard(["a"]), use([["a"]]))).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });
});

/** R442 — removing the Empowered status. */
describe("disempowering (R442)", () => {
  function empoweredBoard(empowered: boolean): GameState {
    const base = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [unit("hero", { might: 3 }), unit("a"), unit("b")],
      permanents: [{ cardId: "hero", controller: "p1" }],
    });
    return empowered
      ? {
          ...base,
          permanents: {
            ...base.permanents,
            hero: { ...base.permanents.hero!, empowered: true as const },
          },
        }
      : base;
  }

  it("removes the status", () => {
    const after = execute(
      empoweredBoard(true),
      { op: "disempower", targetIndex: 0 },
      context(["hero"]),
    );

    expect(after.state.permanents.hero?.empowered).toBeUndefined();
    expect(after.events).toEqual([
      { type: "disempowered", playerId: "p1", cardId: "hero" },
    ]);
  });

  /** R442.1.a.1 — "will do nothing" rather than failing. */
  it("does nothing to something that is not Empowered", () => {
    const after = execute(
      empoweredBoard(false),
      { op: "disempower", targetIndex: 0 },
      context(["hero"]),
    );

    expect(after.events).toEqual([]);
  });

  /** As a *cost*, though, an unempowered source simply cannot pay. */
  describe("as an ability cost", () => {
    const engine: CardInstance = {
      ...unit("hero", { might: 3 }),
      abilities: [
        { ...activated([{ kind: "disempowerSelf" }], dealDamage(2, 0)) },
      ],
    };

    function board(empowered: boolean): GameState {
      const base = empoweredBoard(empowered);
      return { ...base, cards: { ...base.cards, hero: engine } };
    }

    const USE: Action = {
      type: "activateAbility",
      playerId: "p1",
      sourceId: "hero",
      abilityIndex: 0,
    };

    it("spends the status", () => {
      const result = applyAction(board(true), USE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.permanents.hero?.empowered).toBeUndefined();
    });

    it("cannot be paid while unempowered", () => {
      expect(applyAction(board(false), USE)).toEqual({
        ok: false,
        reason: "cannotPayAbilityCost",
      });
    });
  });
});
