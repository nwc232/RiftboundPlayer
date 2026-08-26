import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { dealDamage, spell } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { totalCostOf } from "../src/costing.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/** Vex, Apathetic carries [Deflect]; R809.1.b.3 makes a bare one worth 1. */
const bolt: CardInstance = {
  ...spell("bolt", "Bolt", { ...FREE, energy: 2 }, dealDamage(2), ["action"]),
};
bolt.abilities = [
  {
    kind: "activated",
    timing: "action",
    costs: [],
    effect: dealDamage(2),
    targeting: { filters: [{ type: "unit", location: "battlefield" }] },
  },
];

function board(power: number): GameState {
  return makeState({
    p1: {
      hand: ["bolt"],
      mainDeck: ["a"],
      runePool: pool({ energy: 9, universalPower: power }),
    },
    p2: { mainDeck: ["b"] },
    cards: [
      bolt,
      { ...unit("vex", { might: 4 }), keywords: ["deflect"] },
      unit("mine", { might: 2 }),
      unit("a"),
      unit("b"),
    ],
    permanents: [
      { cardId: "vex", controller: "p2", location: NORTH },
      { cardId: "mine", controller: "p1", location: NORTH },
    ],
    battlefields: ["bf-north"],
  });
}

/**
 * R809.1.c — "Spells and abilities an opponent controls that target [me] cost
 * an amount of Power equal to [Deflect Value] more to play as an additional
 * cost for each time they choose [me]."
 */
describe("[Deflect] (R809)", () => {
  it("taxes a spell that targets it", () => {
    expect(
      totalCostOf(board(1), "p1", "bolt", { targets: ["vex"] }),
    ).toEqual({ energy: 2, power: {}, anyPower: 1 });
  });

  it("leaves an untargeted play alone", () => {
    expect(totalCostOf(board(1), "p1", "bolt")).toEqual({
      ...FREE,
      energy: 2,
    });
  });

  /** R809.1.c says "an opponent controls" — your own Deflect costs you nothing. */
  it("does not tax its own controller", () => {
    const mine: GameState = {
      ...board(1),
      permanents: {
        ...board(1).permanents,
        vex: { ...board(1).permanents.vex!, controller: "p1" },
      },
    };

    expect(totalCostOf(mine, "p1", "bolt", { targets: ["vex"] })).toEqual({
      ...FREE,
      energy: 2,
    });
  });

  it("refuses the play when the tax cannot be paid", () => {
    expect(
      applyAction(board(0), {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["vex"],
      }),
    ).toEqual({ ok: false, reason: "cannotAffordCost" });

    // The same spell aimed at a friendly unit still goes through.
    expect(
      applyAction(board(0), {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["mine"],
      }).ok,
    ).toBe(true);
  });

  /** R809.1.c.1 — "The Power used to pay this cost may always be of any Domain." */
  it("is paid with Power of any domain", () => {
    const fury: GameState = {
      ...board(0),
      players: {
        ...board(0).players,
        p1: {
          ...board(0).players.p1,
          runePool: pool({ energy: 9, power: { fury: 1 } }),
        },
      },
    };

    expect(
      applyAction(fury, {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
        targets: ["vex"],
      }).ok,
    ).toBe(true);
  });
});
