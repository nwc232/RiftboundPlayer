import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { dealDamage, draw } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Riptide Rex — "When you play me, deal 6 to an enemy unit at a battlefield." */
const riptideRex: CardInstance = {
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

/** A "you may draw 1" play trigger — R383.3.a's first-clause optional. */
const hesitantScout: CardInstance = {
  ...unit("scout", { might: 1, cost: { ...FREE, energy: 1 } }),
  name: "Hesitant Scout",
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      effect: draw(1),
      optional: true,
    },
  ],
};

function board(handCard: CardInstance): GameState {
  return makeState({
    p1: {
      hand: [handCard.id],
      mainDeck: ["spare"],
      runePool: pool({ energy: 9 }),
    },
    cards: [
      handCard,
      unit("spare"),
      unit("enemyAtBf", { might: 9 }),
      unit("enemyAtBase", { might: 9 }),
      unit("friendly", { might: 9 }),
    ],
    permanents: [
      {
        cardId: "enemyAtBf",
        controller: "p2",
        location: { kind: "battlefield", id: "bf" },
      },
      { cardId: "enemyAtBase", controller: "p2" },
      {
        cardId: "friendly",
        controller: "p1",
        location: { kind: "battlefield", id: "bf" },
      },
    ],
    battlefields: ["bf"],
  });
}

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

const PLAY_REX: Action = {
  type: "playUnitFromHand",
  playerId: "p1",
  cardId: "rex",
};
const PLAY_SCOUT: Action = {
  type: "playUnitFromHand",
  playerId: "p1",
  cardId: "scout",
};
const P1_PRIORITY: Action = { type: "passPriority", playerId: "p1" };
const P2_PRIORITY: Action = { type: "passPriority", playerId: "p2" };

describe("choosing targets (R355.5)", () => {
  it("asks the controller to choose as the trigger finalizes", () => {
    const state = run(board(riptideRex), [PLAY_REX]);

    expect(state.pending).toEqual({
      player: "p1",
      prompt: {
        kind: "chooseTargets",
        chainIndex: 0,
        count: 1,
        legal: ["enemyAtBf"],
      },
    });
  });

  it("filters out friendly units and units outside a battlefield", () => {
    const state = run(board(riptideRex), [PLAY_REX]);

    const legal =
      state.pending?.prompt.kind === "chooseTargets"
        ? state.pending.prompt.legal
        : [];
    expect(legal).not.toContain("friendly");
    expect(legal).not.toContain("enemyAtBase");
  });

  it("blocks every other action while the choice is outstanding (R320.1)", () => {
    const state = run(board(riptideRex), [PLAY_REX]);

    expect(applyAction(state, P1_PRIORITY)).toEqual({
      ok: false,
      reason: "decisionPending",
    });
  });

  it("refuses a target that is not legal", () => {
    const state = run(board(riptideRex), [PLAY_REX]);

    expect(
      applyAction(state, { type: "decide", playerId: "p1", targets: ["friendly"] }),
    ).toEqual({ ok: false, reason: "invalidTarget" });
  });

  it("refuses the wrong number of targets (R355.8)", () => {
    const state = run(board(riptideRex), [PLAY_REX]);

    expect(
      applyAction(state, { type: "decide", playerId: "p1", targets: [] }),
    ).toEqual({ ok: false, reason: "wrongTargetCount" });
  });

  it("refuses a decision from the wrong player", () => {
    const state = run(board(riptideRex), [PLAY_REX]);

    expect(
      applyAction(state, { type: "decide", playerId: "p2", targets: ["enemyAtBf"] }),
    ).toEqual({ ok: false, reason: "notYourDecision" });
  });

  it("carries the chosen target through to resolution", () => {
    const state = run(board(riptideRex), [
      PLAY_REX,
      { type: "decide", playerId: "p1", targets: ["enemyAtBf"] },
      P1_PRIORITY,
      P2_PRIORITY,
    ]);

    // 6 damage onto a 9-Might unit: marked, not lethal.
    expect(state.permanents.enemyAtBf?.damage).toBe(6);
    expect(state.chain).toHaveLength(0);
  });
});

describe("optional triggers (R383.3.a)", () => {
  it("asks whether to perform it at all before anything else", () => {
    const state = run(board(hesitantScout), [PLAY_SCOUT]);

    expect(state.pending).toEqual({
      player: "p1",
      prompt: { kind: "confirmOptional", chainIndex: 0 },
    });
  });

  it("declining removes it from the chain — it never triggered (R383.3.a.2)", () => {
    const state = run(board(hesitantScout), [
      PLAY_SCOUT,
      { type: "decide", playerId: "p1", perform: false },
    ]);

    expect(state.chain).toHaveLength(0);
    expect(state.pending).toBeNull();
    expect(state.players.p1.hand).toEqual([]);
  });

  it("accepting leaves it on the chain to resolve normally", () => {
    const state = run(board(hesitantScout), [
      PLAY_SCOUT,
      { type: "decide", playerId: "p1", perform: true },
      P1_PRIORITY,
      P2_PRIORITY,
    ]);

    expect(state.chain).toHaveLength(0);
    expect(state.players.p1.hand).toEqual(["spare"]);
  });
});
