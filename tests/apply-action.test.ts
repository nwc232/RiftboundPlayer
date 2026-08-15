import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import type { GameEvent } from "../src/events.js";
import { totals } from "../src/cost.js";
import type { GameState } from "../src/state.js";
import { cost, makeState, runeCard, unit } from "./fixtures.js";

describe("applyAction", () => {
  it("routes a drawCard action to the draw logic", () => {
    const before = makeState({
      p1: { mainDeck: ["u1"] },
      cards: [unit("u1")],
    });

    const result = applyAction(before, { type: "drawCard", playerId: "p1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.hand).toEqual(["u1"]);
  });

  it("taps runes for resources, draws, and pays for a unit", () => {
    const script: Action[] = [
      { type: "activateAbility", playerId: "p1", sourceId: "r1", abilityIndex: 0 },
      { type: "activateAbility", playerId: "p1", sourceId: "r2", abilityIndex: 1 },
      { type: "drawCard", playerId: "p1" },
      { type: "playUnitFromHand", playerId: "p1", cardId: "u1" },
    ];

    const board = makeState({
      p1: { runes: ["r1", "r2"], mainDeck: ["u1"] },
      cards: [
        runeCard("r1", "fury"),
        runeCard("r2", "fury"),
        unit("u1", { cost: cost({ energy: 1, power: { fury: 1 } }) }),
      ],
    });
    let state: GameState = {
      ...board,
      runes: {
        r1: { cardId: "r1", domain: "fury", exhausted: false },
        r2: { cardId: "r2", domain: "fury", exhausted: false },
      },
    };
    const log: GameEvent[] = [];

    for (const action of script) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`unexpected rejection: ${result.reason}`);
      }
      state = result.state;
      log.push(...result.events);
    }

    expect(state.permanents.u1?.location).toEqual({ kind: "base", player: "p1" });
    expect(totals(state.players.p1.runePool)).toEqual({
      energy: 0,
      power: {},
      universalPower: 0,
    });
    expect(log.map((event) => event.type)).toEqual([
      "energyAdded",
      "runeRecycled",
      "powerAdded",
      "cardDrawn",
      "costPaid",
      "unitPlayed",
    ]);
  });

  it("rejects the unit when the pool cannot cover its cost", () => {
    const before = makeState({
      p1: { hand: ["u1"] },
      cards: [unit("u1", { cost: cost({ energy: 5 }) })],
    });

    expect(
      applyAction(before, {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "u1",
      }),
    ).toEqual({ ok: false, reason: "cannotAffordCost" });
  });
});
