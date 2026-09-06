import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import { detach, raiseVictoryScore } from "../src/builders.js";
import { holds } from "../src/conditions.js";
import { checkForWinner, victoryScore } from "../src/scoring.js";
import { seatOf } from "../src/state.js";
import type { GameState } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const context = { controller: "p1" as const, sourceId: "src", targets: [] };

/**
 * R194.3.a — "Some game modes or card effects may alter the Victory Score."
 * The mode sets the number and Aspirant's Climb moves it: "Increase the points
 * needed to win the game by 1."
 */
describe("R194.3.a — a card moves the finish line", () => {
  it("raises the score the game is played to", () => {
    const before = makeState({});
    expect(victoryScore(before)).toBe(8);

    const { state } = execute(before, raiseVictoryScore(1), context);

    expect(victoryScore(state)).toBe(9);
  });

  /** The point of it: a player on 8 has not won a game played to 9. */
  it("moves what it takes to win with it", () => {
    const onEight = makeState({ p1: { points: 8 }, p2: { points: 0 } });
    expect(checkForWinner(onEight).state.winner).toBe("p1");

    const { state } = execute(onEight, raiseVictoryScore(1), context);

    expect(checkForWinner(state).state.winner).toBeNull();
  });
});

/**
 * R194.3 — "within X points of the Victory Score", which five cards read to
 * decide whether the game is nearly over.
 */
describe("R194.3 — how close the game is", () => {
  const at = (mine: number, theirs: number): GameState =>
    makeState({ p1: { points: mine }, p2: { points: theirs } });

  it("reads the controller's own score", () => {
    const near = { kind: "nearVictory", who: "you", within: 3 } as const;

    expect(holds(at(5, 0), near, context)).toBe(true);
    expect(holds(at(4, 0), near, context)).toBe(false);
  });

  it("reads whether any opponent is close", () => {
    const near = { kind: "nearVictory", who: "anyOpponent", within: 3 } as const;

    expect(holds(at(0, 5), near, context)).toBe(true);
    expect(holds(at(7, 4), near, context)).toBe(false);
  });

  /** It is measured against the *current* score, which a card can move. */
  it("follows the Victory Score when a card raises it", () => {
    const near = { kind: "nearVictory", who: "you", within: 3 } as const;
    const close = at(5, 0);
    expect(holds(close, near, context)).toBe(true);

    const { state } = execute(close, raiseVictoryScore(2), context);

    expect(holds(state, near, context)).toBe(false);
  });
});

/**
 * R716 — the inverse of attaching. Angle Shot detaches an Equipment; Strike
 * Down and Veiled Temple detach one they have just used.
 */
describe("R716 — detaching an Equipment", () => {
  const NORTH = { kind: "battlefield" as const, id: "bf-north" };

  function equipped(): GameState {
    return makeState({
      cards: [unit("hero", { might: 2 }), { ...unit("blade"), type: "gear" as const }],
      permanents: [
        { cardId: "hero", controller: "p1", location: NORTH },
        { cardId: "blade", controller: "p1", location: NORTH, attachedTo: "hero" },
      ],
      battlefields: ["bf-north"],
    });
  }

  it("takes the Equipment off its unit", () => {
    const { state, events } = execute(equipped(), detach(0), {
      ...context,
      targets: ["blade"],
    });

    expect(state.permanents["blade"]?.attachedTo).toBeUndefined();
    // R456 — the unit is untouched; only the attachment ended.
    expect(state.permanents["hero"]?.location).toEqual(NORTH);
    expect(events).toContainEqual({
      type: "detached",
      playerId: "p1",
      cardId: "blade",
      fromCardId: "hero",
    });
  });

  it("does nothing to a gear that was not attached", () => {
    const loose = equipped();
    const { attachedTo: _none, ...bare } = loose.permanents["blade"]!;
    const before: GameState = {
      ...loose,
      permanents: { ...loose.permanents, blade: bare },
    };

    const { state, events } = execute(before, detach(0), {
      ...context,
      targets: ["blade"],
    });

    expect(state).toBe(before);
    expect(events).toEqual([]);
  });

  /**
   * R149.3 then takes it home, because an unattached non-Unit gear does not
   * belong at a battlefield — the two rules meet here.
   */
  it("leaves it for the cleanup to recall", () => {
    const { state } = execute(equipped(), detach(0), {
      ...context,
      targets: ["blade"],
    });

    expect(state.permanents["blade"]?.location).toEqual(NORTH);
    expect(seatOf(state, "p1").banished).toEqual([]);
  });
});
