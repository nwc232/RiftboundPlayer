import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { legalActions } from "../src/legal.js";
import { evelynn } from "../src/decks/vex.js";
import { pyke } from "../src/decks/rengar.js";
import type { GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const RICH = pool({
  energy: 20,
  power: { fury: 9, calm: 9, mind: 9, body: 9, chaos: 9, order: 9 },
  universalPower: 9,
});

/**
 * R811.1.b — "Beginning on the next turn, this gains [Reaction] and you may
 * play this, ignoring its base cost."
 *
 * Reported from a real game: Evelynn hidden at a battlefield, an opponent's
 * Pyke moved in and opened a showdown over it, and the player could not find
 * any way to reveal her. The engine was offering the play the whole time —
 * these are the assertions that say so — and the UI was the thing at fault:
 * the facedown zone was a line of text rather than a card, and the whole
 * interaction model is "click the card to see what it can do".
 */
function board(): GameState {
  const base = makeState({
    p1: { runePool: RICH, mainDeck: ["d1", "d2"] },
    p2: { runePool: RICH, mainDeck: ["d3"] },
    cards: [
      { ...evelynn, id: "eve" },
      { ...pyke, id: "pyke" },
      unit("guard", { might: 3 }),
      unit("d1"),
      unit("d2"),
      unit("d3"),
    ],
    permanents: [
      { cardId: "guard", controller: "p1", location: NORTH },
      { cardId: "pyke", controller: "p2" },
    ],
    battlefields: [["bf-north", "p1"], "bf-south"],
  });

  return {
    ...base,
    turn: { player: "p2", phase: "main", number: 2 },
    // Hidden on turn 1, so R811.1.b's "beginning on the next turn" has passed.
    facedown: {
      "bf-north": { cardId: "eve", controller: "p1", hiddenOnTurn: 1 },
    },
  };
}

const plays = (state: GameState, playerId: "p1" | "p2") =>
  legalActions(state, playerId)
    .filter((action) => action.type === "playUnitFromHand")
    .map((action) => (action as { cardId: string }).cardId);

describe("a hidden card under a showdown", () => {
  it("is not playable before anything happens — it is not p1's turn", () => {
    // R811.1.b grants [Reaction], and R813 reaction timing needs a chain or a
    // showdown; with neither, and on somebody else's turn, there is no window.
    expect(plays(board(), "p1")).toEqual([]);
  });

  it("becomes playable the moment the showdown opens over it", () => {
    const moved = applyAction(board(), {
      type: "standardMove",
      playerId: "p2",
      cardId: "pyke",
      destination: NORTH,
    });
    if (!moved.ok) throw new Error(moved.reason);

    expect(moved.state.showdown?.battlefieldId).toBe("bf-north");
    expect(plays(moved.state, "p1")).toContain("eve");
  });

  it("is still playable after focus passes to them", () => {
    const moved = applyAction(board(), {
      type: "standardMove",
      playerId: "p2",
      cardId: "pyke",
      destination: NORTH,
    });
    if (!moved.ok) throw new Error(moved.reason);
    const passed = applyAction(moved.state, {
      type: "passFocus",
      playerId: moved.state.showdown!.focus,
    });
    if (!passed.ok) throw new Error(passed.reason);

    expect(passed.state.showdown?.focus).toBe("p1");
    expect(plays(passed.state, "p1")).toContain("eve");
  });

  it("puts her on the battlefield she was hidden at (R811.1.d.1)", () => {
    const moved = applyAction(board(), {
      type: "standardMove",
      playerId: "p2",
      cardId: "pyke",
      destination: NORTH,
    });
    if (!moved.ok) throw new Error(moved.reason);

    const offered = legalActions(moved.state, "p1").find(
      (action) =>
        action.type === "playUnitFromHand" && action.cardId === "eve",
    );
    expect(offered).toBeDefined();

    const played = applyAction(moved.state, offered!);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    expect(played.state.permanents.eve?.location).toEqual(NORTH);
    // R421.4 — playing it from there is the reveal, so the zone empties.
    expect(played.state.facedown["bf-north"]).toBeUndefined();
  });
});
