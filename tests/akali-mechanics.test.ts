import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import { legalTargets, NO_TARGET } from "../src/decisions.js";
import { seeFacedown } from "../src/builders.js";
import { holds } from "../src/conditions.js";
import { expireModifiers } from "../src/layers.js";
import { viewOf } from "../src/view.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * The six things the Akali list wanted that the engine could not say. Each is
 * checked here on its own, before any card is authored against it.
 */

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };
const BASE: Location = { kind: "base", player: "p1" };

function board(): GameState {
  return makeState({
    p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
    p2: { mainDeck: ["b"] },
    cards: [
      unit("mine", { might: 3 }),
      unit("theirs", { might: 3 }),
      unit("elsewhere", { might: 3 }),
      unit("a"),
      unit("b"),
    ],
    permanents: [
      { cardId: "mine", controller: "p1", location: NORTH },
      { cardId: "theirs", controller: "p2", location: SOUTH },
      { cardId: "elsewhere", controller: "p2", location: BASE },
    ],
    battlefields: ["bf-north", "bf-south"],
  });
}

/** Akali, Deadly Weapon — "a unit at a battlefield I moved to or from". */
describe("choosing at either end of a move", () => {
  it("reaches both endpoints and nothing else", () => {
    const legal = legalTargets(
      board(),
      "p1",
      { type: "unit", atMoveEndpoint: true },
      "mine",
      undefined,
      [NORTH, SOUTH],
    );

    expect(legal.sort()).toEqual(["mine", "theirs"]);
  });

  /** With no move to read, nothing qualifies rather than everything. */
  it("finds nothing when there was no move", () => {
    expect(
      legalTargets(board(), "p1", { type: "unit", atMoveEndpoint: true }, "mine"),
    ).toEqual([]);
  });
});

/** Thwonk! — "Stun an attacking unit"; Rogue Assassin — "in a showdown". */
describe("choosing by designation", () => {
  function inCombat(): GameState {
    const state = board();
    return {
      ...state,
      permanents: {
        ...state.permanents,
        mine: { ...state.permanents.mine!, designation: "attacker" },
        theirs: { ...state.permanents.theirs!, designation: "defender" },
      },
    };
  }

  it("finds only the attackers", () => {
    expect(
      legalTargets(inCombat(), "p1", { type: "unit", designation: "attacker" }),
    ).toEqual(["mine"]);
  });

  /** "in a showdown" is either side of one. */
  it("finds both sides when either will do", () => {
    expect(
      legalTargets(inCombat(), "p1", { type: "unit", designation: "either" }).sort(),
    ).toEqual(["mine", "theirs"]);
  });

  it("finds nobody when there is no combat", () => {
    expect(
      legalTargets(board(), "p1", { type: "unit", designation: "either" }),
    ).toEqual([]);
  });
});

/** Shuriken Flip — "Deal 2 to up to one enemy unit at a battlefield". */
describe("a target that may be declined", () => {
  it("offers declining alongside the real choices", () => {
    const legal = legalTargets(board(), "p1", {
      type: "unit",
      controller: "enemy",
      location: "battlefield",
      optional: true,
    });

    expect(legal).toContain("theirs");
    expect(legal).toContain(NO_TARGET);
  });

  it("does not offer it when the filter is not optional", () => {
    expect(
      legalTargets(board(), "p1", {
        type: "unit",
        controller: "enemy",
        location: "battlefield",
      }),
    ).not.toContain(NO_TARGET);
  });
});

/**
 * R107.4.c — the Champion Legend is a Game Object, and Rogue Assassin prints
 * [Empower]. It has no permanent, so the status lives on the player.
 */
describe("a Legend's Empowered status", () => {
  function withLegend(): GameState {
    const legend: CardInstance = {
      id: "assassin",
      name: "Rogue Assassin",
      type: "legend",
      cost: { energy: 0, power: {}, anyPower: 0 },
      keywords: [],
      abilities: [],
    };
    const state = makeState({
      p1: { legend: "assassin", mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [legend, unit("a"), unit("b")],
    });
    return state;
  }

  const context = { controller: "p1" as const, sourceId: "assassin", targets: [] };

  it("empowers onto the player, having no permanent to hold it", () => {
    const after = execute(withLegend(), { op: "empowerSelf" }, context);

    expect(after.state.players.p1.legendEmpowered).toBe(true);
    expect(after.events).toEqual([
      { type: "empowered", playerId: "p1", cardId: "assassin" },
    ]);
  });

  it("reads back through the condition the same way a permanent does", () => {
    const after = execute(withLegend(), { op: "empowerSelf" }, context);

    expect(holds(after.state, { kind: "empowered" }, context)).toBe(true);
    expect(holds(withLegend(), { kind: "empowered" }, context)).toBe(false);
  });

  /** R441.1.c / R827.1.c.1 — it cannot be Empowered twice. */
  it("cannot be empowered again", () => {
    const once = execute(withLegend(), { op: "empowerSelf" }, context).state;

    expect(holds(once, { kind: "notEmpowered" }, context)).toBe(false);
    expect(execute(once, { op: "empowerSelf" }, context).events).toEqual([]);
  });
});

/**
 * Scuttle Crab — "You can look at their facedown cards this turn."
 *
 * R424.2.b: showing Private information "does not count as revealing and does
 * not trigger any effects that trigger when cards are revealed". So this
 * changes `viewOf` and nothing else.
 */
describe("looking at facedown cards", () => {
  function hidden(): GameState {
    const state = board();
    return {
      ...state,
      cards: { ...state.cards, trap: unit("trap", { might: 2 }) },
      facedown: {
        "bf-south": { cardId: "trap", controller: "p2", hiddenOnTurn: 0 },
      },
    };
  }

  it("conceals it from the opponent by default", () => {
    expect(viewOf(hidden(), "p1").facedown["bf-south"]?.cardId).not.toBe("trap");
  });

  it("shows it once the looking is granted", () => {
    const granted = execute(hidden(), seeFacedown(), {
      controller: "p1",
      sourceId: "crab",
      targets: [],
    }).state;

    expect(viewOf(granted, "p1").facedown["bf-south"]?.cardId).toBe("trap");
  });

  /** It is not a Reveal, so nothing that watches reveals hears about it. */
  it("is not a reveal", () => {
    const after = execute(hidden(), seeFacedown(), {
      controller: "p1",
      sourceId: "crab",
      targets: [],
    });

    expect(after.events).toEqual([]);
    expect(after.state.revealed).toEqual([]);
  });

  /** R317.2.c — "this turn" ends when the turn does. */
  it("expires with the turn", () => {
    const granted = execute(hidden(), seeFacedown(), {
      controller: "p1",
      sourceId: "crab",
      targets: [],
    }).state;
    const later = expireModifiers(granted, "thisTurn");

    expect(viewOf(later, "p1").facedown["bf-south"]?.cardId).not.toBe("trap");
  });
});
