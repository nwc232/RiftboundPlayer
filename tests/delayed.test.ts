import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  createToken,
  delay,
  grantKeywordFor,
  recall,
  seq,
  takeControl,
} from "../src/builders.js";
import { controllerOf } from "../src/layers.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { beginTurn, endTurn } from "../src/tasks.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function board(
  cards: CardInstance[],
  permanents: {
    cardId: string;
    controller?: "p1" | "p2";
    location?: Location;
  }[],
  battlefields: string[] = ["bf-north"],
): GameState {
  return makeState({
    cards,
    permanents: permanents.map((entry) => ({
      cardId: entry.cardId,
      controller: entry.controller ?? "p1",
      ...(entry.location !== undefined ? { location: entry.location } : {}),
    })),
    battlefields,
  });
}

const CONTEXT = (targets: string[] = []): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

/** Both players pass, resolving whatever is on the chain and letting the
 * remaining turn steps continue (R335). */
function resolveChain(state: GameState): GameState {
  let current = state;
  while (current.chain.length > 0) {
    for (const playerId of ["p1", "p2"] as const) {
      if (current.priority !== playerId) continue;
      const result = applyAction(current, { type: "passPriority", playerId });
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }
  }
  return current;
}

/**
 * R317.1.a — "At the end of the turn Game Effects take place." A delayed effect
 * *fires*; a durational modifier merely stops applying. Hostile Takeover needs
 * both: "Lose control of that unit and recall it at end of turn."
 */
describe("delayed effects (R317.1.a)", () => {
  it("does nothing until the moment arrives", () => {
    const state = board([unit("thrall", { might: 3 })], [
      { cardId: "thrall", controller: "p2", location: NORTH },
    ]);

    const scheduled = execute(state, delay("endOfTurn", recall()), CONTEXT([
      "thrall",
    ])).state;

    expect(scheduled.delayed).toHaveLength(1);
    expect(scheduled.permanents.thrall?.location).toEqual(NORTH);
  });

  it("fires at the end of the turn and is then gone", () => {
    const state = board([unit("thrall", { might: 3 })], [
      { cardId: "thrall", controller: "p2", location: NORTH },
    ]);
    const scheduled = execute(state, delay("endOfTurn", recall()), CONTEXT([
      "thrall",
    ])).state;

    const after = endTurn(scheduled).state;

    expect(after.permanents.thrall?.location).toEqual({
      kind: "base",
      player: "p2",
    });
    expect(after.delayed).toEqual([]);
  });

  /** Hostile Takeover in full: the steal expires *and* the recall fires. */
  it("runs alongside an expiring modifier, in R317's order", () => {
    const state = board([unit("thrall", { might: 3 })], [
      { cardId: "thrall", controller: "p2", location: NORTH },
    ]);

    const taken = execute(
      state,
      seq(takeControl("thisTurn"), delay("endOfTurn", recall())),
      CONTEXT(["thrall"]),
    ).state;
    expect(controllerOf(taken, "thrall")).toBe("p1");

    const after = endTurn(taken).state;

    // R317.1 fires the recall while p1 still controls it, so it goes to p1's
    // base; R317.2.c then expires the steal and p2 controls it again.
    expect(after.permanents.thrall?.location).toEqual({
      kind: "base",
      player: "p1",
    });
    expect(controllerOf(after, "thrall")).toBe("p2");
  });
});

/**
 * R816 — "At the start of this permanent's controller's Beginning Phase,
 * before scoring, kill this."
 */
describe("Temporary (R816)", () => {
  const sprite: CardInstance = {
    ...unit("sprite", { might: 3, keywords: ["temporary"] }),
    name: "Sprite",
  };

  it("triggers at the start of its controller's Beginning Phase", () => {
    const state = board([sprite], [{ cardId: "sprite", location: NORTH }]);

    const opened = beginTurn(state, "p1", 3).state;

    // R816.1 makes it a *triggered* ability, so it goes on the chain and the
    // turn stops there (R335) rather than the unit vanishing silently.
    expect(opened.chain).toHaveLength(1);
    expect(opened.permanents.sprite).toBeDefined();
    expect(opened.turn.phase).toBe("beginning");

    const after = resolveChain(opened);
    expect(after.permanents.sprite).toBeUndefined();
  });

  it("survives the opponent's Beginning Phase — it is its controller's", () => {
    const state = board([sprite], [{ cardId: "sprite", location: NORTH }]);

    const next = beginTurn(state, "p2", 2).state;

    expect(next.permanents.sprite).toBeDefined();
  });

  /**
   * The ordering that decides games: R315.2.a's Beginning Step runs before
   * R315.2.b's Scoring Step, so a Temporary unit cannot Hold for a point.
   */
  it("dies before scoring, so it cannot hold a battlefield for a point", () => {
    const state: GameState = {
      ...board([sprite], [{ cardId: "sprite", location: NORTH }]),
      battlefields: {
        "bf-north": { cardId: "bf-north", controller: "p1", contestedBy: null },
      },
    };

    const next = resolveChain(beginTurn(state, "p1", 3).state);

    expect(next.permanents.sprite).toBeUndefined();
    expect(next.players.p1.points).toBe(0);
    // The turn carried on afterwards rather than stalling on the chain.
    expect(next.turn.phase).toBe("main");
  });

  it("counts a granted Temporary the same as a printed one", () => {
    // Mirror Image — "…It becomes a copy of that unit. Give it [Temporary]."
    const start = board([unit("original", { might: 4 })], [
      { cardId: "original", location: NORTH },
    ]);
    const made = execute(
      start,
      createToken("reflection", 1, { ready: true, copyOfTarget: 0 }),
      CONTEXT(["original"]),
    ).state;
    const tokenId = Object.keys(made.permanents).find(
      (id) => id !== "original",
    )!;
    const marked = execute(
      made,
      grantKeywordFor("temporary", "permanent"),
      { ...CONTEXT([tokenId]) },
    ).state;

    const next = resolveChain(beginTurn(marked, "p1", 3).state);

    expect(next.permanents[tokenId]).toBeUndefined();
    // R186.1 — and being a token, it never reaches a trash.
    expect(next.players.p1.trash).toEqual([]);
    expect(next.permanents.original).toBeDefined();
  });
});
