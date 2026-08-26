import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { renderEvent } from "../src/event-text.js";
import {
  actingPlayer,
  describe as describeAction,
  movesFor,
  newGame,
  promptArity,
  subjectOf,
} from "../src/ui/game.js";
import type { GameState } from "../src/state.js";

/**
 * The UI's own logic, tested without a DOM. Everything the browser does that
 * could be wrong lives in these few functions; the components are a projection
 * of them.
 */

const ANSI = new RegExp("\\u001b");

function opened(seed = 7): GameState {
  return newGame(seed);
}

/** Answers whatever decision is outstanding, taking the first legal option. */
function settle(state: GameState, limit = 40): GameState {
  let current = state;
  for (let i = 0; i < limit && current.pending !== null; i += 1) {
    const move = movesFor(current, current.pending.player)[0];
    if (move === undefined) break;
    const result = applyAction(current, move.action);
    if (!result.ok) break;
    current = result.state;
  }
  return current;
}

describe("who the UI acts as", () => {
  it("follows the pending decision before anything else (R320.1)", () => {
    const state = opened();

    expect(state.pending?.player).toBe("p1");
    expect(actingPlayer(state)).toBe("p1");
  });

  it("hands over to the other player when the decision does", () => {
    const answered = applyAction(opened(), {
      type: "decide",
      playerId: "p1",
      targets: [],
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;

    // R117 — the second player's mulligan is the next thing owed.
    expect(actingPlayer(answered.state)).toBe("p2");
  });
});

/** R117.1's "up to two" is why a click cannot always answer on its own. */
describe("how many cards a prompt wants", () => {
  it("lets the mulligan take none, one, or two", () => {
    expect(promptArity(opened())).toEqual({ min: 0, max: 2 });
  });

  it("wants nothing when no decision is outstanding", () => {
    expect(promptArity(settle(opened()))).toEqual({ min: 0, max: 0 });
  });
});

describe("labelling moves", () => {
  it("names the card an action is about, so moves can be grouped by it", () => {
    const state = settle(opened());

    for (const move of movesFor(state, actingPlayer(state))) {
      expect(move.label.length).toBeGreaterThan(0);
      const subject = subjectOf(move.action);
      if (subject !== undefined) expect(state.cards[subject]).toBeDefined();
    }
  });

  /**
   * Read off the ability's own data rather than hardcoded, so a rune reads
   * "exhaust for 1 energy" instead of "ability 1".
   */
  it("words a rune's abilities from what they cost and give", () => {
    const state = settle(opened());
    const runeId = state.players[state.turn.player].runes[0];
    expect(runeId).toBeDefined();

    const labels = [0, 1].map((abilityIndex) =>
      describeAction(state, {
        type: "activateAbility",
        playerId: state.turn.player,
        sourceId: runeId!,
        abilityIndex,
      }),
    );

    expect(labels[0]).toBe("exhaust for 1 energy");
    expect(labels[1]).toMatch(/^recycle for 1 \w+ power$/);
  });

  it("says where a unit is being played to", () => {
    const state = settle(opened());

    expect(
      describeAction(state, {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "tideturner-1",
        destination: { kind: "base", player: "p1" },
      }),
    ).toBe("play to base");
  });
});

/** The browser shows the same sentences the CLI does, without the colour. */
describe("event wording is shared", () => {
  it("carries no terminal escape codes", () => {
    const line = renderEvent({ type: "turnBegan", playerId: "p1", turn: 1 });

    expect(line).toBe("— turn 1: p1 —");
    expect(ANSI.test(line)).toBe(false);
  });
});
