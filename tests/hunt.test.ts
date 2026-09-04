import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { grantKeywordFor } from "../src/builders.js";
import { execute } from "../src/abilities.js";
import { abilitiesOf, characteristicsOf } from "../src/layers.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/**
 * R823.1.c.1 — "[Hunt X]" is "When I Conquer or Hold, my controller gains X
 * XP", and R823.1.b makes it *both* a Conquer effect and a Hold effect.
 */
describe("[Hunt] (R823)", () => {
  function board(hunter: CardInstance): GameState {
    const base = makeState({
      p1: { mainDeck: ["a", "b"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["c"] },
      cards: [hunter, unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "hunter", controller: "p1", location: NORTH }],
      battlefields: ["bf-north"],
    });
    // p1 already holds the battlefield; ending p2's turn scores it (R470).
    return {
      ...base,
      turn: { player: "p2", phase: "main", number: 2 },
      battlefields: {
        "bf-north": { cardId: "bf-north", controller: "p1", contestedBy: null },
      },
    };
  }

  const P2_END: Action = { type: "endTurn", playerId: "p2" };

  function played(state: GameState): GameState {
    const result = applyAction(state, P2_END);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    return result.state;
  }

  it("expands into a Conquer-or-Hold trigger", () => {
    const state = board(unit("hunter", { might: 3, keywords: ["hunt"], hunt: 2 }));

    expect(abilitiesOf(state, "hunter")).toEqual([
      {
        kind: "triggered",
        trigger: { on: "battlefieldScored", subject: "here" },
        effect: { op: "gainXP", amount: 2 },
      },
    ]);
  });

  /** R823.1.c.2 — "If X is omitted, it is presumed to be 1." */
  it("is worth 1 when no value is printed", () => {
    const state = board(unit("hunter", { might: 3, keywords: ["hunt"] }));

    expect(characteristicsOf(state, "hunter").hunt).toBe(1);
  });

  it("gains its controller XP on a Hold", () => {
    const after = played(
      board(unit("hunter", { might: 3, keywords: ["hunt"], hunt: 2 })),
    );

    // The trigger is on the chain; both players pass to resolve it.
    let current = after;
    for (const action of [
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    expect(seatOf(current, "p1").xp).toBe(2);
    // R470 — the hold scored a point as well; Hunt is on top of it.
    expect(seatOf(current, "p1").points).toBe(1);
  });

  it("does nothing for a unit without it", () => {
    const after = played(board(unit("hunter", { might: 3 })));

    expect(seatOf(after, "p1").xp).toBe(0);
    expect(after.chain).toEqual([]);
  });

  /**
   * R823.2 — "the Hunt Value of all granted Hunt keywords is summed", unlike
   * the keywords whose duplicates are simply redundant. The same shape as
   * R807.2's Assault and R814.2's Shield.
   */
  it("sums a granted Hunt Value onto the printed one", () => {
    const state = board(unit("hunter", { might: 3, keywords: ["hunt"], hunt: 2 }));
    const granted = execute(
      state,
      grantKeywordFor("hunt", "thisTurn", 3),
      { controller: "p1", sourceId: "hunter", targets: ["hunter"] },
    ).state;

    expect(characteristicsOf(granted, "hunter").hunt).toBe(5);
    expect(abilitiesOf(granted, "hunter")[0]).toEqual({
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here" },
      effect: { op: "gainXP", amount: 5 },
    });
  });

  /** R823.1.a — on Units, and R471.2 puts the trigger at the battlefield. */
  it("does not fire for a unit standing somewhere else", () => {
    const base = board(unit("hunter", { might: 3, keywords: ["hunt"], hunt: 2 }));
    const inBase: GameState = {
      ...base,
      permanents: {
        ...base.permanents,
        hunter: {
          ...base.permanents.hunter!,
          location: { kind: "base", player: "p1" },
        },
      },
    };

    expect(seatOf(played(inBase), "p1").xp).toBe(0);
  });
});
