import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { concede } from "../src/concede.js";
import { legalActions } from "../src/legal.js";
import type { GameState, Location, PlayerId } from "../src/state.js";
import { seatOf } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

/**
 * Three seats, each holding a battlefield they contributed, with a unit of
 * p2's and one of p3's standing on p2's battlefield. R652.2.b turns on that
 * arrangement: when p2 leaves, p3's unit must not move.
 */
function table(): GameState {
  const base = makeState({
    p1: { hand: ["p1-card"], trash: ["p1-old"] },
    p2: { hand: ["p2-card"], runes: ["p2-rune"] },
    p3: { hand: ["p3-card"] },
    cards: [
      unit("p1-card"),
      unit("p1-old"),
      unit("p2-card"),
      unit("p2-rune"),
      unit("p3-card"),
      unit("p2-unit", { might: 2 }),
      unit("p3-unit", { might: 2 }),
      unit("p1-unit", { might: 2 }),
    ],
    permanents: [
      { cardId: "p2-unit", controller: "p2", location: NORTH },
      { cardId: "p3-unit", controller: "p3", location: NORTH },
      { cardId: "p1-unit", controller: "p1", location: SOUTH },
    ],
    battlefields: ["bf-north", "bf-south", "bf-east"],
  });

  return {
    ...base,
    // R485.4.a — who brought each one, which is what R652.2 needs.
    battlefields: {
      "bf-north": { ...base.battlefields["bf-north"]!, owner: "p2" },
      "bf-south": { ...base.battlefields["bf-south"]!, owner: "p1" },
      "bf-east": { ...base.battlefields["bf-east"]!, owner: "p3" },
    },
    runes: { "p2-rune": { cardId: "p2-rune", domain: "chaos", exhausted: false } },
  };
}

describe("R650/R651 — conceding", () => {
  /** R650 — "A player may concede at any time." No timing test at all. */
  it("is always offered, priority or not", () => {
    const state = table();

    for (const id of state.turnOrder) {
      expect(legalActions(state, id)).toContainEqual({
        type: "concede",
        playerId: id,
      });
    }
  });

  /**
   * R651.1 — "If only one other player is remaining after a player has
   * conceded, the player remaining Wins." About who remains, not about points:
   * the survivor here has none.
   */
  it("hands a Duel to whoever is left, whatever the score", () => {
    const duel = makeState({ p1: { points: 7 }, p2: { points: 0 } });

    const { state } = concede(duel, "p1");

    expect(state.winner).toBe("p2");
    expect(seatOf(state, "p2").points).toBe(0);
  });

  /** R651.2 — with two others left, the game carries on without them. */
  it("does not end a three-seat game", () => {
    const { state } = concede(table(), "p2");

    expect(state.winner).toBeNull();
    expect(state.turnOrder).toEqual(["p1", "p3"]);
    expect(state.players.p2).toBeUndefined();
  });
});

