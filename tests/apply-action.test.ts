import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import type { GameEvent } from "../src/events.js";
import type { GameState } from "../src/state.js";

function makeState(): GameState {
  return {
    players: {
      p1: { id: "p1", mainDeck: ["u1"], hand: [], base: [] },
      p2: { id: "p2", mainDeck: [], hand: [], base: [] },
    },
    cards: {
      u1: { id: "u1", name: "Test Unit", type: "unit" },
    },
    permanents: {},
  };
}

describe("applyAction", () => {
  it("routes a drawCard action to the draw logic", () => {
    const { state, events } = applyAction(makeState(), {
      type: "drawCard",
      playerId: "p1",
    });

    expect(state.players.p1.hand).toEqual(["u1"]);
    expect(events).toEqual([
      { type: "cardDrawn", playerId: "p1", cardId: "u1" },
    ]);
  });

  it("runs a sequence of actions and accumulates a log of what happened", () => {
    const script: Action[] = [
      { type: "drawCard", playerId: "p1" },
      { type: "playUnitFromHand", playerId: "p1", cardId: "u1" },
    ];

    let state = makeState();
    const log: GameEvent[] = [];

    for (const action of script) {
      const result = applyAction(state, action);
      state = result.state;
      log.push(...result.events);
    }

    expect(state.players.p1.hand).toEqual([]);
    expect(state.players.p1.base).toEqual(["u1"]);
    expect(log).toEqual([
      { type: "cardDrawn", playerId: "p1", cardId: "u1" },
      { type: "unitPlayed", playerId: "p1", cardId: "u1" },
    ]);
  });
});
