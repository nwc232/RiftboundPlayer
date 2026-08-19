import {
  amountFor,
  combatSides,
  dealAssigned,
  nextAssignable,
  resolveCombatAftermath,
} from "./combat.js";
import type { Assignment } from "./combat.js";
import type { PendingDecision } from "./decisions.js";
import type { GameEvent, Progress } from "./events.js";
import { runCleanup } from "./showdown.js";
import type { CardId, GameState, PermanentState, PlayerId } from "./state.js";

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
export type Task =
  | { kind: "cleanup" }
  /**
   * R465 — the Combat Damage Step. Both players assign against the same
   * pre-damage board, attacker first (R465.2.c), and only when both are done is
   * any of it dealt (R465.2.c.1.a).
   */
  | {
      kind: "combatDamage";
      battlefieldId: CardId;
      attacker: PlayerId;
      /** Whose assignment is being worked on. */
      assigning: PlayerId;
      /** How much of `assigning`'s summed Might is still in hand. */
      remaining: number;
      /** Everything assigned so far, by either player. */
      assigned: Assignment[];
    }
  /** R466 — the Resolution Step, once all combat damage has been dealt. */
  | { kind: "combatResolution"; battlefieldId: CardId; attacker: PlayerId };

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

/** How many of `targets` have yet to be assigned anything. */
function unassigned(
  targets: PermanentState[],
  assigned: Assignment[],
): number {
  const done = new Set(assigned.map((entry) => entry.cardId));
  return targets.filter((target) => !done.has(target.cardId)).length;
}

function runTask(state: GameState, task: Task): TaskOutcome {
  switch (task.kind) {
    case "cleanup": {
      const cleaned = runCleanup(state);
      return { state: cleaned.state, events: cleaned.events };
    }

    case "combatDamage": {
      const sides = combatSides(state, task.battlefieldId, task.attacker);
      const defender: PlayerId = task.attacker === "p1" ? "p2" : "p1";
      // Each player assigns among the *other's* units (R465.2.c).
      const targets =
        task.assigning === task.attacker ? sides.defenders : sides.attackers;

      let remaining = task.remaining;
      let assigned = task.assigned;

      while (remaining > 0) {
        const legal = nextAssignable(state, targets, assigned);
        const only = legal[0];
        if (only === undefined) break;

        // R465.2.c.7 — a real choice only exists when more than one unit sits
        // in the same priority band. Asking when the assignment is forced would
        // be noise, so the engine only stops when the answer could differ.
        if (legal.length > 1) {
          return {
            state,
            events: [],
            suspend: {
              task: { ...task, remaining, assigned },
              decision: {
                player: task.assigning,
                prompt: {
                  kind: "assignCombatDamage",
                  battlefieldId: task.battlefieldId,
                  remaining,
                  legal: legal.map((unit) => unit.cardId),
                },
              },
            },
          };
        }

        const amount = amountFor(state, only, remaining, unassigned(targets, assigned) === 1);
        assigned = [...assigned, { cardId: only.cardId, amount }];
        remaining -= amount;
      }

      // R465.2.c — the attacker assigns first; the defender then assigns
      // against the same board, because nothing has been dealt yet.
      if (task.assigning === task.attacker) {
        return {
          state,
          events: [],
          push: [
            {
              ...task,
              assigning: defender,
              remaining: sides.defenderMight,
              assigned,
            },
          ],
        };
      }

      const dealt = dealAssigned(state, assigned);
      return {
        state: dealt.state,
        events: [
          {
            type: "combatDamageDealt",
            battlefieldId: task.battlefieldId,
            attacker: task.attacker,
            attackerMight: sides.attackerMight,
            defenderMight: sides.defenderMight,
          },
          ...dealt.events,
        ],
        push: [
          {
            kind: "combatResolution",
            battlefieldId: task.battlefieldId,
            attacker: task.attacker,
          },
        ],
      };
    }

    case "combatResolution": {
      const resolved = resolveCombatAftermath(
        state,
        task.battlefieldId,
        task.attacker,
      );
      return { state: resolved.state, events: resolved.events };
    }

    default: {
      const unhandled: never = task;
      return { state, events: [] };
    }
  }
}

/**
 * Records the assigning player's choice on the suspended combat task and clears
 * the decision, so the queue can pick up exactly where it stopped. The amount
 * is derived, not chosen — see the prompt's note on R465.2.c.3/c.4.
 */
export function applyCombatAssignment(
  state: GameState,
  cardId: CardId,
): GameState {
  const [head, ...rest] = state.tasks;
  if (head === undefined || head.kind !== "combatDamage") return state;

  const sides = combatSides(state, head.battlefieldId, head.attacker);
  const targets =
    head.assigning === head.attacker ? sides.defenders : sides.attackers;
  const chosen = targets.find((target) => target.cardId === cardId);
  if (chosen === undefined) return state;

  const amount = amountFor(
    state,
    chosen,
    head.remaining,
    unassigned(targets, head.assigned) === 1,
  );

  return {
    ...state,
    pending: null,
    tasks: [
      {
        ...head,
        remaining: head.remaining - amount,
        assigned: [...head.assigned, { cardId, amount }],
      },
      ...rest,
    ],
  };
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