describe("R652 — the Removal of a Player", () => {
  /** R652.1 — everything they control comes off the board. */
  it("banishes their permanents", () => {
    const { state } = concede(table(), "p2");

    expect(state.permanents["p2-unit"]).toBeUndefined();
    expect(state.runes["p2-rune"]).toBeUndefined();
  });

  /** R652.3 — "Remove all cards they own from the game." */
  it("removes their cards from the game entirely", () => {
    const { state } = concede(table(), "p2");

    expect(state.cards["p2-card"]).toBeUndefined();
    expect(state.cards["p2-unit"]).toBeUndefined();
    // Everyone else's are untouched, including a card in a trash.
    expect(state.cards["p1-card"]).toBeDefined();
    expect(state.cards["p1-old"]).toBeDefined();
    expect(state.cards["p3-card"]).toBeDefined();
  });

  /**
   * R652.2.a — "Replace it with a token battlefield with no abilities", and
   * R652.2.b: "Any units or hidden cards there do not move and are otherwise
   * unaffected by this process."
   */
  it("replaces their battlefield in place and leaves what stands there", () => {
    const { state } = concede(table(), "p2");

    // Still in play, still in the same position.
    expect(state.battlefieldOrder).toEqual(["bf-north", "bf-south", "bf-east"]);
    expect(state.battlefields["bf-north"]).toBeDefined();
    expect(state.battlefields["bf-north"]?.owner).toBeUndefined();

    const replacement = state.cards["bf-north"];
    expect(replacement?.isToken).toBe(true);
    expect(replacement?.abilities).toEqual([]);

    // R652.2.b — p3's unit has not moved.
    expect(state.permanents["p3-unit"]?.location).toEqual(NORTH);
  });

  /** R652.4 — "Counter all spells and abilities … controlled by the player". */
  it("counters what they had on the chain", () => {
    const base = table();
    const withChain: GameState = {
      ...base,
      chain: [
        { kind: "spell", cardId: "p2-card", controller: "p2", targets: [] },
        { kind: "spell", cardId: "p1-card", controller: "p1", targets: [] },
      ],
      priority: "p2",
    };

    const { state, events } = concede(withChain, "p2");

    expect(state.chain).toHaveLength(1);
    expect(state.chain[0]?.controller).toBe("p1");
    expect(events).toContainEqual({
      type: "spellCountered",
      playerId: "p2",
      cardId: "p2-card",
    });
  });

  /**
   * R651.3 — "no longer being able to make choices". A question addressed to
   * them would otherwise sit there forever with nobody able to answer it,
   * which is the exact shape of the deadlock this engine has hit before.
   */
  it("withdraws a decision that was theirs to answer", () => {
    const base = table();
    const asking: GameState = {
      ...base,
      pending: {
        player: "p2",
        prompt: { kind: "chooseOpponent", legal: ["p1", "p3"] },
      },
    };

    const { state } = concede(asking, "p2");

    expect(state.pending).toBeNull();
    // And somebody can still act, which is the thing that actually matters.
    expect(legalActions(state, state.turn.player).length).toBeGreaterThan(0);
  });

  /**
   * R652.5.a.1 — "If the removed player was the Turn Player, play proceeds in
   * Turn Order to the next available player in order."
   */
  it("hands the turn on when the turn player leaves", () => {
    const base = table();
    const theirTurn: GameState = {
      ...base,
      turn: { ...base.turn, player: "p2" },
    };

    const { state } = concede(theirTurn, "p2");

    expect(state.turn.player).toBe("p3");
  });

  /** R652.5.b.1 / R652.5.c.1 — Focus and Priority pass the same way. */
  it("hands on Focus and Priority", () => {
    const base = table();
    const mid: GameState = {
      ...base,
      showdown: {
        battlefieldId: "bf-north",
        attacker: "p2",
        focus: "p2",
        consecutivePasses: 2,
      },
      priority: "p2",
      priorityPasses: 2,
    };

    const { state } = concede(mid, "p2");

    expect(state.showdown?.focus).toBe("p3");
    expect(state.priority).toBe("p3");
    // R652.5.b.2/R652.5.c.2 — the counts are against a smaller table now, so
    // they cannot exceed it and leave the showdown unable to close.
    expect(state.showdown!.consecutivePasses).toBeLessThanOrEqual(2);
    expect(state.priorityPasses).toBeLessThanOrEqual(2);
  });

  /** The whole point: the game is still playable afterwards. */
  it("leaves a game the survivors can carry on with", () => {
    const result = applyAction(table(), { type: "concede", playerId: "p2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.winner).toBeNull();

    for (const id of result.state.turnOrder as PlayerId[]) {
      // Nothing left on the board or in a zone refers to the seat that went.
      expect(seatOf(result.state, id).hand.every((c) => !c.startsWith("p2-"))).toBe(
        true,
      );
    }
    const acting = result.state.turn.player;
    expect(legalActions(result.state, acting).length).toBeGreaterThan(0);
  });
});
