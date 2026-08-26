import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { dealDamage, draw } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { legalActions } from "../src/legal.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const drake: CardInstance = {
  ...unit("drake", { might: 5, cost: { ...FREE, energy: 2 } }),
  name: "Cloud Drake",
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      effect: draw(1),
    },
  ],
};

const rex: CardInstance = {
  ...unit("rex", { might: 6, cost: { ...FREE, energy: 1 } }),
  name: "Riptide Rex",
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      effect: dealDamage(6),
      targeting: {
        count: 1,
        filter: { type: "unit", controller: "enemy", location: "battlefield" },
      },
    },
  ],
};

function board(): GameState {
  return makeState({
    p1: { hand: ["drake"], mainDeck: ["spare"], runePool: pool({ energy: 9 }) },
    cards: [drake, rex, unit("spare"), unit("enemy", { might: 9 })],
    permanents: [
      {
        cardId: "enemy",
        controller: "p2",
        location: { kind: "battlefield", id: "bf" },
      },
    ],
    battlefields: ["bf"],
  });
}

function has(actions: Action[], match: Partial<Action>): boolean {
  return actions.some((action) =>
    Object.entries(match).every(
      ([key, value]) =>
        JSON.stringify((action as Record<string, unknown>)[key]) ===
        JSON.stringify(value),
    ),
  );
}

describe("legalActions", () => {
  it("offers a card the player can afford", () => {
    const actions = legalActions(board(), "p1");

    expect(has(actions, { type: "playUnitFromHand", cardId: "drake" })).toBe(true);
  });

  it("omits a card the player cannot afford", () => {
    const broke: GameState = {
      ...board(),
      players: {
        ...board().players,
        p1: { ...board().players.p1, runePool: { buckets: [] } },
      },
    };

    expect(
      has(legalActions(broke, "p1"), { type: "playUnitFromHand", cardId: "drake" }),
    ).toBe(false);
  });

  it("offers nothing to the player whose turn it is not", () => {
    const actions = legalActions(board(), "p2");

    expect(has(actions, { type: "playUnitFromHand" })).toBe(false);
    expect(has(actions, { type: "endTurn" })).toBe(false);
  });

  /**
   * The property that makes this worth having: what it offers and what the
   * dispatcher accepts cannot disagree, because it asks the dispatcher.
   */
  it("offers only actions that actually succeed", () => {
    const state = board();

    for (const action of legalActions(state, "p1")) {
      expect(applyAction(state, action).ok).toBe(true);
    }
  });

  it("offers every legal answer while a decision is pending, and nothing else", () => {
    const played = applyAction(
      makeState({
        p1: { hand: ["rex"], mainDeck: ["spare"], runePool: pool({ energy: 9 }) },
        cards: [rex, unit("spare"), unit("enemy", { might: 9 }), unit("other", { might: 9 })],
        permanents: [
          {
            cardId: "enemy",
            controller: "p2",
            location: { kind: "battlefield", id: "bf" },
          },
          {
            cardId: "other",
            controller: "p2",
            location: { kind: "battlefield", id: "bf" },
          },
        ],
        battlefields: ["bf"],
      }),
      { type: "playUnitFromHand", playerId: "p1", cardId: "rex" },
    );
    if (!played.ok) throw new Error(`rejected: ${played.reason}`);
    expect(played.state.pending?.prompt.kind).toBe("chooseTargets");

    const actions = legalActions(played.state, "p1");

    // R320.1 — answering is the only thing available.
    expect(actions.every((action) => action.type === "decide")).toBe(true);
    expect(actions).toHaveLength(2);
    expect(has(actions, { type: "decide", targets: ["enemy"] })).toBe(true);
    expect(has(actions, { type: "decide", targets: ["other"] })).toBe(true);
  });

  it("offers the opponent nothing while the decision is not theirs", () => {
    const played = applyAction(board(), {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: "drake",
    });
    if (!played.ok) throw new Error("setup failed");

    // p1's play trigger is on the chain; p1 holds priority (R337.4).
    expect(legalActions(played.state, "p2")).toEqual([]);
    expect(has(legalActions(played.state, "p1"), { type: "passPriority" })).toBe(
      true,
    );
  });

  it("enumerates the mulligan's subsets, keep included (R117.1)", () => {
    const state = makeState({
      p1: { hand: ["a", "b", "c"], mainDeck: ["d", "e"] },
      cards: ["a", "b", "c", "d", "e"].map((id) => unit(id)),
    });
    const waiting: GameState = {
      ...state,
      tasks: [{ kind: "mulligan", player: "p1" }],
      pending: {
        player: "p1",
        prompt: { kind: "mulligan", max: 2, legal: ["a", "b", "c"] },
      },
    };

    const actions = legalActions(waiting, "p1");

    // 1 keep + 3 singles + 3 pairs.
    expect(actions).toHaveLength(7);
    expect(has(actions, { type: "decide", targets: [] })).toBe(true);
    expect(has(actions, { type: "decide", targets: ["a", "c"] })).toBe(true);
  });
});
