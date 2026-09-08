import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { legalActions } from "../src/legal.js";
import { matchup } from "../src/decks/index.js";
import type { GameState, PlayerId } from "../src/state.js";
import { chooseAction } from "./random-play.js";
import { replay } from "./replay.js";

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

/**
 * The UI's log copies a seed, the deck lists and every action taken. This is
 * the claim that makes that worth having: the engine is deterministic, so
 * replaying the list reproduces the game exactly — the same board, the same
 * events, in the same order.
 *
 * Without it, "I think something went wrong but I couldn't see what happened"
 * has no answer. With it, that sentence comes with the game attached.
 */
describe("a recorded game replays exactly", () => {
  it.each([1, 2, 3])("reproduces every board of seed %i", (seed) => {
    const decks = [0, 1];
    const started = startGame(matchup({ seed, decks }));
    if (!started.ok) throw new Error("setup failed");

    // Record: play a while, keeping the actions the way the UI keeps them.
    const actions: Action[] = [];
    let state = started.state;
    const rand = lcg(seed);
    for (let step = 0; step < 300 && state.winner === null; step += 1) {
      const options = legalActions(state, whoActs(state));
      const action = chooseAction(state, options, rand);
      if (action === undefined) break;
      const result = applyAction(state, action);
      if (!result.ok) break;
      actions.push(action);
      state = result.state;
    }
    expect(actions.length).toBeGreaterThan(20);

    const steps = replay({ seed, decks, actions });

    // Nothing was refused on the way back through — a replay that diverges is
    // itself a finding, and this says there was none.
    expect(steps.filter((step) => step.refused !== undefined)).toEqual([]);
    expect(steps).toHaveLength(actions.length + 1);
    expect(steps[steps.length - 1]!.state).toEqual(state);
  });
});
