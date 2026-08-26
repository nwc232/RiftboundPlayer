import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { controlsOtherUnits, entersReady } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { entryReplacementsOf } from "../src/replacements.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

function board(card: CardInstance, extras: CardInstance[] = []): GameState {
  return makeState({
    p1: {
      hand: [card.id],
      mainDeck: ["a", "b"],
      runePool: pool({
        energy: 9,
        power: { body: 3, fury: 3 },
        universalPower: 3,
      }),
    },
    p2: { mainDeck: ["c"] },
    cards: [card, ...extras, unit("a"), unit("b"), unit("c")],
    permanents: extras.map((extra) => ({
      cardId: extra.id,
      controller: "p1" as const,
    })),
  });
}

const PLAY = (cardId: string, payOptional = false): Action => ({
  type: "playUnitFromHand",
  playerId: "p1",
  cardId,
  payOptional,
});

/**
 * R369.3 — "Replacement Effects that apply to a unit as it enters the Board
 * can be identified by describing how the unit enters." R359.2.c's default is
 * exhausted; these replace that event.
 */
describe("entering the board (R369.3)", () => {
  it("enters exhausted by default (R359.2.c)", () => {
    const plain = unit("plain", { might: 2 });

    expect(run(board(plain), [PLAY("plain")]).permanents.plain?.exhausted).toBe(
      true,
    );
  });

  /** The "I enter ready" family — 29 cards in the pool say exactly this. */
  it("enters ready when the card says so", () => {
    const eager: CardInstance = {
      ...unit("eager", { might: 2 }),
      abilities: [entersReady()],
    };

    expect(run(board(eager), [PLAY("eager")]).permanents.eager?.exhausted).toBe(
      false,
    );
  });

  /** Xin Zhao, Vigilant — "I enter ready if you have two or more other units." */
  describe("a conditional one", () => {
    const conditional: CardInstance = {
      ...unit("xin", { might: 3 }),
      abilities: [entersReady(controlsOtherUnits(2))],
    };

    it("applies when the condition holds", () => {
      const withFriends = board(conditional, [
        unit("f1", { might: 1 }),
        unit("f2", { might: 1 }),
      ]);

      expect(run(withFriends, [PLAY("xin")]).permanents.xin?.exhausted).toBe(
        false,
      );
    });

    it("does not when it does not", () => {
      const alone = board(conditional, [unit("f1", { might: 1 })]);

      expect(run(alone, [PLAY("xin")]).permanents.xin?.exhausted).toBe(true);
    });

    /** "*other* units" — the card itself has not entered yet either way. */
    it("does not count itself", () => {
      const two = board(conditional, [
        unit("f1", { might: 1 }),
        unit("f2", { might: 1 }),
      ]);
      const state = run(two, [PLAY("xin")]);

      expect(state.permanents.xin).toBeDefined();
    });
  });

  /**
   * R805.1.a — [Accelerate] is "you may pay [1][C] as an additional cost. If
   * you do, I enter ready", so the keyword *is* a conditional entry
   * replacement rather than a case spelled out at the play site.
   */
  describe("[Accelerate] as one of these", () => {
    const kaisa: CardInstance = {
      ...unit("kaisa", { might: 4, cost: { ...FREE, energy: 2 } }),
      keywords: ["accelerate"],
      domains: ["fury"],
    };

    it("is derived from the keyword", () => {
      expect(entryReplacementsOf(board(kaisa), "kaisa")).toEqual([
        { ready: true, when: { kind: "paidAdditionalCost" } },
      ]);
    });

    it("enters ready only when the cost was paid", () => {
      expect(
        run(board(kaisa), [PLAY("kaisa", true)]).permanents.kaisa?.exhausted,
      ).toBe(false);
      expect(
        run(board(kaisa), [PLAY("kaisa", false)]).permanents.kaisa?.exhausted,
      ).toBe(true);
    });
  });

  /** R359.2.d — non-unit gear enters ready without needing a replacement. */
  it("leaves gear alone", () => {
    const gear: CardInstance = {
      id: "gear",
      name: "Some Gear",
      type: "gear",
      cost: FREE,
      keywords: [],
      abilities: [],
    };

    expect(run(board(gear), [PLAY("gear")]).permanents.gear?.exhausted).toBe(
      false,
    );
  });
});
