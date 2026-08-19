import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import type { GameEvent } from "../src/events.js";
import { VICTORY_SCORE } from "../src/scoring.js";
import { runCleanup } from "../src/showdown.js";
import type { GameState, Location } from "../src/state.js";
import { beginTurn } from "../src/turn.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/** A unit of p1's, ready in base, with two battlefields on the board. */
function board(overrides: Partial<GameState> = {}): GameState {
  return {
    ...makeState({
      cards: [unit("u1"), unit("e1")],
      permanents: [{ cardId: "u1", controller: "p1" }],
      battlefields: ["bf-north", "bf-south"],
    }),
    ...overrides,
  };
}

function run(state: GameState, actions: Action[]) {
  let current = state;
  const log: GameEvent[] = [];
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
    log.push(...result.events);
  }
  return { state: current, log };
}

const MOVE_NORTH: Action = {
  type: "standardMove",
  playerId: "p1",
  cardId: "u1",
  destination: NORTH,
};
const P1_PASS: Action = { type: "passFocus", playerId: "p1" };
const P2_PASS: Action = { type: "passFocus", playerId: "p2" };

describe("opening a showdown", () => {
  it("opens at the contested battlefield in the cleanup after the move (R344.2)", () => {
    const { state } = run(board(), [MOVE_NORTH]);

    expect(state.showdown).toEqual({
      battlefieldId: "bf-north",
      attacker: "p1",
      focus: "p1",
      consecutivePasses: 0,
    });
  });

  it("gives Focus to whoever applied Contested, not the turn player (R345)", () => {
    // p2 owns the unit but it is p1's turn, so p2 is the attacker here.
    const opposing = makeState({
      cards: [unit("x1")],
      permanents: [{ cardId: "x1", controller: "p2" }],
      battlefields: ["bf-north"],
    });
    const contested: GameState = {
      ...opposing,
      permanents: {
        x1: {
          cardId: "x1",
          controller: "p2",
          exhausted: false,
          location: NORTH,
          damage: 0,
        },
      },
      battlefields: {
        "bf-north": {
          cardId: "bf-north",
          controller: null,
          contestedBy: "p2",
        },
      },
    };

    // The cleanup is what opens the showdown and assigns Focus.
    const opened = runCleanup(contested).state;
    expect(opened.showdown?.attacker).toBe("p2");
    expect(opened.showdown?.focus).toBe("p2");

    const { state } = run(opened, [P2_PASS, P1_PASS]);

    // p2 established control despite it being p1's turn.
    expect(state.battlefields["bf-north"]?.controller).toBe("p2");
  });

  it("blocks moves and card plays while a showdown is open (R144.1.c, R343.1.a)", () => {
    const { state } = run(board(), [MOVE_NORTH]);

    expect(
      applyAction(state, {
        type: "standardMove",
        playerId: "p1",
        cardId: "u1",
        destination: { kind: "base", player: "p1" },
      }),
    ).toEqual({ ok: false, reason: "showdownInProgress" });
  });

  it("refuses a pass from the player without Focus", () => {
    const { state } = run(board(), [MOVE_NORTH]);

    expect(applyAction(state, P2_PASS)).toEqual({
      ok: false,
      reason: "notYourFocus",
    });
  });
});

describe("closing a showdown", () => {
  it("establishes control and conquers when both players pass (R348.2)", () => {
    const { state, log } = run(board(), [MOVE_NORTH, P1_PASS, P2_PASS]);

    expect(state.showdown).toBeNull();
    expect(state.battlefields["bf-north"]?.controller).toBe("p1");
    expect(state.battlefields["bf-north"]?.contestedBy).toBeNull();
    expect(state.players.p1.points).toBe(1);
    expect(log.map((e) => e.type)).toContain("battlefieldControlled");
    expect(log.map((e) => e.type)).toContain("battlefieldScored");
  });

  it("only scores a battlefield once per turn (R470)", () => {
    const { state } = run(board(), [MOVE_NORTH, P1_PASS, P2_PASS]);

    expect(state.players.p1.scoredThisTurn).toEqual(["bf-north"]);
    expect(state.players.p1.points).toBe(1);
  });
});

describe("holding", () => {
  it("holds a controlled battlefield at the start of your turn (R315.2.b)", () => {
    const conquered = run(board(), [MOVE_NORTH, P1_PASS, P2_PASS]).state;

    // p1 ends, p2's turn runs, then p1's turn begins and holds bf-north.
    const p2Turn = beginTurn(conquered, "p2", 2).state;
    const { state } = beginTurn(p2Turn, "p1", 3);

    expect(state.players.p1.points).toBe(2);
    expect(state.players.p1.scoredThisTurn).toEqual(["bf-north"]);
  });

  it("loses control in a cleanup once no units remain there (R190.4.c)", () => {
    const conquered = run(board(), [MOVE_NORTH, P1_PASS, P2_PASS]).state;
    const readied = beginTurn(conquered, "p1", 3).state;

    const { state } = run(readied, [
      {
        type: "standardMove",
        playerId: "p1",
        cardId: "u1",
        destination: { kind: "base", player: "p1" },
      },
    ]);

    expect(state.battlefields["bf-north"]?.controller).toBeNull();
  });
});

describe("winning", () => {
  it("wins at the victory score once every battlefield is scored (R471.1.b, R194.2)", () => {
    const nearlyWon = board({
      players: {
        ...board().players,
        p1: {
          ...board().players.p1,
          points: VICTORY_SCORE - 1,
          scoredThisTurn: ["bf-south"],
        },
      },
    });

    const { state, log } = run(nearlyWon, [MOVE_NORTH, P1_PASS, P2_PASS]);

    expect(state.players.p1.points).toBe(VICTORY_SCORE);
    expect(state.winner).toBe("p1");
    expect(log.map((e) => e.type)).toContain("gameWon");
  });

  it("draws instead of taking the final point when the board is not fully scored", () => {
    const nearlyWon = board({
      players: {
        ...board().players,
        p1: {
          ...board().players.p1,
          points: VICTORY_SCORE - 1,
          mainDeck: ["e1"],
        },
      },
    });

    const { state } = run(nearlyWon, [MOVE_NORTH, P1_PASS, P2_PASS]);

    expect(state.players.p1.points).toBe(VICTORY_SCORE - 1);
    expect(state.players.p1.hand).toEqual(["e1"]);
    expect(state.winner).toBeNull();
  });

  it("refuses every action once the game is over", () => {
    const nearlyWon = board({
      players: {
        ...board().players,
        p1: {
          ...board().players.p1,
          points: VICTORY_SCORE - 1,
          scoredThisTurn: ["bf-south"],
        },
      },
    });
    const { state } = run(nearlyWon, [MOVE_NORTH, P1_PASS, P2_PASS]);

    expect(applyAction(state, { type: "endTurn", playerId: "p1" })).toEqual({
      ok: false,
      reason: "gameOver",
    });
  });
});
