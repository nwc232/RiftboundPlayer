import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { matchup } from "../src/decks/index.js";
import type { GameEvent } from "../src/events.js";
import type { GameState } from "../src/state.js";
import { checkInvariants } from "./invariants.js";

/**
 * Replaying a game somebody actually played.
 *
 * The UI's log has a copy button that puts the seed, the deck lists and every
 * action taken on the clipboard. The engine is deterministic, so that blob
 * *is* the game: this runs it back and hands over every board it passed
 * through, which turns "I think something went wrong but I couldn't see what
 * happened" into a case that can be stepped through and asserted about.
 *
 * Every invariant is checked as it goes, so a replay of a game that felt wrong
 * often says where before anyone reads it.
 */
export interface Replay {
  seed: number;
  decks: number[];
  actions: Action[];
}

export interface Step {
  /** The action taken, absent for the deal. */
  action?: Action;
  state: GameState;
  events: GameEvent[];
  /** Why the engine refused, when it did. A replay should never see one. */
  refused?: string;
}

export function replay(recorded: Replay): Step[] {
  const started = startGame(
    matchup({ seed: recorded.seed, decks: recorded.decks }),
  );
  if (!started.ok) {
    throw new Error(`setup failed: ${JSON.stringify(started.errors)}`);
  }

  const steps: Step[] = [{ state: started.state, events: [] }];
  let state = started.state;

  for (const action of recorded.actions) {
    const before = state;
    const result = applyAction(state, action);
    if (!result.ok) {
      // Kept rather than thrown: a replay that diverges is itself the finding,
      // and where it diverged is the useful half.
      steps.push({ action, state, events: [], refused: result.reason });
      break;
    }
    state = result.state;
    steps.push({ action, state, events: result.events });
    checkInvariants(state, action, before);
  }

  return steps;
}

/** Every event of a replay, in order — the log the player was reading. */
export function eventsOf(steps: Step[]): GameEvent[] {
  return steps.flatMap((step) => step.events);
}
