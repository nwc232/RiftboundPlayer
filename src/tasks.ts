import type { PendingDecision } from "./decisions.js";
import type { GameEvent, Progress } from "./events.js";
import { runCleanup } from "./showdown.js";
import type { GameState } from "./state.js";

/**
 * R319/R334 — the rules do not track work as a call stack, they track it as a
 * queue of Outstanding Tasks that is worked through before anything else may
 * happen. R334.1 is the load-bearing part: chain items added while tasks are
 * being handled "remain there until the Tasks are complete", and R334.2
 * processes them all afterward through FEPR.
 *
 * Modelling it as a queue rather than nested function calls is what lets a task
 * stop half-way and ask a player something — R465.2.c's damage assignment is
 * the first such case, and R323.12/13's "the Turn Player chooses" is the next.
 * A synchronous function cannot suspend; a queue entry can.
 */
export type Task = { kind: "cleanup" };

interface TaskOutcome {
  state: GameState;
  events: GameEvent[];
  /**
   * The task is not finished. It stays at the head of the queue in this form,
   * and nothing else proceeds until the decision is answered.
   */
  suspend?: { task: Task; decision: PendingDecision };
  /** Work that must happen before the rest of the queue. */
  push?: Task[];
}

function runTask(state: GameState, task: Task): TaskOutcome {
  switch (task.kind) {
    case "cleanup": {
      const cleaned = runCleanup(state);
      return { state: cleaned.state, events: cleaned.events };
    }

    default: {
      const unhandled: never = task.kind;
      return { state, events: [] };
    }
  }
}

export function enqueue(state: GameState, ...tasks: Task[]): GameState {
  return { ...state, tasks: [...state.tasks, ...tasks] };
}

/**
 * Works the queue until it drains or a task needs an answer. R320.1 — while
 * tasks remain, no priority is awarded and nothing on the chain resolves.
 */
export function runTasks(state: GameState): Progress {
  let current = state;
  const events: GameEvent[] = [];

  while (current.pending === null) {
    const [head, ...rest] = current.tasks;
    if (head === undefined) break;

    const outcome = runTask(current, head);
    events.push(...outcome.events);

    if (outcome.suspend !== undefined) {
      current = {
        ...outcome.state,
        tasks: [outcome.suspend.task, ...rest],
        pending: outcome.suspend.decision,
      };
      break;
    }

    current = { ...outcome.state, tasks: [...(outcome.push ?? []), ...rest] };
  }

  return { state: current, events };
}
