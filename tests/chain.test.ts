import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { counterSpell, dealDamage, draw, spell } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import type { GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Incinerate — "[Action] Deal 2 to a unit at a battlefield." */
const incinerate = spell("inc", "Incinerate", FREE, dealDamage(2), ["action"]);
/** Wind Wall — "[Reaction] Counter a spell." */
const windWall = spell("ww", "Wind Wall", FREE, counterSpell(), ["reaction"]);
/** A plain draw spell with no timing keyword — sorcery-speed only. */
const study = spell("study", "Study", FREE, draw(1));

function board(hands: { p1?: string[]; p2?: string[] } = {}): GameState {
  return makeState({
    p1: { hand: hands.p1 ?? [], runePool: pool({ energy: 9 }) },
    p2: { hand: hands.p2 ?? [], runePool: pool({ energy: 9 }), mainDeck: ["x1"] },
    cards: [incinerate, windWall, study, unit("target", { might: 3 }), unit("x1")],
    permanents: [{ cardId: "target", controller: "p2" }],
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

const CAST_INC: Action = {
  type: "playSpell",
  playerId: "p1",
  cardId: "inc",
  targets: ["target"],
};
const P1_PRIORITY: Action = { type: "passPriority", playerId: "p1" };
const P2_PRIORITY: Action = { type: "passPriority", playerId: "p2" };

describe("putting a spell on the chain", () => {
  it("lingers on the chain rather than resolving (R359.3)", () => {
    const state = run(board({ p1: ["inc"] }), [CAST_INC]);

    expect(state.chain).toHaveLength(1);
    expect(state.chain[0]?.cardId).toBe("inc");
    expect(state.permanents.target?.damage).toBe(0);
  });

  it("hands priority to the opponent (R337.4)", () => {
    const state = run(board({ p1: ["inc"] }), [CAST_INC]);

    expect(state.priority).toBe("p2");
  });

  it("resolves once both players pass (R339, R340.1)", () => {
    const state = run(board({ p1: ["inc"] }), [
      CAST_INC,
      P2_PRIORITY,
      P1_PRIORITY,
    ]);

    expect(state.chain).toHaveLength(0);
    expect(state.priority).toBeNull();
    expect(state.permanents.target?.damage).toBe(2);
    expect(state.players.p1.trash).toEqual(["inc"]);
  });

  it("kills a unit that ends up with lethal damage (R428.1.a.2)", () => {
    const lethal = spell("big", "Big", FREE, dealDamage(5), ["action"]);
    const state = run(
      {
        ...board({ p1: ["big"] }),
        cards: { ...board().cards, big: lethal },
      },
      [
        { type: "playSpell", playerId: "p1", cardId: "big", targets: ["target"] },
        P2_PRIORITY,
        P1_PRIORITY,
      ],
    );

    expect(state.permanents.target).toBeUndefined();
    expect(state.players.p2.trash).toEqual(["target"]);
  });
});

describe("reaction timing", () => {
  it("lets a [Reaction] spell be played while the chain is up (R813)", () => {
    const state = run(board({ p1: ["inc"], p2: ["ww"] }), [
      CAST_INC,
      { type: "playSpell", playerId: "p2", cardId: "ww", targets: ["inc"] },
    ]);

    expect(state.chain).toHaveLength(2);
    expect(state.chain[1]?.cardId).toBe("ww");
  });

  it("refuses a spell without [Reaction] while the chain is up", () => {
    const withChain = run(board({ p1: ["inc"], p2: ["study"] }), [CAST_INC]);

    expect(
      applyAction(withChain, {
        type: "playSpell",
        playerId: "p2",
        cardId: "study",
      }),
    ).toEqual({ ok: false, reason: "wrongTiming" });
  });

  it("refuses a plain spell on the opponent's turn", () => {
    expect(
      applyAction(board({ p2: ["study"] }), {
        type: "playSpell",
        playerId: "p2",
        cardId: "study",
      }),
    ).toEqual({ ok: false, reason: "wrongTiming" });
  });
});

describe("countering", () => {
  it("resolves the counter first and stops the spell beneath it", () => {
    const state = run(board({ p1: ["inc"], p2: ["ww"] }), [
      CAST_INC,
      { type: "playSpell", playerId: "p2", cardId: "ww", targets: ["inc"] },
      P1_PRIORITY,
      P2_PRIORITY,
    ]);

    // Wind Wall was newest so it resolved first, removing Incinerate.
    expect(state.chain).toHaveLength(0);
    expect(state.permanents.target?.damage).toBe(0);
    expect(state.players.p1.trash).toEqual(["inc"]);
    expect(state.players.p2.trash).toEqual(["ww"]);
  });

  it("leaves the target unharmed because the countered spell never executes", () => {
    const state = run(board({ p1: ["inc"], p2: ["ww"] }), [
      CAST_INC,
      { type: "playSpell", playerId: "p2", cardId: "ww", targets: ["inc"] },
      P1_PRIORITY,
      P2_PRIORITY,
    ]);

    expect(state.permanents.target).toBeDefined();
    expect(state.permanents.target?.damage).toBe(0);
  });
});

describe("priority", () => {
  it("refuses a pass from the player without priority", () => {
    const state = run(board({ p1: ["inc"] }), [CAST_INC]);

    expect(applyAction(state, P1_PRIORITY)).toEqual({
      ok: false,
      reason: "notYourPriority",
    });
  });

  it("refuses to end the turn while the chain is up", () => {
    const state = run(board({ p1: ["inc"] }), [CAST_INC]);

    expect(applyAction(state, { type: "endTurn", playerId: "p1" })).toEqual({
      ok: false,
      reason: "showdownInProgress",
    });
  });
});
