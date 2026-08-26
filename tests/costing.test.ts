import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { draw, legionCostReduction, spell } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { costOf } from "../src/costing.js";
import { legalActions } from "../src/legal.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Noxus Hopeful — "[Legion] — I cost [2] less." (a 3-energy 4 Might unit) */
const hopeful: CardInstance = {
  ...unit("hopeful", { might: 4, cost: { ...FREE, energy: 3 } }),
  name: "Noxus Hopeful",
  abilities: [legionCostReduction({ energy: 2 })],
};

const cantrip: CardInstance = spell("cantrip", "Cantrip", FREE, draw(1));

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

function board(energy: number): GameState {
  return makeState({
    p1: {
      hand: ["hopeful", "cantrip"],
      mainDeck: ["a", "b"],
      runePool: pool({ energy }),
    },
    p2: { mainDeck: ["c"] },
    cards: [hopeful, cantrip, unit("a"), unit("b"), unit("c")],
  });
}

const PLAY_HOPEFUL: Action = {
  type: "playUnitFromHand",
  playerId: "p1",
  cardId: "hopeful",
};
const PLAY_CANTRIP: Action = {
  type: "playSpell",
  playerId: "p1",
  cardId: "cantrip",
  targets: [],
};
/**
 * R359.3 — a spell lingers on the chain, so the state stays Closed until both
 * players pass. Playing a unit needs it Open again.
 */
const CAST_CANTRIP: Action[] = [
  PLAY_CANTRIP,
  { type: "passPriority", playerId: "p1" },
  { type: "passPriority", playerId: "p2" },
];

/** R812.1.b.1 — "If you have played another card this turn, this card gains [Text]." */
describe("[Legion] cost reduction (R812)", () => {
  it("costs the printed amount before anything else is played", () => {
    expect(costOf(board(3), "p1", "hopeful").energy).toBe(3);
  });

  it("costs less once another card has been finalized", () => {
    const after = run(board(3), [PLAY_CANTRIP]);

    expect(costOf(after, "p1", "hopeful").energy).toBe(1);
  });

  /** R812.1.c — "a card *different than* the one with the Legion ability". */
  it("is not satisfied by the card itself", () => {
    const played = run(board(3), [PLAY_HOPEFUL]);

    // The Hopeful is on the board now, but it was the only card played.
    expect(costOf(played, "p1", "hopeful").energy).toBe(3);
  });

  it("does not count the opponent's plays", () => {
    const theirs: GameState = {
      ...board(3),
      playedThisTurn: { p1: [], p2: ["something"] },
    };

    expect(costOf(theirs, "p1", "hopeful").energy).toBe(3);
  });

  it("is charged the reduced cost, not the printed one", () => {
    const after = run(board(1), [...CAST_CANTRIP, PLAY_HOPEFUL]);

    expect(after.permanents.hopeful).toBeDefined();
  });

  it("cannot be played for the reduced cost before the condition holds", () => {
    expect(applyAction(board(1), PLAY_HOPEFUL)).toEqual({
      ok: false,
      reason: "cannotAffordCost",
    });
  });

  /** legalActions filters through applyAction, so affordability follows. */
  it("only becomes a legal action once it is affordable", () => {
    const before = legalActions(board(1), "p1").filter(
      (action) =>
        action.type === "playUnitFromHand" && action.cardId === "hopeful",
    );
    expect(before).toEqual([]);

    const after = legalActions(run(board(1), CAST_CANTRIP), "p1").filter(
      (action) =>
        action.type === "playUnitFromHand" && action.cardId === "hopeful",
    );
    expect(after.length).toBeGreaterThan(0);
  });

  /** R812.2 — one other card satisfies every Legion ability at once. */
  it("never reduces below zero", () => {
    const cheap: CardInstance = {
      ...hopeful,
      id: "cheap",
      cost: { ...FREE, energy: 1 },
    };
    const state: GameState = {
      ...board(3),
      cards: { ...board(3).cards, cheap },
      playedThisTurn: { p1: ["cantrip"], p2: [] },
    };

    expect(costOf(state, "p1", "cheap")).toEqual(FREE);
  });
});

/** The list is per turn, so it has to be cleared as one opens. */
describe("clearing the record", () => {
  it("forgets the previous turn's plays", () => {
    const played = run(board(9), CAST_CANTRIP);
    expect(played.playedThisTurn.p1).toEqual(["cantrip"]);

    const next = run(played, [{ type: "endTurn", playerId: "p1" }]);

    expect(next.playedThisTurn.p1).toEqual([]);
  });
});
