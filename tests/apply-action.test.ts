import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import type { GameEvent } from "../src/events.js";
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

  it("plays a full turn: channel, exhaust for energy, then pay for a unit", () => {
    const script: Action[] = [
      { type: "channelRune", playerId: "p1" },
      { type: "channelRune", playerId: "p1" },
      { type: "exhaustRuneForEnergy", playerId: "p1", runeId: "r1" },
      { type: "recycleRuneForPower", playerId: "p1", runeId: "r2" },
      { type: "drawCard", playerId: "p1" },
      { type: "playUnitFromHand", playerId: "p1", cardId: "u1" },
    ];

    let state = makeState({
      p1: { runeDeck: ["r1", "r2"], mainDeck: ["u1"] },
      cards: [
        runeCard("r1", "fury"),
        runeCard("r2", "fury"),
        unit("u1", { cost: cost({ energy: 1, power: { fury: 1 } }) }),
      ],
    });
    const log: GameEvent[] = [];

    for (const action of script) {
      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(`unexpected rejection: ${result.reason}`);
      }
      state = result.state;
      log.push(...result.events);
    }

    expect(state.players.p1.base).toEqual(["u1"]);
    expect(state.players.p1.runePool).toEqual({
      energy: 0,
      power: { fury: 0 },
      universalPower: 0,
    });
    expect(log.map((event) => event.type)).toEqual([
      "runeChanneled",
      "runeChanneled",
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
