import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  activated,
  draw,
  forEachPlayer,
  scorePoint,
} from "../src/builders.js";
import { legalTargets } from "../src/decisions.js";
import { legalActions } from "../src/legal.js";
import { FREE } from "../src/cost.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";
import { DUEL } from "../src/modes-of-play.js";

const context = (targets: string[] = []): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

/**
 * R133 — players are Game Objects an effect can choose. Fifty cards in the
 * pool take one as their subject ("Choose an opponent. They score 1 point"),
 * and until now a target could only ever be a card.
 */
describe("choosing a player (R133)", () => {
  const board = () =>
    makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [unit("a"), unit("b"), unit("hero", { might: 3 })],
      permanents: [{ cardId: "hero", controller: "p1" }],
    });

  it("offers an opponent, yourself, or either", () => {
    const state = board();

    expect(legalTargets(state, "p1", { type: "player", controller: "enemy" })).toEqual(
      ["p2"],
    );
    expect(
      legalTargets(state, "p1", { type: "player", controller: "friendly" }),
    ).toEqual(["p1"]);
    expect(legalTargets(state, "p1", { type: "player" })).toEqual(["p1", "p2"]);
  });

  it("is relative to whoever is choosing", () => {
    expect(legalTargets(board(), "p2", { type: "player", controller: "enemy" })).toEqual(
      ["p1"],
    );
  });

  /** A player filter does not sweep up cards, and a card filter does not sweep up players. */
  it("does not confuse players with permanents", () => {
    const state = board();

    expect(legalTargets(state, "p1", { type: "unit" })).toEqual(["hero"]);
    expect(legalTargets(state, "p1", { type: "player" })).not.toContain("hero");
  });
});

/** "Choose an opponent. They score 1 point." */
describe("scoring a point", () => {
  function board(): GameState {
    return makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [unit("a"), unit("b")],
    });
  }

  it("scores for the chosen player, not the controller", () => {
    const after = execute(board(), scorePoint(1, 0), context(["p2"]));

    expect(seatOf(after.state, "p2").points).toBe(1);
    expect(seatOf(after.state, "p1").points).toBe(0);
    expect(after.events).toEqual([
      { type: "pointGained", playerId: "p2", points: 1 },
    ]);
  });

  it("scores for the controller when no player is named", () => {
    const after = execute(board(), scorePoint(1), context());

    expect(seatOf(after.state, "p1").points).toBe(1);
  });

  it("does nothing when handed a card instead of a player", () => {
    const after = execute(board(), scorePoint(1, 0), context(["a"]));

    expect(seatOf(after.state, "p1").points).toBe(0);
    expect(seatOf(after.state, "p2").points).toBe(0);
  });

  /**
   * R471.1's near-victory restriction is about *conquering*. A card that
   * simply scores is not conquering, so it is not caught by it.
   */
  it("can take a player to the victory score directly", () => {
    const base = board();
    const nearly: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...seatOf(base, "p1"), points: DUEL.victoryScore - 1 },
      },
    };

    const after = execute(nearly, scorePoint(1), context());
    expect(seatOf(after.state, "p1").points).toBe(DUEL.victoryScore);
  });
});

/**
 * The path that matters: a real spell choosing a real player, discovered by
 * `legalActions` and carried through the action rather than assumed.
 */
describe("a spell that chooses a player", () => {
  const bribe: CardInstance = {
    id: "bribe",
    name: "Bribe",
    type: "spell",
    cost: FREE,
    keywords: [],
    abilities: [
      {
        ...activated([], scorePoint(1, 0)),
        targeting: { filters: [{ type: "player", controller: "enemy" }] },
      },
    ],
  };

  function board(): GameState {
    return makeState({
      p1: { hand: ["bribe"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [bribe, unit("a"), unit("b")],
    });
  }

  it("is offered with the opponent as its target", () => {
    const moves = legalActions(board(), "p1").filter(
      (action) => action.type === "playSpell" && action.cardId === "bribe",
    );

    expect(
      moves.map((action) => (action.type === "playSpell" ? action.targets : [])),
    ).toContainEqual(["p2"]);
  });

  it("refuses a card where it wants a player", () => {
    expect(
      applyAction(board(), {
        type: "playSpell",
        playerId: "p1",
        cardId: "bribe",
        targets: ["a"],
      }),
    ).toEqual({ ok: false, reason: "invalidTarget" });
  });

  it("resolves against the player it chose", () => {
    let current = board();
    for (const action of [
      { type: "playSpell", playerId: "p1", cardId: "bribe", targets: ["p2"] },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }

    expect(seatOf(current, "p2").points).toBe(1);
  });
});

/** "Each player draws 1." / "Each opponent reveals the top card of their deck." */
describe("running an effect for each player", () => {
  function board(): GameState {
    return makeState({
      p1: { hand: [], mainDeck: ["a1", "a2"] },
      p2: { hand: [], mainDeck: ["b1", "b2"] },
      cards: ["a1", "a2", "b1", "b2"].map((id) => unit(id)),
    });
  }

  it("runs it once for each of them", () => {
    const after = execute(board(), forEachPlayer(draw(1, 0)), context());

    expect(seatOf(after.state, "p1").hand).toEqual(["a1"]);
    expect(seatOf(after.state, "p2").hand).toEqual(["b1"]);
  });

  it("can be narrowed to the opponents", () => {
    const after = execute(
      board(),
      forEachPlayer(draw(1, 0), "eachOpponent"),
      context(),
    );

    expect(seatOf(after.state, "p1").hand).toEqual([]);
    expect(seatOf(after.state, "p2").hand).toEqual(["b1"]);
  });

  /** R318's turn order: the effect's controller acts first. */
  it("acts for its controller first", () => {
    const after = execute(board(), forEachPlayer(draw(1, 0)), context());
    const drawn = after.events.filter((event) => event.type === "cardDrawn");

    expect(drawn.map((event) => event.playerId)).toEqual(["p1", "p2"]);
  });

  it("is relative to whoever controls it", () => {
    const after = execute(board(), forEachPlayer(draw(1, 0), "eachOpponent"), {
      ...context(),
      controller: "p2",
    });

    expect(seatOf(after.state, "p1").hand).toEqual(["a1"]);
    expect(seatOf(after.state, "p2").hand).toEqual([]);
  });

  /** The chosen player is appended, so an outer choice keeps its own index. */
  it("counts past whatever the outer effect already chose", () => {
    const after = execute(
      board(),
      forEachPlayer(draw(1, 1), "eachOpponent"),
      context(["ignored"]),
    );

    expect(seatOf(after.state, "p2").hand).toEqual(["b1"]);
  });
});

/** A trigger asks for its player through the same prompt a card goes through. */
describe("a trigger that chooses a player", () => {
  const heckler: CardInstance = {
    ...unit("heckler", { might: 2 }),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: draw(1),
        targeting: { filters: [{ type: "player" }] },
      },
    ],
  };

  it("asks for one, and both players are legal", () => {
    const state = makeState({
      p1: { hand: ["heckler"], mainDeck: ["a", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [heckler, unit("a"), unit("b"), unit("c")],
    });

    const played = applyAction(state, {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: "heckler",
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    expect(played.state.pending?.prompt).toEqual({
      kind: "chooseTargets",
      chainIndex: 0,
      index: 0,
      remaining: 1,
      legal: ["p1", "p2"],
    });
  });
});
