import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { chainItemCardId } from "../src/chain.js";
import {
  aloneThere,
  atBattlefield,
  draw,
  ifThen,
  modifyMight,
  otherUnitsTotalMight,
  seq,
  stun,
} from "../src/builders.js";
import { holds } from "../src/conditions.js";
import type { Condition } from "../src/conditions.js";
import { mightOf } from "../src/layers.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

const context = (
  targets: string[],
  sourceId = "source",
): EffectContext => ({ controller: "p1", sourceId, targets });

/**
 * En Garde — "Give a friendly unit +1 Might this turn, then an additional +1
 * Might this turn if it is the only unit you control there." The `if` comes
 * after the instruction, so R383.2.a.1 makes it part of the effect.
 */
describe("conditional effects", () => {
  const enGarde = seq(
    modifyMight(1, "thisTurn"),
    ifThen(aloneThere("target", "friendly"), modifyMight(1, "thisTurn")),
  );

  function board(alsoMine: boolean): GameState {
    return makeState({
      cards: [
        unit("hero", { might: 3 }),
        unit("ally", { might: 2 }),
        unit("theirs", { might: 2 }),
      ],
      permanents: [
        { cardId: "hero", controller: "p1", location: NORTH },
        { cardId: "theirs", controller: "p2", location: NORTH },
        ...(alsoMine
          ? [{ cardId: "ally", controller: "p1" as const, location: NORTH }]
          : []),
      ],
      battlefields: ["bf-north"],
    });
  }

  it("takes the branch when the condition holds", () => {
    const after = execute(board(false), enGarde, context(["hero"])).state;

    // Alone among p1's units there, so both halves apply.
    expect(mightOf(after, "hero")).toBe(5);
  });

  it("skips the branch when it does not, without failing the rest", () => {
    const after = execute(board(true), enGarde, context(["hero"])).state;

    expect(mightOf(after, "hero")).toBe(4);
  });

  it("an enemy unit standing there does not break 'the only unit you control'", () => {
    const state = board(false);

    expect(state.permanents.theirs?.location).toEqual(NORTH);
    expect(holds(state, aloneThere("target", "friendly"), context(["hero"])))
      .toBe(true);
  });

  it("takes the other branch when one is given", () => {
    const after = execute(
      board(true),
      ifThen(
        aloneThere("target", "friendly"),
        modifyMight(5, "thisTurn"),
        modifyMight(1, "thisTurn"),
      ),
      context(["hero"]),
    ).state;

    expect(mightOf(after, "hero")).toBe(4);
  });
});

/** Kha'Zix, Mutating Horror — "if an enemy unit is alone here". */
describe("counting the other side", () => {
  function withEnemies(count: number): GameState {
    return makeState({
      cards: [
        unit("mine", { might: 3 }),
        unit("e1", { might: 1 }),
        unit("e2", { might: 1 }),
      ],
      permanents: [
        { cardId: "mine", controller: "p1", location: NORTH },
        ...["e1", "e2"]
          .slice(0, count)
          .map((id) => ({ cardId: id, controller: "p2" as const, location: NORTH })),
      ],
      battlefields: ["bf-north"],
    });
  }

  const alone: Condition = aloneThere("source", "enemy");

  it("holds with exactly one enemy unit here", () => {
    expect(holds(withEnemies(1), alone, context([], "mine"))).toBe(true);
  });

  it("does not hold with two", () => {
    expect(holds(withEnemies(2), alone, context([], "mine"))).toBe(false);
  });

  it("does not hold with none", () => {
    expect(holds(withEnemies(0), alone, context([], "mine"))).toBe(false);
  });
});

