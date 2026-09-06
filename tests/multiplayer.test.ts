import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { legalActions } from "../src/legal.js";
import { matchup } from "../src/decks/index.js";
import { closedToOutsiders } from "../src/showdown.js";
import type { GameState, Location, PlayerId } from "../src/state.js";
import {
  nextInTurnOrder,
  opponentsOf,
  seatOf,
  turnOrderFrom,
} from "../src/state.js";
import { drawCards } from "../src/draw.js";
import { runTasks } from "../src/tasks.js";
import { DUEL, SKIRMISH, WAR, modeFor } from "../src/modes-of-play.js";
import { victoryScore } from "../src/scoring.js";
import { checkInvariants } from "./invariants.js";
import { chooseAction } from "./random-play.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/** R117 — answer every setup mulligan, keeping the whole opening hand. */
function keepAll(state: GameState): GameState {
  let current = state;
  while (current.pending?.prompt.kind === "mulligan") {
    const result = applyAction(current, {
      type: "decide",
      playerId: current.pending.player,
      targets: [],
    });
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/** A three-seat board with `at` holding whoever is named at bf-north. */
function threeSeats(at: PlayerId[]): GameState {
  return makeState({
    p3: {},
    cards: [
      ...at.map((_, index) => unit(`u${index}`, { might: 2 })),
      unit("mine", { might: 2 }),
    ],
    permanents: [
      ...at.map((controller, index) => ({
        cardId: `u${index}`,
        controller,
        location: NORTH,
      })),
      { cardId: "mine", controller: "p1" as PlayerId },
    ],
    battlefields: ["bf-north", "bf-south"],
  });
}

describe("turn order is a rotation (R115.1)", () => {
  it("loops back to the first player (R115.1.c)", () => {
    const state = threeSeats([]);

    expect(state.turnOrder).toEqual(["p1", "p2", "p3"]);
    expect(nextInTurnOrder(state, "p1")).toBe("p2");
    expect(nextInTurnOrder(state, "p2")).toBe("p3");
    expect(nextInTurnOrder(state, "p3")).toBe("p1");
  });

  /** R483.2.b — "the number of opponents" is a property of the mode. */
  it("makes an opponent a list rather than the other one", () => {
    const state = threeSeats([]);

    expect(opponentsOf(state, "p2")).toEqual(["p1", "p3"]);
    // R303.2.a sequences from a given player and goes round.
    expect(turnOrderFrom(state, "p2")).toEqual(["p2", "p3", "p1"]);
  });
});

/**
 * R449.2 — "Units cannot Move to a Battlefield that already has units from 2
 * other players present by any means." The rule exists so that R462.3's ban on
 * three-way combat cannot be walked around.
 */
describe("R449.2 — two other players is a full battlefield", () => {
  it("closes a battlefield holding two other players' units", () => {
    const state = threeSeats(["p2", "p3"]);

    expect(closedToOutsiders(state, "bf-north", "p1")).toBe(true);
    // Not to the two who are already standing there.
    expect(closedToOutsiders(state, "bf-north", "p2")).toBe(false);
    expect(closedToOutsiders(state, "bf-north", "p3")).toBe(false);
  });

  it("leaves it open when only one other player is there", () => {
    const state = threeSeats(["p2"]);

    expect(closedToOutsiders(state, "bf-north", "p1")).toBe(false);
  });

  /** The mover's own units never count against them. */
  it("does not count the mover's own units", () => {
    const state = threeSeats(["p1", "p1", "p2"]);

    expect(closedToOutsiders(state, "bf-north", "p1")).toBe(false);
  });

  it("refuses the standard move and never offers it", () => {
    const state = threeSeats(["p2", "p3"]);
    const move: Action = {
      type: "standardMove",
      playerId: "p1",
      cardId: "mine",
      destination: NORTH,
    };

    const result = applyAction(state, move);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalidDestination");

    // `legalActions` is the only legality authority, so it must agree.
    const offered = legalActions(state, "p1").filter(
      (action) =>
        action.type === "standardMove" &&
        action.destination.kind === "battlefield" &&
        action.destination.id === "bf-north",
    );
    expect(offered).toEqual([]);
  });
});

/**
 * R447.2.a / R462.1 — a battlefield with a staged combat is closed to anyone
 * not already there. Explicitly "In Modes of Play with more than two players",
 * which is why the same board with two seats stays open.
 */
describe("R447.2.a — a staged combat closes the door", () => {
  function staged(seats: 2 | 3): GameState {
    const base =
      seats === 3 ? threeSeats(["p2"]) : { ...threeSeats(["p2"]) };
    const board = seats === 3 ? base : { ...base, turnOrder: ["p1", "p2"] as PlayerId[] };
    return {
      ...board,
      battlefields: {
        ...board.battlefields,
        "bf-north": { cardId: "bf-north", controller: null, contestedBy: "p2" },
      },
    };
  }

  it("closes a contested battlefield to a third party", () => {
    expect(closedToOutsiders(staged(3), "bf-north", "p1")).toBe(true);
  });

  /** The rule names the mode, so a Duel is untouched by it. */
  it("does not apply with two seats", () => {
    expect(closedToOutsiders(staged(2), "bf-north", "p1")).toBe(false);
  });

  /** "…or who don't already have Units at that Battlefield." */
  it("stays open to someone already standing there", () => {
    const state = threeSeats(["p2", "p1"]);
    const contested: GameState = {
      ...state,
      battlefields: {
        ...state.battlefields,
        "bf-north": { cardId: "bf-north", controller: null, contestedBy: "p2" },
      },
    };

    expect(closedToOutsiders(contested, "bf-north", "p1")).toBe(false);
  });
});

/**
 * Three and four seats, played start to finish. The point is the same as the
 * two-seat playthroughs: anything `legalActions` offers, `applyAction` must
 * accept — and now also that no board ever reaches a state R462.3 forbids.
 */
describe("whole games with more than two seats", () => {
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  function whoActs(state: GameState): PlayerId {
    if (state.pending !== null) return state.pending.player;
    if (state.chain.length > 0 && state.priority !== null) return state.priority;
    if (state.showdown !== null) return state.showdown.focus;
    return state.turn.player;
  }

  function play(decks: number[], seed: number): GameState {
    const started = startGame(matchup({ decks }));
    if (!started.ok) throw new Error(JSON.stringify(started.errors));

    let state = started.state;
    const rand = lcg(seed);
    let steps = 0;

    while (state.winner === null && steps < 6000) {
      const actor = whoActs(state);
      let options = legalActions(state, actor);
      if (options.length === 0) {
        for (const id of state.turnOrder) {
          options = legalActions(state, id);
          if (options.length > 0) break;
        }
        if (options.length === 0) {
          throw new Error(`nobody can act at step ${steps}`);
        }
      }

      // R650 lets anyone concede at any moment, so `legalActions` offers it
      // every time. A random player who takes it ends the game on move one and
      // exercises nothing, so this one is declined rather than weighted.
      const action = chooseAction(state, options, rand);
      if (action === undefined) {
        throw new Error(`nobody can act at step ${steps}`);
      }

      const result = applyAction(state, action);
      if (!result.ok) {
        throw new Error(
          `legalActions offered an illegal action: ` +
            `${JSON.stringify(action)} → ${result.reason}`,
        );
      }
      state = result.state;
      steps += 1;
      checkInvariants(state, action);
    }

    return state;
  }

  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  /**
   * Every distinct trio and quartet of the five lists, rather than one fixed
   * set. The gear-recall bug (R149.3) lived in a combination the fixed pairs
   * never reached, which is the argument for enumerating them.
   */
  const trios: number[][] = [];
  const quartets: number[][] = [];
  for (let a = 0; a < 5; a += 1) {
    for (let b = a + 1; b < 5; b += 1) {
      for (let c = b + 1; c < 5; c += 1) {
        trios.push([a, b, c]);
        for (let d = c + 1; d < 5; d += 1) quartets.push([a, b, c, d]);
      }
    }
  }

  it.each(trios)("R487 — three seats, decks %i/%i/%i", (a, b, c) => {
    for (let seed = 1; seed <= 3; seed += 1) {
      const state = play([a, b, c], seed);
      expect(state.winner).not.toBeNull();
      expect(state.pending).toBeNull();
    }
  });

  it.each(quartets)("R488 — four seats, decks %i/%i/%i/%i", (a, b, c, d) => {
    for (let seed = 1; seed <= 3; seed += 1) {
      const state = play([a, b, c, d], seed);
      expect(state.winner).not.toBeNull();
      expect(state.turnOrder).toHaveLength(4);
    }
  });

  it.each(seeds)("R487 — three seats, seed %i", (seed) => {
    const state = play([0, 1, 2], seed);

    expect(state.winner).not.toBeNull();
    expect(state.pending).toBeNull();
    // R194.2 — the winner has the score *and* more than anyone else.
    const points = seatOf(state, state.winner!).points;
    expect(points).toBeGreaterThanOrEqual(8);
    for (const other of opponentsOf(state, state.winner!)) {
      expect(points).toBeGreaterThan(seatOf(state, other).points);
    }
  });

  it.each(seeds)("R488 — four seats, seed %i", (seed) => {
    const state = play([0, 1, 2, 3], seed);

    expect(state.winner).not.toBeNull();
    expect(state.pending).toBeNull();
    expect(state.turnOrder).toEqual(["p1", "p2", "p3", "p4"]);
  });

  /**
   * R431.2.c stops being automatic with more than one opponent: "Chooses an
   * opponent to gain 1 point." The playthroughs above would pass a game that
   * never asked, so this asks it directly.
   */
  it("asks a burned-out player which opponent gains the point (R431.2.c)", () => {
    const empty = makeState({
      p1: { mainDeck: [], trash: [] },
      p2: {},
      p3: {},
    });

    const burned = runTasks(drawCards(empty, "p1", 1).state);
    const pending = burned.state.pending;

    expect(pending?.prompt.kind).toBe("chooseOpponent");
    // The burned-out player chooses, and R483.2.b makes the options a list.
    expect(pending?.player).toBe("p1");
    expect(
      pending?.prompt.kind === "chooseOpponent" ? pending.prompt.legal : [],
    ).toEqual(["p2", "p3"]);
    // Nobody has scored while the question is open.
    expect(seatOf(burned.state, "p2").points).toBe(0);
    expect(seatOf(burned.state, "p3").points).toBe(0);

    const answered = applyAction(burned.state, {
      type: "decide",
      playerId: "p1",
      targets: ["p3"],
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(seatOf(answered.state, "p3").points).toBe(1);
    expect(seatOf(answered.state, "p2").points).toBe(0);
  });

  /** With one opponent there is nothing to ask, so a Duel never stops. */
  it("never asks in a Duel", () => {
    const empty = makeState({ p1: { mainDeck: [], trash: [] } });

    const burned = runTasks(drawCards(empty, "p1", 1).state);

    expect(burned.state.pending).toBeNull();
    expect(seatOf(burned.state, "p2").points).toBe(1);
  });
});

/**
 * R483 — what a Mode of Play defines, and the parts of it the engine has to
 * read during a game rather than only at setup.
 */
describe("R487/R488 — the modes themselves", () => {
  it("seats three for a Skirmish and four for a War (R487.1/R488.1)", () => {
    expect(modeFor(3)).toBe(SKIRMISH);
    expect(modeFor(4)).toBe(WAR);
    expect(modeFor(2)).toBe(DUEL);
  });

  /**
   * R488.4.b — "The player who is taking the first turn removes their
   * Battlefields." Four seats, three battlefields; R487's three seats each
   * present one.
   */
  it("puts three battlefields in play for both (R487.4/R488.4)", () => {
    const skirmish = startGame(matchup({ decks: [0, 1, 2] }));
    const war = startGame(matchup({ decks: [0, 1, 2, 3] }));

    expect(skirmish.ok).toBe(true);
    expect(war.ok).toBe(true);
    if (!skirmish.ok || !war.ok) return;
    expect(skirmish.state.battlefieldOrder).toHaveLength(3);
    expect(war.state.battlefieldOrder).toHaveLength(3);
    // The one the first player would have brought is not among them.
    const first = war.state.turnOrder[0]!;
    const theirs = matchup({ decks: [0, 1, 2, 3] }).seats[first]!.deck
      .battlefields;
    for (const id of theirs) {
      expect(war.state.battlefieldOrder).not.toContain(id);
    }
  });

  /** R483.4 — the wrong count is a setup error, not a playable game. */
  it("refuses a mode's wrong number of battlefields (R483.4)", () => {
    const base = matchup({ decks: [0, 1, 2] });
    const short = {
      ...base,
      seats: {
        ...base.seats,
        p3: { deck: base.seats.p3!.deck },
      },
    };

    const result = startGame(short);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.p1).toEqual(["wrongBattlefieldsInPlay"]);
  });

  /**
   * R487.7 / R488.7 — "The player going first does not draw a card during
   * their first Draw Phase of the game." R485.7's Duel says no such thing.
   */
  it("skips the first player's first draw in a Skirmish (R487.7)", () => {
    const started = startGame(matchup({ decks: [0, 1, 2] }));
    if (!started.ok) throw new Error("setup");

    const state = keepAll(started.state);
    const first = state.turnOrder[0]!;
    // R116 deals four; the first player is still on four after their Draw
    // Phase, and everyone else will draw when their own turn comes round.
    expect(seatOf(state, first).hand).toHaveLength(4);
  });

  it("does not skip it in a Duel (R485.7)", () => {
    const started = startGame(matchup());
    if (!started.ok) throw new Error("setup");

    const state = keepAll(started.state);
    expect(seatOf(state, state.turnOrder[0]!).hand).toHaveLength(5);
  });

  /** R483.3 — every mode without teams sets the Victory Score at 8. */
  it("reads the Victory Score off the mode (R483.3)", () => {
    const started = startGame(matchup({ decks: [0, 1, 2] }));
    if (!started.ok) throw new Error("setup");

    expect(victoryScore(started.state)).toBe(8);
    expect(started.state.mode).toBe("skirmish");
  });
});
