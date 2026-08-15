import { describe, expect, it } from "vitest";
import { activateAbility, endTurn, playUnitFromHand } from "../src/actions.js";
import { totals } from "../src/cost.js";
import type { GameState } from "../src/state.js";
import { beginTurn } from "../src/turn.js";
import { cost, makeState, pool, runeCard, unit } from "./fixtures.js";

function board(): GameState {
  return makeState({
    p1: { runeDeck: ["r1", "r2", "r3"], mainDeck: ["u1", "u2"] },
    p2: { runeDeck: ["r4"], mainDeck: [] },
    cards: [
      runeCard("r1", "fury"),
      runeCard("r2", "fury"),
      runeCard("r3", "order"),
      runeCard("r4", "calm"),
      unit("u1", { cost: cost({ energy: 1 }) }),
      unit("u2"),
    ],
  });
}

describe("beginTurn", () => {
  it("runs Awaken through Draw and lands in the Main Phase", () => {
    const { state, events } = beginTurn(board(), "p1", 1);

    expect(state.turn).toEqual({ player: "p1", phase: "main", number: 1 });
    expect(
      events.filter((e) => e.type === "phaseBegan").map((e) => e.phase),
    ).toEqual(["awaken", "beginning", "channel", "draw", "main"]);
  });

  it("channels 2 runes and draws 1 (R315.3, R315.4)", () => {
    const { state } = beginTurn(board(), "p1", 1);

    expect(state.players.p1.runes).toEqual(["r1", "r2"]);
    expect(state.players.p1.runeDeck).toEqual(["r3"]);
    expect(state.players.p1.hand).toEqual(["u1"]);
  });

  it("channels as many as remain when the rune deck is short", () => {
    const { state } = beginTurn(board(), "p2", 1);

    expect(state.players.p2.runes).toEqual(["r4"]);
    expect(state.players.p2.runeDeck).toEqual([]);
  });

  it("readies everything the turn player controls (R315.1)", () => {
    const exhausted: GameState = {
      ...makeState({
        p1: { runes: ["r1"] },
        cards: [runeCard("r1", "fury"), unit("u2")],
        permanents: [{ cardId: "u2", controller: "p1", exhausted: true }],
      }),
      runes: { r1: { cardId: "r1", domain: "fury", exhausted: true } },
    };

    const { state } = beginTurn(exhausted, "p1", 2);

    expect(state.runes.r1?.exhausted).toBe(false);
    expect(state.permanents.u2?.exhausted).toBe(false);
  });

  it("empties every player's pool entering the Main Phase (R316.3)", () => {
    const withPools: GameState = {
      ...board(),
      players: {
        ...board().players,
        p1: { ...board().players.p1, runePool: pool({ energy: 3 }) },
        p2: { ...board().players.p2, runePool: pool({ energy: 2 }) },
      },
    };

    const { state } = beginTurn(withPools, "p1", 1);

    expect(totals(state.players.p1.runePool).energy).toBe(0);
    expect(totals(state.players.p2.runePool).energy).toBe(0);
  });
});

describe("endTurn", () => {
  it("passes the turn to the opponent and starts their turn", () => {
    const start = beginTurn(board(), "p1", 1).state;

    const result = endTurn(start, "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turn).toEqual({ player: "p2", phase: "main", number: 2 });
  });

  it("refuses when it is not your turn", () => {
    const start = beginTurn(board(), "p1", 1).state;

    expect(endTurn(start, "p2")).toEqual({ ok: false, reason: "notYourTurn" });
  });
});

describe("phase and turn gating", () => {
  it("refuses to play a unit on someone else's turn", () => {
    const start = beginTurn(board(), "p2", 1).state;

    expect(playUnitFromHand(start, "p1", "u1")).toEqual({
      ok: false,
      reason: "notYourTurn",
    });
  });

  it("refuses to play a unit outside the Main Phase", () => {
    const start = beginTurn(board(), "p1", 1).state;
    const inDraw: GameState = { ...start, turn: { ...start.turn, phase: "draw" } };

    expect(playUnitFromHand(inDraw, "p1", "u1")).toEqual({
      ok: false,
      reason: "wrongPhase",
    });
  });

  it("allows a [Reaction] rune ability on the opponent's turn (R813)", () => {
    const start = beginTurn(board(), "p1", 1).state;
    const opponentsTurn = endTurn(start, "p1");
    if (!opponentsTurn.ok) throw new Error("setup failed");

    // p1's runes are still on the board; their abilities are printed [Reaction].
    const result = activateAbility(opponentsTurn.state, "p1", "r1", 0);

    expect(result.ok).toBe(true);
  });

  it("refuses a default-timing ability on the opponent's turn (R381)", () => {
    const start = beginTurn(board(), "p1", 1).state;
    const withDefaultTiming: GameState = {
      ...start,
      cards: {
        ...start.cards,
        r1: {
          ...start.cards.r1!,
          abilities: [
            { ...start.cards.r1!.abilities[0]!, timing: "default" as const },
          ],
        },
      },
    };
    const opponentsTurn = endTurn(withDefaultTiming, "p1");
    if (!opponentsTurn.ok) throw new Error("setup failed");

    expect(activateAbility(opponentsTurn.state, "p1", "r1", 0)).toEqual({
      ok: false,
      reason: "notYourTurn",
    });
  });
});
