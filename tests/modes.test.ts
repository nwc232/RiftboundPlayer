import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  activated,
  banish,
  dealDamage,
  draw,
  mode,
  repeat,
  returnToHand,
} from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { legalActions } from "../src/legal.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * Rocket Barrage — "[Repeat] [4][Mind]. Choose one — Deal 4 to a unit in a
 * base. [or] Kill a gear." The two arms want different things, which is the
 * whole reason targeting travels with the mode.
 */
function barrage(options: { repeats?: boolean; distinct?: true } = {}): CardInstance {
  return {
    id: "barrage",
    name: "Rocket Barrage",
    type: "spell",
    cost: { ...FREE, energy: 1 },
    keywords: [],
    abilities: [
      {
        ...activated([], draw(1)),
        modes: [
          mode(dealDamage(4), {
            filters: [{ type: "unit", controller: "enemy" }],
          }),
          mode(banish(), { filters: [{ type: "gear", controller: "enemy" }] }),
        ],
        ...(options.distinct === true ? { distinctModes: true as const } : {}),
      },
      ...(options.repeats === true ? [repeat({ energy: 1 })] : []),
    ],
  };
}

function board(card: CardInstance = barrage()): GameState {
  return makeState({
    p1: { hand: [card.id], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
    p2: { mainDeck: ["b"] },
    cards: [
      card,
      unit("ogre", { might: 9 }),
      unit("imp", { might: 9 }),
      { ...unit("relic"), type: "gear" as const },
      unit("a"),
      unit("b"),
    ],
    permanents: [
      { cardId: "ogre", controller: "p2" },
      { cardId: "imp", controller: "p2" },
      { cardId: "relic", controller: "p2" },
    ],
  });
}

function resolve(state: GameState, action: Action): GameState {
  let current = state;
  for (const each of [
    action,
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p2" },
  ] as Action[]) {
    const result = applyAction(current, each);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

describe('modal effects — "Choose one —"', () => {
  it("runs the arm that was chosen", () => {
    const first = resolve(board(), {
      type: "playSpell",
      playerId: "p1",
      cardId: "barrage",
      targets: ["ogre"],
      modes: [0],
    });
    expect(first.permanents.ogre?.damage).toBe(4);
    expect(first.permanents.relic).toBeDefined();

    const second = resolve(board(), {
      type: "playSpell",
      playerId: "p1",
      cardId: "barrage",
      targets: ["relic"],
      modes: [1],
    });
    expect(second.permanents.relic).toBeUndefined();
    expect(second.permanents.ogre?.damage ?? 0).toBe(0);
  });

  /** Each arm judges its own targets — a unit is not a legal "kill a gear". */
  it("holds each arm to its own filter", () => {
    expect(
      applyAction(board(), {
        type: "playSpell",
        playerId: "p1",
        cardId: "barrage",
        targets: ["ogre"],
        modes: [1],
      }),
    ).toEqual({ ok: false, reason: "invalidTarget" });
  });

  it("refuses an arm the card does not have", () => {
    expect(
      applyAction(board(), {
        type: "playSpell",
        playerId: "p1",
        cardId: "barrage",
        targets: ["ogre"],
        modes: [2],
      }),
    ).toEqual({ ok: false, reason: "invalidMode" });
  });

  it("wants exactly one arm per execution", () => {
    expect(
      applyAction(board(), {
        type: "playSpell",
        playerId: "p1",
        cardId: "barrage",
        targets: ["ogre"],
        modes: [],
      }),
    ).toEqual({ ok: false, reason: "wrongModeCount" });
  });

  /**
   * R820.2.a's worked example, verbatim: "they may choose the same mode or a
   * different one, and if they choose the same mode, may choose the same
   * target or a different one."
   */
  describe("with [Repeat] (R820.2.a)", () => {
    const repeated = () => barrage({ repeats: true });

    it("lets the two executions take different arms", () => {
      const after = resolve(board(repeated()), {
        type: "playSpell",
        playerId: "p1",
        cardId: "barrage",
        targets: ["ogre", "relic"],
        payRepeats: [0],
        modes: [0, 1],
      });

      expect(after.permanents.ogre?.damage).toBe(4);
      expect(after.permanents.relic).toBeUndefined();
    });

    it("lets them take the same arm at different targets", () => {
      const after = resolve(board(repeated()), {
        type: "playSpell",
        playerId: "p1",
        cardId: "barrage",
        targets: ["ogre", "imp"],
        payRepeats: [0],
        modes: [0, 0],
      });

      expect(after.permanents.ogre?.damage).toBe(4);
      expect(after.permanents.imp?.damage).toBe(4);
    });

    /**
     * The reason the offsets accumulate rather than using a fixed stride: two
     * arms of the same card can want different numbers of things, so the
     * second execution's targets do not start at a predictable index.
     */
    it("counts targets per arm, not per execution", () => {
      const lopsided: CardInstance = {
        ...barrage({ repeats: true }),
        abilities: [
          {
            ...activated([], draw(1)),
            modes: [
              mode(draw(1)),
              mode(dealDamage(4), {
                filters: [{ type: "unit", controller: "enemy" }],
              }),
            ],
          },
          repeat({ energy: 1 }),
        ],
      };

      // Arm 0 wants nothing, arm 1 wants one unit — so the whole play wants
      // exactly one target, not two.
      const after = resolve(board(lopsided), {
        type: "playSpell",
        playerId: "p1",
        cardId: "barrage",
        targets: ["ogre"],
        payRepeats: [0],
        modes: [0, 1],
      });

      expect(after.permanents.ogre?.damage).toBe(4);
      // Arm 0 drew, which it could not have done if the play had been rejected
      // for the "wrong" number of targets.
      expect(after.players.p1.hand).toEqual(["a"]);
    });

    /** Curtain Call — "Choose one **you haven't already chosen**." */
    it("refuses a repeated arm when the card forbids it", () => {
      const strict = barrage({ repeats: true, distinct: true });

      expect(
        applyAction(board(strict), {
          type: "playSpell",
          playerId: "p1",
          cardId: "barrage",
          targets: ["ogre", "imp"],
          payRepeats: [0],
          modes: [0, 0],
        }),
      ).toEqual({ ok: false, reason: "invalidMode" });

      expect(
        applyAction(board(strict), {
          type: "playSpell",
          playerId: "p1",
          cardId: "barrage",
          targets: ["ogre", "relic"],
          payRepeats: [0],
          modes: [0, 1],
        }).ok,
      ).toBe(true);
    });
  });

  /**
   * `legalActions` is the only legality authority — an arm it cannot offer is
   * an arm no player can take.
   */
  describe("finding the arms", () => {
    it("offers both, each with its own targets", () => {
      const moves = legalActions(board(), "p1").filter(
        (action) => action.type === "playSpell" && action.cardId === "barrage",
      );
      const byMode = (m: number) =>
        moves.filter(
          (action) => action.type === "playSpell" && action.modes?.[0] === m,
        );

      expect(byMode(0).map((a) => (a.type === "playSpell" ? a.targets : []))).toEqual(
        expect.arrayContaining([["ogre"], ["imp"]]),
      );
      expect(byMode(1).map((a) => (a.type === "playSpell" ? a.targets : []))).toEqual([
        ["relic"],
      ]);
    });

    it("offers every combination of arms across a repeat", () => {
      const moves = legalActions(board(barrage({ repeats: true })), "p1").filter(
        (action) =>
          action.type === "playSpell" && (action.payRepeats ?? []).length === 1,
      );
      const combos = new Set(
        moves.map((action) =>
          action.type === "playSpell" ? (action.modes ?? []).join(",") : "",
        ),
      );

      expect(combos).toEqual(new Set(["0,0", "0,1", "1,0", "1,1"]));
    });

    it("offers nothing that applyAction would refuse", () => {
      const state = board(barrage({ repeats: true }));
      for (const action of legalActions(state, "p1")) {
        expect(applyAction(state, action).ok).toBe(true);
      }
    });
  });
});

/**
 * Minah Swiftfoot — "when I move to a battlefield, choose one — …". A trigger
 * cannot carry its choice in the action, so it is asked as the item finalizes,
 * before its targets.
 */
describe("a modal trigger", () => {
  const minah: CardInstance = {
    ...unit("minah", { might: 3 }),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: draw(1),
        modes: [
          mode(draw(2)),
          mode(returnToHand(), {
            filters: [{ type: "unit", controller: "enemy" }],
          }),
        ],
      },
    ],
  };

  function board(): GameState {
    return makeState({
      p1: { hand: ["minah"], mainDeck: ["a", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [minah, unit("ogre", { might: 9 }), unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "ogre", controller: "p2" }],
    });
  }

  const PLAY: Action = {
    type: "playUnitFromHand",
    playerId: "p1",
    cardId: "minah",
  };

  it("asks for the arm before the targets", () => {
    const played = applyAction(board(), PLAY);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    expect(played.state.pending?.prompt).toEqual({
      kind: "chooseMode",
      chainIndex: 0,
      legal: [0, 1],
    });
  });

  it("asks for nothing more when the chosen arm wants nothing", () => {
    const played = applyAction(board(), PLAY);
    if (!played.ok) throw new Error("rejected");

    const chosen = applyAction(played.state, {
      type: "decide",
      playerId: "p1",
      targets: ["0"],
    });
    if (!chosen.ok) throw new Error("rejected");

    expect(chosen.state.pending).toBeNull();
    expect(chosen.state.chain[0]).toMatchObject({ mode: 0 });
  });

  it("asks for the other arm's target, and runs it", () => {
    const played = applyAction(board(), PLAY);
    if (!played.ok) throw new Error("rejected");

    let current = played.state;
    for (const action of [
      { type: "decide", playerId: "p1", targets: ["1"] },
      { type: "decide", playerId: "p1", targets: ["ogre"] },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    expect(current.permanents.ogre).toBeUndefined();
    expect(current.players.p2.hand).toContain("ogre");
  });

  it("offers the arms through legalActions", () => {
    const played = applyAction(board(), PLAY);
    if (!played.ok) throw new Error("rejected");

    const answers = legalActions(played.state, "p1").map((action) =>
      action.type === "decide" ? action.targets : null,
    );
    expect(answers).toContainEqual(["0"]);
    expect(answers).toContainEqual(["1"]);
  });
});
