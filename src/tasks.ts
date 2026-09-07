import {
  amountFor,
  ambiguousCombatDamage,
  ambiguousDeath,
  combatSides,
  dealAssigned,
  defenderAt,
  nextAssignable,
  resolveCombatAftermath,
} from "./combat.js";
import type { Assignment } from "./combat.js";
import type { PendingDecision } from "./decisions.js";
import type { GameEvent, Progress } from "./events.js";
import { drawCards } from "./draw.js";
import { execute } from "./abilities.js";
import type { Effect, EffectContext, EffectOutcome } from "./abilities.js";
import { controllerOf } from "./layers.js";
import { openShowdown, runCleanup, stagedBattlefields } from "./showdown.js";
import { harvestTriggers } from "./triggers.js";
import { chainItemCardId } from "./chain.js";
import { runTurnStep, openTurn } from "./turn.js";
import type { TurnStep } from "./turn.js";
import type { CardId, GameState, PermanentState, PlayerId } from "./state.js";
import { seatOf } from "./state.js";

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
/** R117.1 — a player may set aside up to two cards. */
export const MULLIGAN_MAX = 2;

export type Task =
  /**
   * `chosen` is R372's answer: which replacement to apply to a given death,
   * once the controller has been asked. Carried on the task because the
   * cleanup has to stop half-way to ask, then pick up where it left off.
   */
  | { kind: "cleanup"; chosen?: Record<CardId, CardId> }
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
      /** R372's answer per damaged unit, once its controller has ordered. */
      damageOrder?: Record<CardId, CardId[]>;
    }
  /** R466 — the Resolution Step, once all combat damage has been dealt. */
  | {
      kind: "combatResolution";
      battlefieldId: CardId;
      attacker: PlayerId;
      chosen?: Record<CardId, CardId>;
    }
  /** R314–317 — one step of the turn. See `TurnStep`. */
  | { kind: "turnStep"; player: PlayerId; step: TurnStep; number: number }
  /** R323.12 — open a showdown at one of the staged battlefields. */
  | { kind: "openStagedShowdown" }
  /** R117 — one player's setup Mulligan, taken in turn order. */
  | { kind: "mulligan"; player: PlayerId }
  /**
   * A choice made *during* an effect's resolution rather than at finalization:
   * Stacked Deck's "put 1 into your hand and recycle the rest", Sabotage's
   * "choose a non-unit card from it". `execute` cannot suspend, so it leaves
   * one of these behind and the queue asks.
   */
  /**
   * What is left of an effect that stopped to ask something. R334.1 lets it
   * sit here: work outstanding when a chain item finishes resolving is
   * completed before anything else happens.
   */
  | {
      kind: "resumeEffect";
      effect: Effect;
      context: EffectContext;
      decision: PendingDecision;
      /** Set once the player has answered; absent means still asking. */
      answer?: CardId[];
    };

/**
 * R372's ordering question, if this task's kills raise one. Returns a suspend
 * for the task to hand straight back, or undefined when there is nothing to
 * ask — the usual case, since one replacement needs no ordering.
 */
