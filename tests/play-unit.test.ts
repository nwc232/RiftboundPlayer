import { describe, expect, it } from "vitest";
import { playUnitFromHand } from "../src/actions.js";
import { totals } from "../src/cost.js";
import { cost, makeState, pool, unit } from "./fixtures.js";

function freeUnitState() {
  return makeState({
    p1: { hand: ["u1", "s1"] },
    cards: [unit("u1"), { ...unit("s1"), type: "spell" as const }],
  });
}

describe("playUnitFromHand", () => {
  it("moves a unit from hand to base and creates it as an exhausted permanent", () => {
    const result = playUnitFromHand(freeUnitState(), "p1", "u1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.hand).toEqual(["s1"]);
    expect(result.state.permanents.u1?.location).toEqual({ kind: "base", player: "p1" });
    expect(result.state.permanents.u1?.exhausted).toBe(true);
    expect(result.state.permanents.u1?.controller).toBe("p1");
  });

  it("reports the cost payment and the unit entering play", () => {
    const result = playUnitFromHand(freeUnitState(), "p1", "u1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.type)).toEqual([
      "costPaid",
      "unitPlayed",
    ]);
  });

  it("leaves the original state object completely untouched", () => {
    const before = freeUnitState();

    playUnitFromHand(before, "p1", "u1");

    expect(before.players.p1.hand).toEqual(["u1", "s1"]);
    expect(before.permanents.u1).toBeUndefined();
  });

  it("rejects a card that is not a unit", () => {
    expect(playUnitFromHand(freeUnitState(), "p1", "s1")).toEqual({
      ok: false,
      reason: "wrongCardType",
    });
  });

  it("rejects a card that is not in that player's hand", () => {
    const before = makeState({
      p1: { hand: ["u1"] },
      cards: [unit("u1"), unit("elsewhere")],
    });

    expect(playUnitFromHand(before, "p1", "elsewhere")).toEqual({
      ok: false,
      reason: "notInHand",
    });
  });

  it("rejects a unit the player cannot afford", () => {
    const before = makeState({
      p1: { hand: ["u1"], runePool: pool({ energy: 1 }) },
      cards: [unit("u1", { cost: cost({ energy: 2, power: { fury: 1 } }) })],
    });

    expect(playUnitFromHand(before, "p1", "u1")).toEqual({
      ok: false,
      reason: "cannotAffordCost",
    });
  });

  it("deducts the cost from the rune pool when the unit is played", () => {
    const before = makeState({
      p1: {
        hand: ["u1"],
        runePool: pool({ energy: 3, power: { fury: 2 } }),
      },
      cards: [unit("u1", { cost: cost({ energy: 2, power: { fury: 1 } }) })],
    });

    const result = playUnitFromHand(before, "p1", "u1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const left = totals(result.state.players.p1.runePool);
    expect(left.energy).toBe(1);
    expect(left.power).toEqual({ fury: 1 });
  });
});
