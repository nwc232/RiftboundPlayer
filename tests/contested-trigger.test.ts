import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { legalActions } from "../src/legal.js";
import type { GameState, Location } from "../src/state.js";
import { irresistibleFaefolk } from "../src/decks/rengar.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

/**
 * A trigger raised by the very move that contests a battlefield.
 *
 * Found in play rather than in a test: Irresistible Faefolk moved from its
 * base onto an *empty* battlefield, which contests it (R190.3.a) and fires the
 * unit's "when I move to a battlefield" at the same moment. The ability landed
 * on the chain and was never asked about — the only thing offered was passing
 * priority, which resolved it having chosen nothing.
 *
 * Two rules had met head on. R344 opens a Showdown only "when the turn is in a
 * Neutral Open State" and R460 wants "no items on the Chain", so the staged
 * showdown could not run while the trigger was pending; R334's HOT FEPR holds
 * the chain behind outstanding tasks, so the trigger could not finalize while
 * the showdown task was queued. Neither could move.
 *
 * It only bites when the destination is *contested* by the same move, which is
 * why moving onto a battlefield you already control always worked.
 */
function board(controlled: boolean): GameState {
  return makeState({
    p1: { runePool: pool({ energy: 9, universalPower: 9 }) },
    cards: [
      { ...irresistibleFaefolk, id: "faefolk" },
      unit("enemy", { might: 2 }),
    ],
    permanents: [
      { cardId: "faefolk", controller: "p1" },
      { cardId: "enemy", controller: "p2", location: SOUTH },
    ],
    battlefields: [controlled ? ["bf-north", "p1"] : "bf-north", "bf-south"],
  });
}

function move(state: GameState): GameState {
  const result = applyAction(state, {
    type: "standardMove",
    playerId: "p1",
    cardId: "faefolk",
    destination: NORTH,
  });
  if (!result.ok) throw new Error(`move refused: ${result.reason}`);
  return result.state;
}

describe("a trigger from the move that contests the battlefield", () => {
  it("asks its 'you may' rather than stranding it on the chain", () => {
    const after = move(board(false));

    expect(after.battlefields["bf-north"]?.contestedBy).toBe("p1");
    expect(after.chain).toHaveLength(1);
    // The bug: `pending` was null here and the only move was passPriority.
    expect(after.pending?.prompt.kind).toBe("confirmOptional");
    expect(legalActions(after, "p1").map((a) => a.type)).not.toContain(
      "passPriority",
    );
  });

  /** Moving onto a battlefield you already control never broke. */
  it("asks the same question on an uncontested move", () => {
    expect(move(board(true)).pending?.prompt.kind).toBe("confirmOptional");
  });

  /**
   * The whole point of the card: the enemy is dragged in from the *other*
   * battlefield, and only then does the showdown open — with them in it.
   */
  it("drags the chosen enemy in, then opens the showdown", () => {
    let state = move(board(false));

    for (const answer of [
      { type: "decide" as const, playerId: "p1" as const, perform: true },
      { type: "decide" as const, playerId: "p1" as const, targets: ["enemy"] },
    ]) {
      const result = applyAction(state, answer);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    for (const who of ["p1", "p2"] as const) {
      if (state.chain.length === 0) break;
      const passed = applyAction(state, { type: "passPriority", playerId: who });
      expect(passed.ok).toBe(true);
      if (!passed.ok) return;
      state = passed.state;
    }

    expect(state.permanents["enemy"]?.location).toEqual(NORTH);
    expect(state.permanents["faefolk"]?.location).toEqual(NORTH);
    // R344 — the showdown the move staged opens once the chain is clear.
    expect(state.showdown?.battlefieldId).toBe("bf-north");
    expect(state.tasks).toEqual([]);
  });

  /** Declining leaves the enemy where they were, and still opens the showdown. */
  it("still opens the showdown when the trigger is declined", () => {
    let state = move(board(false));
    const no = applyAction(state, {
      type: "decide",
      playerId: "p1",
      perform: false,
    });
    expect(no.ok).toBe(true);
    if (!no.ok) return;
    state = no.state;

    expect(state.permanents["enemy"]?.location).toEqual(SOUTH);
    expect(state.showdown?.battlefieldId).toBe("bf-north");
  });
});