function askAboutReplacement(
  state: GameState,
  chosen: Record<CardId, CardId>,
  task: Extract<Task, { kind: "cleanup" | "combatResolution" }>,
): TaskOutcome | undefined {
  const choice = ambiguousDeath(state, chosen);
  if (choice === undefined) return undefined;

  return {
    state,
    events: [],
    suspend: {
      task,
      decision: {
        // R372 — the controller of the object being *acted on*, not of the
        // replacements.
        player: controllerOf(state, choice.cardId),
        prompt: {
          kind: "orderReplacements",
          subject: choice.cardId,
          legal: choice.options.map((option) => option.sourceId),
        },
      },
    },
  };
}

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
      const chosen = task.chosen ?? {};
      // R372 — "the controller of the object being acted on determines the
      // order the Replacement Effects will apply." Asked before anything dies,
      // because R370.1.c applies replacements before the event occurs.
      const asking = askAboutReplacement(state, chosen, task);
      if (asking !== undefined) return asking;

      const cleaned = runCleanup(state, chosen);
      // R323.8 stages a showdown at each contested battlefield; R323.12 opens
      // one of them, and that is a separate step because it may need an answer.
      const push =
        stagedBattlefields(cleaned.state).length > 0
          ? [{ kind: "openStagedShowdown" as const }]
          : [];
      return { state: cleaned.state, events: cleaned.events, push };
    }

    case "mulligan": {
      const hand = seatOf(state, task.player).hand;
      // R117.1 — "up to two", so a player with fewer cards is capped by them.
      const max = Math.min(MULLIGAN_MAX, hand.length);
      if (max === 0) return { state, events: [] };

      return {
        state,
        events: [],
        suspend: {
          task: { kind: "mulligan", player: task.player },
          decision: {
            player: task.player,
            prompt: { kind: "mulligan", max, legal: [...hand] },
          },
        },
      };
    }

    case "resumeEffect": {
      if (task.answer === undefined) {
        return { state, events: [], suspend: { task, decision: task.decision } };
      }
      const outcome = execute(state, task.effect, {
        ...task.context,
        answer: task.answer,
      });
      // The resumed effect may itself stop to ask again.
      return park(outcome);
    }

    case "openStagedShowdown": {
      // R344 — a Showdown begins only when "the turn is in a Neutral Open
      // State", and R460 wants "no items on the Chain". With something pending
      // this cannot happen yet; `contestedBy` stays on the battlefield and the
      // next cleanup raises this again once the chain is clear.
      if (state.chain.length > 0) return { state, events: [] };

      const staged = stagedBattlefields(state);
      const only = staged[0];
      if (only === undefined) return { state, events: [] };

      // Asking with one option would be noise; R323.12's choice only exists
      // when more than one battlefield is staged.
      if (staged.length === 1) return openShowdown(state, only);

      return {
        state,
        events: [],
        suspend: {
          task: { kind: "openStagedShowdown" },
          decision: {
            // R323.12 — "the Turn Player chooses one of those Battlefields".
            player: state.turn.player,
            prompt: { kind: "chooseStagedBattlefield", legal: staged },
          },
        },
      };
    }

    case "combatDamage": {
      const sides = combatSides(state, task.battlefieldId, task.attacker);
      // Each player assigns among the *other's* units (R465.2.c). R462 keeps a
      // combat to two players, so "not the attacker" is the defending side
      // whatever the mode seats.
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
        const defender = defenderAt(state, task.battlefieldId, task.attacker);
        // No defender left to assign means no damage to assign back, so the
        // step is finished rather than handed over.
        if (defender !== null) {
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
      }

      // R372 — asked before any of it lands, because R370.1.c applies
      // replacements before the event occurs.
      const ordered = task.damageOrder ?? {};
      const asking = ambiguousCombatDamage(state, assigned, ordered);
      if (asking !== undefined) {
        return {
          state,
          events: [],
          suspend: {
            task: { ...task, assigned, remaining },
            decision: {
              player: controllerOf(state, asking.cardId),
              prompt: {
                kind: "orderDamage",
                subject: asking.cardId,
                amount: asking.amount,
                legal: asking.legal,
              },
            },
          },
        };
      }

      const dealt = dealAssigned(state, assigned, ordered);
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

    case "turnStep": {
      const outcome = runTurnStep(state, task.player, task.step, task.number);
      return {
        state: outcome.state,
        events: outcome.events,
        ...(outcome.next !== null
          ? { push: [{ kind: "turnStep" as const, ...outcome.next }] }
          : {}),
      };
    }

    case "combatResolution": {
      const chosen = task.chosen ?? {};
      const asking = askAboutReplacement(state, chosen, task);
      if (asking !== undefined) return asking;

      const resolved = resolveCombatAftermath(
        state,
        task.battlefieldId,
        task.attacker,
        chosen,
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

/**
 * R117 — set the chosen cards aside, draw that many, *then* recycle the ones
 * set aside (R416.1: to the bottom of the Main Deck). The order matters: the
 * replacements are drawn before the set-aside cards go back, so a player can
 * never redraw the card they just threw away.
 */
export function applyMulligan(
  state: GameState,
  playerId: PlayerId,
  setAside: CardId[],
): Progress {
  const [head, ...rest] = state.tasks;
  if (head === undefined || head.kind !== "mulligan") {
    return { state, events: [] };
  }

  const player = seatOf(state, playerId);
  const withoutSetAside: GameState = {
    ...state,
    pending: null,
    tasks: rest,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        hand: player.hand.filter((id) => !setAside.includes(id)),
      },
    },
  };

  const drawn = drawCards(withoutSetAside, playerId, setAside.length);
  const after = drawn.state;

  return {
    state: {
      ...after,
      players: {
        ...after.players,
        [playerId]: {
          ...seatOf(after, playerId),
          mainDeck: [...seatOf(after, playerId).mainDeck, ...setAside],
        },
      },
    },
    events: [
      { type: "mulliganed", playerId, count: setAside.length },
      ...drawn.events,
    ],
  };
}

/** Answers R323.12's choice and drops the task that was waiting on it. */
export function applyStagedShowdown(
  state: GameState,
  battlefieldId: CardId,
): Progress {
  const [head, ...rest] = state.tasks;
  if (head === undefined || head.kind !== "openStagedShowdown") {
    return { state, events: [] };
  }
  const opened = openShowdown(
    { ...state, pending: null, tasks: rest },
    battlefieldId,
  );
  return opened;
}

/**
 * Records R372's answer on the suspended task and clears the decision, so the
 * cleanup or combat resolution picks up with the ordering settled.
 */
/** Records R372's damage ordering on the suspended combat task. */
export function applyDamageOrder(
  state: GameState,
  subject: CardId,
  order: CardId[],
): GameState {
  const [head, ...rest] = state.tasks;
  if (head === undefined || head.kind !== "combatDamage") return state;
  return {
    ...state,
    pending: null,
    tasks: [
      {
        ...head,
        damageOrder: { ...(head.damageOrder ?? {}), [subject]: order },
      },
      ...rest,
    ],
  };
}

export function applyReplacementOrder(
  state: GameState,
  subject: CardId,
  sourceId: CardId,
): GameState {
  const [head, ...rest] = state.tasks;
  if (
    head === undefined ||
    (head.kind !== "cleanup" && head.kind !== "combatResolution")
  ) {
    return state;
  }

  return {
    ...state,
    pending: null,
    tasks: [
      { ...head, chosen: { ...(head.chosen ?? {}), [subject]: sourceId } },
      ...rest,
    ],
  };
}

/**
 * Parks whatever is left of a paused effect on the queue, so it is asked and
 * finished before anything else proceeds. Every caller of `execute` funnels
 * through here, which is what keeps the pause from being dropped silently.
 */
export function park(outcome: EffectOutcome): Progress {
  if (outcome.pause === undefined) {
    return { state: outcome.state, events: outcome.events };
  }
  return {
    state: enqueueNext(outcome.state, {
      kind: "resumeEffect",
      effect: outcome.pause.resume,
      context: outcome.pause.context,
      decision: outcome.pause.decision,
    }),
    events: outcome.events,
  };
}

/**
 * Records the answer the queue was waiting on, so the effect can finish.
 *
 * The answer goes to the first `resumeEffect` still *asking* — the one
 * `runTasks` would suspend on next, walking from the head — rather than to
 * whatever happens to be at position zero. `park` puts a paused effect at the
 * front without setting `pending`, so between parking and being asked, other
 * outstanding work can legitimately be queued in front of it (R319.6: a
 * cleanup incited by something more recent is handled first). When that
 * happened, the answer landed on the cleanup, which ignored it, and the same
 * prompt came back unchanged forever: one soak game spent 59,808 `decide`
 * actions on turn 13 answering the same Predict, and the engine accepted every
 * one of them.
 *
 * Returns `undefined` when there is nothing to answer, so the caller can
 * refuse rather than accept a move that changes nothing. A refusal is a
 * failure anyone will notice; silently accepting one is a game that never
 * ends.
 */
export function applyResumeAnswer(
  state: GameState,
  answer: CardId[],
): GameState | undefined {
  const at = state.tasks.findIndex(
    (task) => task.kind === "resumeEffect" && task.answer === undefined,
  );
  if (at === -1) return undefined;
  return {
    ...state,
    pending: null,
    tasks: state.tasks.map((task, index) =>
      index === at ? { ...task, answer } : task,
    ),
  };
}

export function enqueue(state: GameState, ...tasks: Task[]): GameState {
  return { ...state, tasks: [...state.tasks, ...tasks] };
}

/**
 * R319.6/R334 — work incited by something that just happened is outstanding
 * *now*, and completes before any continuation already sitting in the queue.
 * A cleanup queued behind a pending turn step would let, say, the Scoring Step
 * run before a dead unit's controller had lost the battlefield it vacated.
 */
export function enqueueNext(state: GameState, ...tasks: Task[]): GameState {
  return { ...state, tasks: [...tasks, ...state.tasks] };
}

/**
 * Works the queue until it drains or a task needs an answer. R320.1 — while
 * tasks remain, no priority is awarded and nothing on the chain resolves.
 */
export function runTasks(
  state: GameState,
  seedEvents: GameEvent[] = [],
): Progress {
  let current = state;
  const events: GameEvent[] = [];
  // Events not yet checked for triggers. R383.2.c evaluates a condition once
  // its inciting event has been processed, so each event is scanned once.
  let unscanned: GameEvent[] = [...seedEvents];

  while (current.pending === null) {
    // R194.2 / R323.1 — the game is over. Nothing further happens, which
    // includes the triggers the winning score itself raised: a conquer that
    // wins the game does not then go on to ask its controller about an
    // optional trigger nobody will ever answer.
    if (current.winner !== null) break;

    const [head, ...rest] = current.tasks;
    if (head === undefined) break;

    if (current.chain.length > 0) {
      // R344 opens a Showdown only when "the turn is in a Neutral Open State"
      // and R460 wants "no items on the Chain", so this one *cannot* run yet.
      // Dropping it rather than waiting is what keeps the queue moving:
      // `contestedBy` stays on the battlefield and the next cleanup raises it
      // again once the chain is clear.
      if (head.kind === "openStagedShowdown") {
        current = { ...current, tasks: rest };
        continue;
      }
      // R319.3 and R319.4 make a Cleanup outstanding precisely *because*
      // something was added to or finalized on the Chain. One that could not
      // run while the chain had items could never run at all — and R320 has
      // the chain wait for the cleanup, so the two of them simply stopped.
      // That is why Pridestalker, triggered by a unit played as a reaction
      // onto an existing chain, was never asked for a target: its own cleanup
      // sat in front of it and could not move.
      //
      // R335 holds for everything else — the turn, and the steps of combat,
      // proceed only once there are no pending chain items.
      if (head.kind !== "cleanup") break;
    }


    // The head comes off *before* it runs, so a handler that enqueues work —
    // `park` does, when a resumed effect stops to ask a second time — is
    // enqueueing ahead of the rest of the queue rather than ahead of itself.
    // Reading the remainder back off the outcome is what keeps that work: a
    // queue rebuilt from `rest` alone silently dropped it, which stranded the
    // tail of any effect that had to ask twice.
    const outcome = runTask({ ...current, tasks: rest }, head);
    events.push(...outcome.events);
    unscanned.push(...outcome.events);

    if (outcome.suspend !== undefined) {
      current = {
        ...outcome.state,
        tasks: [outcome.suspend.task, ...outcome.state.tasks],
        pending: outcome.suspend.decision,
      };
      break;
    }

    current = {
      ...outcome.state,
      tasks: [...(outcome.push ?? []), ...outcome.state.tasks],
    };

    const harvest = harvestTriggers(current, unscanned);
    const triggered = harvest.items;
    unscanned = [];
    // R383.3.e.1's counts advance whether or not anything fired, so they are
    // carried back even when the harvest is empty.
    current = { ...current, triggeredThisTurn: harvest.triggeredThisTurn };
    if (triggered.length === 0) continue;

    current = {
      ...current,
      chain: [...current.chain, ...triggered],
      // R383.3.c — the controller of the newest item receives priority.
      priority: triggered[triggered.length - 1]?.controller ?? current.priority,
      priorityPasses: 0,
    };
    events.push(
      ...triggered.map((item) => ({
        type: "abilityTriggered" as const,
        playerId: item.controller,
        cardId: chainItemCardId(item),
      })),
    );
  }

  // Anything still unscanned had no task after it to trigger against. This runs
  // even with items already on the chain: R335 stops the *next step*, it does
  // not stop a trigger becoming pending, and a spell sitting on the chain is
  // exactly what "when a player plays a spell" is waiting for.
  if (unscanned.length > 0) {
    const harvest = harvestTriggers(current, unscanned);
    const triggered = harvest.items;
    current = { ...current, triggeredThisTurn: harvest.triggeredThisTurn };
    if (triggered.length > 0) {
      current = {
        ...current,
        chain: [...current.chain, ...triggered],
        priority:
          triggered[triggered.length - 1]?.controller ?? current.priority,
        priorityPasses: 0,
      };
      events.push(
        ...triggered.map((item) => ({
          type: "abilityTriggered" as const,
          playerId: item.controller,
          cardId: chainItemCardId(item),
        })),
      );
    }
  }

  return { state: current, events };
}

/**
 * Run the Ending Phase through to the next player's Main Phase. Stops early at
 * any step that raises a trigger (R335) or needs a decision.
 */
export function endTurn(state: GameState): Progress {
  return runTasks(
    enqueue(state, {
      kind: "turnStep",
      player: state.turn.player,
      step: "ending",
      number: state.turn.number,
    }),
  );
}

/**
 * Start a turn and run it up to the Main Phase, where the player takes over.
 * Stops early if a step raises a trigger (R335) or needs a decision.
 */
export function beginTurn(
  state: GameState,
  player: PlayerId,
  number: number,
): Progress {
  const opened = openTurn(state, player, number);
  const worked = runTasks(
    enqueue(opened.state, { kind: "turnStep", player, step: "awaken", number }),
    opened.events,
  );
  return { state: worked.state, events: [...opened.events, ...worked.events] };
}
