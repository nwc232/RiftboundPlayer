import { describe, expect, it } from "vitest";
import { playUnitFromHand, standardMove } from "../src/actions.js";
import type { GameState, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const BASE: Location = { kind: "base", player: "p1" };
const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

function board(options: { keywords?: "ganking"[]; at?: Location } = {}): GameState {
  return makeState({
    cards: [unit("u1", { keywords: options.keywords ?? [] })],
    permanents: [
      { cardId: "u1", controller: "p1", location: options.at ?? BASE },
    ],
    battlefields: ["bf-north", "bf-south"],
  });
}

describe("standardMove", () => {
  it("moves a unit from its base to a battlefield and exhausts it (R144.2)", () => {
    const result = standardMove(board(), "p1", "u1", NORTH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.u1?.location).toEqual(NORTH);
    expect(result.state.permanents.u1?.exhausted).toBe(true);
    expect(result.events).toEqual([
      { type: "unitMoved", playerId: "p1", cardId: "u1", from: BASE, to: NORTH },
    ]);
  });

  it("moves a unit from a battlefield back to its base (R144.4.b)", () => {
    const result = standardMove(board({ at: NORTH }), "p1", "u1", BASE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.u1?.location).toEqual(BASE);
  });

  it("refuses battlefield to battlefield without Ganking (R144.4.c)", () => {
    expect(standardMove(board({ at: NORTH }), "p1", "u1", SOUTH)).toEqual({
      ok: false,
      reason: "invalidDestination",
    });
  });

  it("allows battlefield to battlefield with Ganking (R810)", () => {
    const withGanking = board({ at: NORTH, keywords: ["ganking"] });

    const result = standardMove(withGanking, "p1", "u1", SOUTH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.u1?.location).toEqual(SOUTH);
  });

  it("refuses to move an exhausted unit — it cannot pay the cost", () => {
    const exhausted = makeState({
      cards: [unit("u1")],
      permanents: [{ cardId: "u1", controller: "p1", exhausted: true }],
      battlefields: ["bf-north"],
    });

    expect(standardMove(exhausted, "p1", "u1", NORTH)).toEqual({
      ok: false,
      reason: "alreadyExhausted",
    });
  });

  it("refuses to move a unit the player does not control", () => {
    expect(standardMove(board(), "p2", "u1", NORTH)).toEqual({
      ok: false,
      reason: "notYourTurn",
    });
  });

  it("refuses a battlefield that does not exist", () => {
    expect(
      standardMove(board(), "p1", "u1", { kind: "battlefield", id: "nowhere" }),
    ).toEqual({ ok: false, reason: "invalidDestination" });
  });

  it("refuses to move to the opponent's base", () => {
    expect(
      standardMove(board(), "p1", "u1", { kind: "base", player: "p2" }),
    ).toEqual({ ok: false, reason: "invalidDestination" });
  });
});

describe("contested status (R190.3.a)", () => {
  it("marks a battlefield contested when an opposing unit arrives", () => {
    const result = standardMove(board(), "p1", "u1", NORTH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.battlefields["bf-north"]?.contestedBy).toBe("p1");
  });

  it("does not mark it contested when the mover already controls it", () => {
    const controlled: GameState = {
      ...board(),
      battlefields: {
        "bf-north": { cardId: "bf-north", controller: "p1", contestedBy: null },
      },
    };

    const result = standardMove(controlled, "p1", "u1", NORTH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.battlefields["bf-north"]?.contestedBy).toBeNull();
  });

  /**
   * R355.2.a only lets a unit be played to its controller's base or a
   * battlefield they control, so reaching an enemy-held one takes a permission
   * — here Rengar, Trophy Hunter's (R822.1.d).
   */
  it("applies when a unit is played straight to a battlefield", () => {
    const inHand = makeState({
      p1: { hand: ["u1"] },
      cards: [
        {
          ...unit("u1"),
          abilities: [
            { kind: "playPermission", permission: { kind: "whereEnemyUnits" } },
          ],
        },
        unit("e1"),
      ],
      permanents: [{ cardId: "e1", controller: "p2", location: NORTH }],
      battlefields: ["bf-north"],
    });

    const result = playUnitFromHand(inHand, "p1", "u1", NORTH);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.u1?.location).toEqual(NORTH);
    expect(result.state.battlefields["bf-north"]?.contestedBy).toBe("p1");
  });
});
