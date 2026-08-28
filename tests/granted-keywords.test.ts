import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  activated,
  dealDamage,
  grantCostKeyword,
  passive,
} from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { flowCostsOf, repeatCostsOf } from "../src/costing.js";
import { abilitiesOf, characteristicsOf } from "../src/layers.js";
import { playZonesFor } from "../src/zones.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * R820.4 / R829.2 / R827.4 — [Repeat], [Flow] and [Empower] are
 * characteristics, so a granted one has to count for as much as a printed one.
 * They cannot ride in the keyword set: the value each carries is a `Cost`.
 */
describe("keywords whose value is a Cost", () => {
  /** Syndra, Transcendent — "your spells have [Repeat] [2][Chaos]". */
  const syndra: CardInstance = {
    ...unit("syndra", { might: 4 }),
    abilities: [
      passive(
        { target: "friendlyUnits" },
        grantCostKeyword("repeat", { energy: 2 }),
      ),
    ],
  };

  function board(extra: CardInstance[] = []): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [syndra, unit("ally", { might: 2 }), unit("a"), unit("b"), ...extra],
      permanents: [
        { cardId: "syndra", controller: "p1" },
        { cardId: "ally", controller: "p1" },
      ],
    });
  }

  it("grants a Repeat cost that reads like a printed one", () => {
    expect(repeatCostsOf(board(), "ally")).toEqual([{ ...FREE, energy: 2 }]);
  });

  it("leaves a card the passive does not reach alone", () => {
    const state = board();
    const theirs: GameState = {
      ...state,
      permanents: {
        ...state.permanents,
        ally: { ...state.permanents.ally!, controller: "p2" },
      },
    };

    expect(repeatCostsOf(theirs, "ally")).toEqual([]);
  });

  /** R820.1.c.2 — instances are independent, so a grant stacks on a print. */
  it("stacks a granted instance onto a printed one", () => {
    const printed: CardInstance = {
      ...unit("ally", { might: 2 }),
      abilities: [{ kind: "repeat", cost: { ...FREE, energy: 5 } }],
    };
    const state = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [syndra, printed, unit("a"), unit("b")],
      permanents: [
        { cardId: "syndra", controller: "p1" },
        { cardId: "ally", controller: "p1" },
      ],
    });

    expect(repeatCostsOf(state, "ally")).toEqual([
      { ...FREE, energy: 5 },
      { ...FREE, energy: 2 },
    ]);
  });

  /** Kennen — "give it [Flow] equal to its cost this turn". */
  it("grants a Flow cost, which opens the trash as a play zone", () => {
    const spell: CardInstance = {
      id: "bolt",
      name: "bolt",
      type: "spell",
      cost: { ...FREE, energy: 5 },
      keywords: [],
      abilities: [activated([], dealDamage(2))],
    };
    const state = makeState({
      p1: { trash: ["bolt"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [spell, unit("a"), unit("b")],
    });

    // Nothing in the trash to play yet.
    expect(playZonesFor(state, "p1", "bolt")).toEqual([]);

    const granted: GameState = {
      ...state,
      modifiers: [
        {
          id: "m1",
          targetId: "bolt",
          duration: "thisTurn",
          modification: grantCostKeyword("flow", { energy: 3 }),
        },
      ],
    };

    expect(flowCostsOf(granted, "bolt")).toEqual([{ ...FREE, energy: 3 }]);
    // And the trash becomes a zone it can be played from, at the granted cost.
    expect(playZonesFor(granted, "p1", "bolt")).toEqual([
      {
        source: "trash",
        alternateCost: { ...FREE, energy: 3 },
        banishOnLeave: true,
      },
    ]);
  });

  /** R827.3 — several [Empower]s are "equivalent to multiple activated abilities". */
  it("grants an Empower, which becomes a real activated ability", () => {
    const state = board();
    const granted: GameState = {
      ...state,
      modifiers: [
        {
          id: "m1",
          targetId: "ally",
          duration: "thisTurn",
          modification: grantCostKeyword("empower", { energy: 1 }),
        },
      ],
    };

    expect(abilitiesOf(granted, "ally")).toContainEqual({
      kind: "activated",
      timing: "default",
      costs: [{ kind: "pay", cost: { ...FREE, energy: 1 } }],
      effect: { op: "empowerSelf" },
      when: { kind: "notEmpowered" },
    });
  });
});

/**
 * R817.2 and R821.1.c.7 both say multiple instances trigger separately, which
 * is what separates them from R819.2's Quick-Draw and R816.2's Temporary.
 */
describe("keyword multiplicity", () => {
  /** Forecaster — "your Mechs have [Vision]", on a Mech that prints it too. */
  const forecaster: CardInstance = {
    ...unit("forecaster", { might: 2, tags: ["Mech"], keywords: ["vision"] }),
    abilities: [
      passive({ target: "friendlyUnits", tag: "Mech" }, {
        layer: "ability",
        op: "grantKeyword",
        keyword: "vision",
      }),
    ],
  };

  function board(): GameState {
    return makeState({
      p1: { mainDeck: ["a", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [forecaster, unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "forecaster", controller: "p1" }],
    });
  }

  it("counts a granted instance on top of the printed one", () => {
    expect(characteristicsOf(board(), "forecaster").keywordCounts.vision).toBe(2);
  });

  /** R817.2 — "Multiple instances of Vision trigger separately." */
  it("derives one ability per instance", () => {
    const derived = abilitiesOf(board(), "forecaster").filter(
      (ability) =>
        ability.kind === "triggered" && ability.effect.op === "predict",
    );

    expect(derived).toHaveLength(2);
  });

  /** R819.2 — "Multiple instances of Quick-Draw … have no effect beyond the first." */
  it("still collapses the keywords that say they are redundant", () => {
    const state = makeState({
      cards: [
        {
          ...unit("sword"),
          type: "gear" as const,
          keywords: ["quickDraw", "quickDraw"],
        },
      ],
      permanents: [{ cardId: "sword", controller: "p1" }],
    });

    expect(
      abilitiesOf(state, "sword").filter(
        (ability) =>
          ability.kind === "triggered" && ability.effect.op === "attachSelf",
      ),
    ).toHaveLength(1);
  });
});
