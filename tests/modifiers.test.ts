import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  anthemMight,
  doubleMight,
  grantKeywordFor,
  modifyMight,
  passive,
} from "../src/builders.js";
import { keywordsOf, mightOf } from "../src/layers.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { endTurn } from "../src/turn.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function board(
  cards: CardInstance[],
  permanents: {
    cardId: string;
    controller?: "p1" | "p2";
    location?: Location;
    designation?: "attacker" | "defender";
  }[],
): GameState {
  return makeState({
    cards,
    permanents: permanents.map((entry) => ({
      cardId: entry.cardId,
      controller: entry.controller ?? "p1",
      ...(entry.location !== undefined ? { location: entry.location } : {}),
      ...(entry.designation !== undefined
        ? { designation: entry.designation }
        : {}),
    })),
    battlefields: ["bf-north"],
  });
}

const CONTEXT = (targets: string[]): EffectContext => ({
  controller: "p1",
  sourceId: "spell",
  targets,
});

describe("durational modifiers (R432.1)", () => {
  it("raises Might for the rest of the turn", () => {
    const state = board([unit("ally", { might: 2 })], [
      { cardId: "ally", location: NORTH },
    ]);

    const after = execute(
      state,
      modifyMight(3, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;

    expect(mightOf(after, "ally")).toBe(5);
  });

  it("expires at the end of the turn (R317.2.c)", () => {
    const state = board([unit("ally", { might: 2 })], [
      { cardId: "ally", location: NORTH },
    ]);
    const buffed = execute(
      state,
      modifyMight(3, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;

    const next = endTurn(buffed).state;

    expect(next.modifiers).toEqual([]);
    expect(mightOf(next, "ally")).toBe(2);
  });

  it("outlives its source, unlike a passive", () => {
    const commander: CardInstance = {
      ...unit("commander", { might: 4 }),
      abilities: [anthemMight(1)],
    };
    const state = board([commander, unit("ally", { might: 2 })], [
      { cardId: "commander", location: NORTH },
      { cardId: "ally", location: NORTH },
    ]);
    const buffed = execute(
      state,
      modifyMight(3, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;
    expect(mightOf(buffed, "ally")).toBe(6);

    const { commander: _gone, ...permanents } = buffed.permanents;
    const after = { ...buffed, permanents };

    // The anthem's +1 goes with its source; the spell's +3 does not.
    expect(mightOf(after, "ally")).toBe(5);
  });

  it("grants a keyword for a duration", () => {
    const state = board([unit("ally", { might: 2 })], [
      { cardId: "ally", location: NORTH, designation: "defender" },
    ]);

    // Fortified Position — "It gains [Shield 2] this combat."
    const after = execute(
      state,
      grantKeywordFor("shield", "thisCombat", 2),
      CONTEXT(["ally"]),
    ).state;

    expect(keywordsOf(after, "ally")).toContain("shield");
    expect(mightOf(after, "ally")).toBe(4);
  });
});

/**
 * R477.3.b — "the limitation is applied at the time of its application, and is
 * remembered at that limited level for the duration of its effect."
 */
describe("snapshotting a limited amount (R477.3.b)", () => {
  it("generates -1 for '-4 Might to a min of 1' on a 2-Might unit", () => {
    const state = board([unit("ally", { might: 2 })], [
      { cardId: "ally", location: NORTH },
    ]);

    const after = execute(
      state,
      modifyMight(-4, "thisTurn", { min: 1 }),
      CONTEXT(["ally"]),
    ).state;

    // The rules' own worked example: the effect generates -1, not -4.
    expect(after.modifiers[0]?.modification).toEqual({
      layer: "arithmetic",
      op: "addMight",
      amount: -1,
    });
    expect(mightOf(after, "ally")).toBe(1);
  });

  it("keeps the limited amount even after the unit is buffed", () => {
    const state = board([unit("ally", { might: 2 })], [
      { cardId: "ally", location: NORTH },
    ]);

    let current = execute(
      state,
      modifyMight(-4, "thisTurn", { min: 1 }),
      CONTEXT(["ally"]),
    ).state;
    current = execute(
      current,
      modifyMight(5, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;

    // 2 + 5 - 1 = 6. It is not re-clamped, and it is not -4.
    expect(mightOf(current, "ally")).toBe(6);
  });

  /**
   * R432.1.a's worked example, which is what forces the amount to be stored
   * rather than re-derived: base 3 + Shield 2 = 5, doubled to +5 this turn,
   * and the +5 survives combat ending even though the Shield does not.
   */
  it("doubles current Might and keeps the amount after Shield stops applying", () => {
    const taric: CardInstance = {
      ...unit("taric", { might: 3, keywords: ["shield"] }),
      shield: 2,
    };
    const defending = board([taric], [
      { cardId: "taric", location: NORTH, designation: "defender" },
    ]);
    expect(mightOf(defending, "taric")).toBe(5);

    const doubled = execute(
      defending,
      doubleMight("thisTurn"),
      CONTEXT(["taric"]),
    ).state;
    expect(mightOf(doubled, "taric")).toBe(10);

    // Combat ends: the designation goes, so Shield stops applying.
    const { designation: _gone, ...rest } = doubled.permanents.taric!;
    const after = {
      ...doubled,
      permanents: { ...doubled.permanents, taric: rest },
    };

    expect(mightOf(after, "taric")).toBe(8);
  });

  /** R477.3.c — a player cannot increase an attribute by a negative amount. */
  it("increases by 0 when doubling a unit whose Might is negative", () => {
    const state = board([unit("ally", { might: 2 })], [
      { cardId: "ally", location: NORTH },
    ]);
    const debuffed = execute(
      state,
      modifyMight(-4, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;
    expect(mightOf(debuffed, "ally")).toBe(-2);

    const doubled = execute(
      debuffed,
      doubleMight("thisTurn"),
      CONTEXT(["ally"]),
    ).state;

    // Last Stand on a -2 unit increases by 0, so nothing is stored at all.
    expect(mightOf(doubled, "ally")).toBe(-2);
    expect(doubled.modifiers).toHaveLength(1);
  });
});

/**
 * R479 — "the passive ability is altered by the sequence of applications, so it
 * depends on the Discipline effect", meaning the dependent one applies last.
 */
describe("dependency within a layer (R478/479)", () => {
  const raiser: CardInstance = {
    ...unit("raiser", { might: 1 }),
    name: "Might Raiser",
    abilities: [
      passive({ target: "otherFriendlyUnits", here: true }, {
        layer: "arithmetic",
        op: "increaseMightTo",
        target: 5,
      }),
    ],
  };

  it("applies a fixed increase before an 'increased to' that depends on it", () => {
    const state = board([raiser, unit("ally", { might: 4 })], [
      { cardId: "raiser", location: NORTH },
      { cardId: "ally", location: NORTH },
    ]);

    // Discipline's +2 first takes 4 to 6; "increased to 5" then adds nothing.
    const after = execute(
      state,
      modifyMight(2, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;

    expect(mightOf(after, "ally")).toBe(6);
  });

  it("still raises to the floor when nothing else applies", () => {
    const state = board([raiser, unit("ally", { might: 4 })], [
      { cardId: "raiser", location: NORTH },
      { cardId: "ally", location: NORTH },
    ]);

    expect(mightOf(state, "ally")).toBe(5);
  });

  /** R477.3.e — increases are applied before decreases. */
  it("applies increases before decreases", () => {
    const state = board([raiser, unit("ally", { might: 1 })], [
      { cardId: "raiser", location: NORTH },
      { cardId: "ally", location: NORTH },
    ]);

    const after = execute(
      state,
      modifyMight(-3, "thisTurn"),
      CONTEXT(["ally"]),
    ).state;

    // Raised to 5 first, then -3, giving 2 — not 1-3 clamped back up to 5.
    expect(mightOf(after, "ally")).toBe(2);
  });
});
