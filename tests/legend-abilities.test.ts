import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { activated, draw, exhaustSelf } from "../src/builders.js";
import { legalActions } from "../src/legal.js";
import { FREE } from "../src/cost.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * R107.4.c — "The Champion Legend here is a Game Object."
 *
 * A Legend is not a permanent: it lives in the Legend Zone, which R107.4.b
 * says is not a location, and its exhausted state lives on the player because
 * it has no permanent to carry one. Everything that looked for a source by
 * walking `state.permanents` therefore walked straight past it.
 *
 * Several printed Legends have activated abilities — Blind Monk's "[1],
 * [exhaust]: Buff a friendly unit", Keeper of the Hammer's "Spend 3 XP,
 * [exhaust]: Draw 1", Herald of the Arcane's Recruit token.
 */

/** The shape Blind Monk and Keeper of the Hammer both take. */
const scholar: CardInstance = {
  id: "scholar",
  name: "Scholar",
  type: "legend",
  cost: FREE,
  keywords: [],
  tags: ["Scholar"],
  abilities: [activated([exhaustSelf], draw(1))],
};

function board(): GameState {
  return makeState({
    p1: {
      legend: "scholar",
      mainDeck: ["d1", "d2"],
      runePool: pool({ energy: 9 }),
    },
    p2: { mainDeck: ["d3"] },
    cards: [scholar, unit("d1"), unit("d2"), unit("d3")],
  });
}

describe("a Legend's activated ability", () => {
  it("is offered by legalActions", () => {
    const moves = legalActions(board(), "p1").filter(
      (action) =>
        action.type === "activateAbility" && action.sourceId === "scholar",
    );

    expect(moves).toHaveLength(1);
  });

  it("can actually be activated", () => {
    const result = applyAction(board(), {
      type: "activateAbility",
      playerId: "p1",
      sourceId: "scholar",
      abilityIndex: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.p1.hand).toHaveLength(1);
    // R107.4.c — the exhausted state lives on the player, not a permanent.
    expect(result.state.players.p1.legendExhausted).toBe(true);
  });

  /** R414.1.b — and once exhausted it cannot pay the cost again. */
  it("stops being offered once it is exhausted", () => {
    const state = board();
    const spent: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, legendExhausted: true },
      },
    };

    expect(
      legalActions(spent, "p1").filter(
        (action) =>
          action.type === "activateAbility" && action.sourceId === "scholar",
      ),
    ).toEqual([]);
  });

  /** It is *your* legend, not everyone's. */
  it("is not offered to the opponent", () => {
    expect(
      legalActions(board(), "p2").filter(
        (action) =>
          action.type === "activateAbility" && action.sourceId === "scholar",
      ),
    ).toEqual([]);
  });
});