/** Kinkou Initiate — "When you play me, draw 1 if your other units have total Might 5 or more." */
describe("totalling your other units", () => {
  function initiate(): CardInstance {
    return {
      ...unit("initiate", { might: 2 }),
      abilities: [
        {
          kind: "triggered",
          trigger: { on: "unitPlayed", subject: "self" },
          effect: ifThen(otherUnitsTotalMight(5), draw(1)),
        },
      ],
    };
  }

  function board(otherMight: number): GameState {
    return makeState({
      p1: {
        hand: ["initiate"],
        mainDeck: ["a", "b"],
        runePool: pool({ energy: 9 }),
      },
      cards: [initiate(), unit("other", { might: otherMight }), unit("a"), unit("b")],
      permanents: [{ cardId: "other", controller: "p1" }],
    });
  }

  const PLAY: Action = {
    type: "playUnitFromHand",
    playerId: "p1",
    cardId: "initiate",
  };
  const PASS: Action[] = [
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p2" },
  ];

  it("draws when the total is met", () => {
    const state = run(board(5), [PLAY, ...PASS]);

    expect(state.players.p1.hand).toEqual(["a"]);
  });

  /**
   * "Your *other* units" — the Initiate's own 2 Might is excluded, so a board
   * of 4 stays under the line even once it has entered.
   */
  it("does not count itself", () => {
    const state = run(board(4), [PLAY, ...PASS]);

    expect(state.players.p1.hand).toEqual([]);
  });

  /** The trigger still went on the chain — it simply resolved to nothing. */
  it("still triggers, and resolves to nothing", () => {
    const state = run(board(4), [PLAY]);

    expect(state.chain.map(chainItemCardId)).toEqual(["initiate"]);
  });
});

/**
 * Vex, Apathetic — "When an opponent plays a unit while I'm at a battlefield,
 * [Stun] it." The condition sits immediately after the trigger, so R383.2.a.1
 * makes it part of the Condition: it gates whether the ability triggers at all.
 */
describe("trigger gates (R383.2.a.1)", () => {
  function vex(): CardInstance {
    return {
      ...unit("vex", { might: 4 }),
      abilities: [
        {
          kind: "triggered",
          trigger: { on: "unitPlayed", subject: "enemy" },
          requires: atBattlefield,
          effect: stun(0),
          targeting: { filters: [{ type: "unit", controller: "enemy" }] },
        },
      ],
    };
  }

  function board(vexAt: Location): GameState {
    return makeState({
      p1: { mainDeck: ["a"] },
      p2: {
        hand: ["theirs"],
        mainDeck: ["b", "c"],
        runePool: pool({ energy: 9 }),
      },
      cards: [vex(), unit("theirs", { might: 2 }), unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "vex", controller: "p1", location: vexAt }],
      battlefields: ["bf-north", "bf-south"],
    });
  }

  const P2_PLAYS: Action = {
    type: "playUnitFromHand",
    playerId: "p2",
    cardId: "theirs",
  };

  function onP2sTurn(state: GameState): GameState {
    return { ...state, turn: { player: "p2", phase: "main", number: 2 } };
  }

  it("triggers while the source is at a battlefield", () => {
    const state = run(onP2sTurn(board(NORTH)), [P2_PLAYS]);

    expect(state.chain.map(chainItemCardId)).toEqual(["vex"]);
  });

  it("does not trigger at all from the source's base", () => {
    const state = run(onP2sTurn(board({ kind: "base", player: "p1" })), [
      P2_PLAYS,
    ]);

    expect(state.chain).toHaveLength(0);
  });

  /**
   * R383.2.a.1's Sona example — the gate is checked when the trigger fires and
   * never again, so removing the source in reaction does not undo it: "if she
   * is removed in reaction to the triggered ability, it will still resolve."
   */
  it("still resolves once triggered, even if the source leaves", () => {
    const triggered = run(onP2sTurn(board(NORTH)), [P2_PLAYS]);
    const sourceGone: GameState = {
      ...triggered,
      permanents: Object.fromEntries(
        Object.entries(triggered.permanents).filter(([id]) => id !== "vex"),
      ),
    };

    const state = run(sourceGone, [
      { type: "decide", playerId: "p1", targets: ["theirs"] },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ]);

    expect(state.permanents.theirs?.stunned).toBe(true);
  });

  it("is not confused by the source standing at a different battlefield", () => {
    const state = run(onP2sTurn(board(SOUTH)), [P2_PLAYS]);

    // Any battlefield satisfies "I'm at a battlefield" — it is not "here".
    expect(state.chain.map(chainItemCardId)).toEqual(["vex"]);
  });
});
