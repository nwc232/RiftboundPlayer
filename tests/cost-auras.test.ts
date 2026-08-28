import { describe, expect, it } from "vitest";
import { costAura, empower } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { totalCostOf } from "../src/costing.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const spell = (id: string, energy: number, extra: Partial<CardInstance> = {}) =>
  ({
    id,
    name: id,
    type: "spell" as const,
    cost: { ...FREE, energy },
    keywords: [],
    abilities: [],
    ...extra,
  }) satisfies CardInstance;

/**
 * R356.3 / R356.4 — a board ability that changes what *other* cards cost. The
 * cards it reaches are in a hand, where R711 reads printed values, so this is
 * swept from the board rather than layered onto a permanent.
 */
describe("cost auras", () => {
  /** Helm of Suppression — "Opponents' spells cost [1] more." */
  const helm: CardInstance = {
    ...unit("helm"),
    type: "gear",
    abilities: [
      costAura({
        affects: "enemy",
        match: { type: "spell" },
        increase: { energy: 1 },
      }),
    ],
  };

  function board(source: CardInstance, sourceOwner: "p1" | "p2" = "p2"): GameState {
    return makeState({
      p1: {
        hand: ["bolt", "grunt"],
        mainDeck: ["a"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["b"] },
      cards: [
        source,
        spell("bolt", 2),
        unit("grunt", { might: 2 }),
        unit("a"),
        unit("b"),
      ],
      permanents: [{ cardId: source.id, controller: sourceOwner }],
    });
  }

  it("raises what an opponent's spell costs", () => {
    expect(totalCostOf(board(helm), "p1", "bolt", {})).toEqual({
      ...FREE,
      energy: 3,
    });
  });

  it("leaves the aura's own controller alone", () => {
    expect(totalCostOf(board(helm), "p2", "bolt", {})).toEqual({
      ...FREE,
      energy: 2,
    });
  });

  it("respects what it matches on", () => {
    // `grunt` is a unit; the aura names spells.
    expect(totalCostOf(board(helm), "p1", "grunt", {})).toEqual(FREE);
  });

  /** Vaults of Helia — "your **non-token** units cost [1] more to play." */
  it("can exclude tokens", () => {
    const vault: CardInstance = {
      ...unit("vault"),
      type: "gear",
      abilities: [
        costAura({
          affects: "friendly",
          match: { type: "unit", nonToken: true },
          increase: { energy: 1 },
        }),
      ],
    };
    const state = board(vault, "p1");
    const withToken: GameState = {
      ...state,
      cards: {
        ...state.cards,
        grunt: { ...state.cards.grunt!, isToken: true as const },
      },
    };

    expect(totalCostOf(state, "p1", "grunt", {}).energy).toBe(1);
    expect(totalCostOf(withToken, "p1", "grunt", {}).energy).toBe(0);
  });

  /** Mystic Vortex — "cards with [Reaction] cost [1] more to play." */
  it("can match on a keyword", () => {
    const vortex: CardInstance = {
      ...unit("vortex"),
      type: "gear",
      abilities: [
        costAura({
          affects: "any",
          match: { keyword: "reaction" },
          increase: { energy: 1 },
        }),
      ],
    };
    const state = board(vortex, "p1");
    const reactive: GameState = {
      ...state,
      cards: {
        ...state.cards,
        bolt: { ...state.cards.bolt!, keywords: ["reaction"] },
      },
    };

    expect(totalCostOf(state, "p1", "bolt", {}).energy).toBe(2);
    expect(totalCostOf(reactive, "p1", "bolt", {}).energy).toBe(3);
  });

  /**
   * R356.3 before R356.4 — increases are applied before reductions, which is
   * observable when a reduction has a floor.
   */
  it("applies increases before reductions, and honours a floor", () => {
    const vex: CardInstance = {
      ...unit("vex"),
      abilities: [
        costAura({
          affects: "friendly",
          match: { type: "spell" },
          reduce: { energy: 5 },
          minimum: { energy: 1 },
        }),
      ],
    };

    // Base 2, reduced by 5, floored at 1.
    expect(totalCostOf(board(vex, "p1"), "p1", "bolt", {}).energy).toBe(1);
  });

  /** "If this is [Empowered], they cost [2] more instead." */
  describe("gated on a condition", () => {
    const gated: CardInstance = {
      ...unit("helm"),
      type: "gear",
      abilities: [
        empower({ energy: 2 }),
        costAura({
          affects: "enemy",
          match: { type: "spell" },
          increase: { energy: 2 },
          when: { kind: "empowered" },
        }),
      ],
    };

    it("does nothing while the condition is false", () => {
      expect(totalCostOf(board(gated), "p1", "bolt", {}).energy).toBe(2);
    });

    it("applies once it is true", () => {
      const state = board(gated);
      const on: GameState = {
        ...state,
        permanents: {
          ...state.permanents,
          helm: { ...state.permanents.helm!, empowered: true as const },
        },
      };

      expect(totalCostOf(on, "p1", "bolt", {}).energy).toBe(4);
    });
  });

  /** R190.6.d — an uncontrolled battlefield's "you" refers to nobody. */
  it("ignores an uncontrolled battlefield's aura", () => {
    const field: CardInstance = {
      id: "bf-north",
      name: "Mystic Vortex",
      type: "battlefield",
      cost: FREE,
      keywords: [],
      abilities: [
        costAura({
          affects: "any",
          match: { type: "spell" },
          increase: { energy: 1 },
        }),
      ],
    };
    const state = makeState({
      p1: { hand: ["bolt"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [field, spell("bolt", 2), unit("a"), unit("b")],
      battlefields: ["bf-north"],
    });

    expect(totalCostOf(state, "p1", "bolt", {}).energy).toBe(2);

    const held: GameState = {
      ...state,
      battlefields: {
        "bf-north": { cardId: "bf-north", controller: "p1", contestedBy: null },
      },
    };
    expect(totalCostOf(held, "p1", "bolt", {}).energy).toBe(3);
  });
});
