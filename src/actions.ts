import { execute, modeOf, shiftTargets } from "./abilities.js";
import type { AbilityCost, Effect, EffectContext } from "./abilities.js";
import { FREE, spend } from "./cost.js";
import {
  additionalCostsOf,
  repeatCostsOf,
  consumeDiscount,
  totalCostOf,
} from "./costing.js";
import type { GameEvent } from "./events.js";
import { permanentsAt, sameLocation } from "./state.js";
import type {
  BattlefieldState,
  CardId,
  GameState,
  Location,
  PlayerId,
  PlayerState,
  PlaySource,
} from "./state.js";
import {
  chainExists,
  chainItemCardId,
  newestItem,
  leaveChain,
  sourceLocationOf,
} from "./chain.js";
import {
  abilitiesOf,
  characteristicsOf,
  controllerOf,
  keywordsOf,
  movementRestricted,
} from "./layers.js";
import { holds as conditionHolds } from "./conditions.js";
import { leaveZone, playZonesFor } from "./zones.js";
import { entersReady } from "./replacements.js";
import { legalTargets } from "./decisions.js";
import type { PendingDecision, TargetFilter } from "./decisions.js";
import {
  applyCombatAssignment,
  applyDamageOrder,
  applyMulligan,
  applyReplacementOrder,
  applyResumeAnswer,
  applyStagedShowdown,
  park,
  beginTurn,
  enqueue,
  enqueueNext,
  runTasks,
} from "./tasks.js";
import { passFocus as runPassFocus } from "./showdown.js";
import { isValidPlayLocation, playedWithReactionTiming } from "./play.js";
import {
  hide as runHide,
} from "./hidden.js";


export type Action =
  | { type: "drawCard"; playerId: PlayerId }
  | {
      type: "playUnitFromHand";
      playerId: PlayerId;
      cardId: CardId;
      destination?: Location;
      /** R355.1.a — the choice of whether to pay an optional additional cost. */
      payOptional?: boolean;
    }
  | {
      type: "standardMove";
      playerId: PlayerId;
      cardId: CardId;
      destination: Location;
    }
  | { type: "endTurn"; playerId: PlayerId }
  | { type: "passFocus"; playerId: PlayerId }
  | { type: "passPriority"; playerId: PlayerId }
  | {
      type: "decide";
      playerId: PlayerId;
      /** For chooseTargets. */
      targets?: CardId[];
      /** For confirmOptional — whether to perform the ability at all. */
      perform?: boolean;
    }
  | {
      type: "playSpell";
      playerId: PlayerId;
      cardId: CardId;
      /**
       * R355.5 — one per filter the card names. With [Repeat] paid, one set
       * per execution, laid end to end: R820.2 has every choice made at the
       * usual time, so the second execution's targets are chosen here too.
       */
      targets?: CardId[];
      /** R355.1.a — the choice of whether to pay an optional additional cost. */
      payOptional?: boolean;
      /** R820.1.c.2 — which of the card's [Repeat] costs to pay, by index. */
      payRepeats?: number[];
      /**
       * "Choose one —": which arm each execution takes. One entry per
       * execution (R820.2.a), so a repeated modal spell carries two.
       */
      modes?: number[];
      /**
       * Which of `playZonesFor`'s ways of playing this card is being used.
       * Only [Flow] (R829.1.c.3) ever offers more than one.
       */
      playFrom?: number;
    }
  /** R421 — the Hide discretionary action, granted by [Hidden] (R811.1.c). */
  | {
      type: "hide";
      playerId: PlayerId;
      cardId: CardId;
      battlefieldId: CardId;
    }
  | {
      type: "activateAbility";
      targets?: CardId[];
      /** "Choose one —": which arm this activation takes. */
      mode?: number;
      playerId: PlayerId;
      sourceId: CardId;
      abilityIndex: number;
    };

export type RejectionReason =
  | "cardNotFound"
  | "notHidden"
  | "noAdditionalCost"
  | "cannotMove"
  | "notOpenState"
  | "battlefieldNotControlled"
  | "facedownZoneOccupied"
  | "wrongCardType"
  | "notInHand"
  | "deckEmpty"
  | "runeDeckEmpty"
  | "runeNotFound"
  | "runeNotControlled"
  | "runeAlreadyExhausted"
  | "cannotAffordCost"
  | "notYourTurn"
  | "wrongPhase"
  | "abilityNotFound"
  | "sourceNotControlled"
  | "cannotPayAbilityCost"
  | "wrongModeCount"
  | "invalidMode"
  | "notAPermanent"
  | "notOnBoard"
  | "alreadyExhausted"
  | "invalidDestination"
  | "alreadyThere"
  | "noShowdown"
  | "notYourFocus"
  | "showdownInProgress"
  | "gameOver"
  | "notYourPriority"
  | "wrongTiming"
  | "invalidTarget"
  | "decisionPending"
  | "noDecision"
  | "notYourDecision"
  | "wrongTargetCount";

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectionReason };

function rejected(reason: RejectionReason): ActionResult {
  return { ok: false, reason };
}

/** R812.1.c — note a card as Finalized by this player on this turn. */
function recordFinalized(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): GameState["playedThisTurn"] {
  return {
    ...state.playedThisTurn,
    [playerId]: [...state.playedThisTurn[playerId], cardId],
  };
}

/**
 * R453 — a cleanup runs when a move (or any board change) completes. Triggered
 * abilities are then evaluated against everything that just happened, because
 * R383.2.c checks a trigger's condition after the inciting event is processed.
 */
/**
 * Triggers are collected inside the task driver now, between steps, because
 * R335 makes a pending chain item block the next step. All that is left here is
 * to surface any choice the newest chain item still owes.
 */
function afterTasks(current: GameState, events: GameEvent[]): ActionResult {
  return awaitDecisions({ ok: true, state: current, events });
}

/**
 * Runs the cleanup R319 makes outstanding after an action, then lets the queue
 * carry on.
 *
 * `scanned` says the events have already been through `collectTriggers` — true
 * for an action that drove the queue itself. Re-seeding those would collect the
 * same triggers a second time and put two copies on the chain.
 */
function thenCleanup(
  result: ActionResult,
  { scanned = false }: { scanned?: boolean } = {},
): ActionResult {
  if (!result.ok) return result;

  const worked = runTasks(
    enqueueNext(result.state, { kind: "cleanup" }),
    scanned ? [] : result.events,
  );
  return afterTasks(worked.state, [...result.events, ...worked.events]);
}

/** Records an answer a task was waiting on, then lets the queue carry on. */
function resumeTasks(
  state: GameState,
  cardId: CardId,
  playerId: PlayerId,
): ActionResult {
  const worked = runTasks(applyCombatAssignment(state, cardId), [
    { type: "targetsChosen", playerId, targets: [cardId] },
  ]);
  return afterTasks(worked.state, [
    { type: "targetsChosen", playerId, targets: [cardId] },
    ...worked.events,
  ]);
}

/**
 * R329.2 — a chain item stays Pending until its choices are made. Returns the
 * decision its controller still owes, if any, for the newest item on the chain.
 */
function nextDecision(state: GameState): PendingDecision | null {
  const chainIndex = state.chain.length - 1;
  const item = state.chain[chainIndex];
  if (item === undefined || item.kind !== "trigger") return null;

  const { ability } = item;

  // R383.3.a is decided before targets are chosen — declining removes the
  // item, so there is no point choosing targets for it first.
  if (ability.optional === true && !item.optionalResolved) {
    return {
      player: item.controller,
      prompt: { kind: "confirmOptional", chainIndex },
    };
  }

  // "Choose one —" comes before the targets, because which targets the ability
  // even wants depends on which arm was taken.
  if (ability.modes !== undefined && item.mode === undefined) {
    return {
      player: item.controller,
      prompt: {
        kind: "chooseMode",
        chainIndex,
        legal: ability.modes.map((_, index) => index),
      },
    };
  }

  // R355.5 — one target at a time, in the order the card names them. Each has
  // its own filter, so "a friendly unit and an enemy unit" cannot be answered
  // by two friendly ones.
  const filters = modeOf(ability, item.mode ?? 0).targeting?.filters ?? [];
  const index = item.targets.length;
  const filter = filters[index];
  if (filter !== undefined) {
    return {
      player: item.controller,
      prompt: {
        kind: "chooseTargets",
        chainIndex,
        index,
        remaining: filters.length - index,
        legal: legalTargets(
          state,
          item.controller,
          filter,
          chainItemCardId(item),
        ),
      },
    };
  }

  return null;
}

/**
 * R809.1.c — the Power an ability owes for choosing Deflecting objects an
 * opponent controls, "for each time they choose [me]". R809.1.c.1 makes it any
 * Domain, so it is always `[A]`.
 */
function deflectTax(
  state: GameState,
  playerId: PlayerId,
  targets: CardId[],
): AbilityCost | undefined {
  let owed = 0;
  for (const targetId of targets) {
    if (state.permanents[targetId] === undefined) continue;
    if (controllerOf(state, targetId) === playerId) continue;
    owed += characteristicsOf(state, targetId).deflect;
  }
  return owed === 0
    ? undefined
    : { kind: "pay", cost: { energy: 0, power: {}, anyPower: owed } };
}

/** The filters a spell's own rules text names, if it names any (R355.5). */
function spellAbility(state: GameState, cardId: CardId) {
  const ability = abilitiesOf(state, cardId).find(
    (each) => each.kind === "activated" || each.kind === "triggered",
  );
  return ability === undefined ||
    (ability.kind !== "activated" && ability.kind !== "triggered")
    ? undefined
    : ability;
}

/**
 * What a spell chooses, for one execution taking `mode`. Modal cards ask for
 * different things per arm — Rocket Barrage's "a unit in a base" against "a
 * gear" — so the filters cannot be read once for the whole play.
 */
function spellTargeting(
  state: GameState,
  cardId: CardId,
  mode = 0,
): TargetFilter[] | undefined {
  const ability = spellAbility(state, cardId);
  return ability === undefined ? undefined : modeOf(ability, mode).targeting?.filters;
}

/** R355.5 — how many choices one execution of this spell owes. */
function targetCountFor(state: GameState, cardId: CardId, mode: number): number {
  return spellTargeting(state, cardId, mode)?.length ?? 0;
}

/**
 * How many modes a card offers. Zero means it is not modal, which is not the
 * same as one: a non-modal card's single implicit mode is index 0.
 */
export function modeCountOf(state: GameState, cardId: CardId): number {
  return spellAbility(state, cardId)?.modes?.length ?? 0;
}

/**
 * R383.3.b.1 — a triggered ability's base cost "must be paid in order to
 * finalize the Triggered Ability to the Chain". Paid once every choice it owed
 * has been answered; an unpayable cost takes the item back off the chain.
 */
function payTriggerCosts(
  state: GameState,
): { state: GameState; events: GameEvent[]; removed: boolean } | null {
  const chainIndex = state.chain.length - 1;
  const item = state.chain[chainIndex];
  if (item === undefined || item.kind !== "trigger") return null;
  if (item.costsPaid === true) return null;

  const costs = item.ability.costs ?? [];
  if (costs.length === 0) {
    return {
      state: {
        ...state,
        chain: state.chain.map((entry, i) =>
          i === chainIndex ? { ...entry, costsPaid: true as const } : entry,
        ),
      },
      events: [],
      removed: false,
    };
  }

  const context: EffectContext = {
    controller: item.controller,
    sourceId: chainItemCardId(item),
    targets: item.targets,
  };

  let current = state;
  const events: GameEvent[] = [];
  for (const cost of costs) {
    const paid = payAbilityCost(current, cost, context);
    if (paid === undefined) {
      // Unpayable, so it never finalizes: off the chain, like a declined
      // "you may" (R383.3.a.2).
      return {
        state: { ...state, chain: state.chain.slice(0, chainIndex) },
        events: [
          {
            type: "abilityDeclined",
            playerId: item.controller,
            cardId: context.sourceId,
          },
        ],
        removed: true,
      };
    }
    current = paid.state;
    events.push(...paid.events);
  }

  return {
    state: {
      ...current,
      chain: current.chain.map((entry, i) =>
        i === chainIndex ? { ...entry, costsPaid: true as const } : entry,
      ),
    },
    events,
    removed: false,
  };
}

/** Attaches any outstanding decision to the state, blocking other actions. */
function awaitDecisions(result: ActionResult): ActionResult {
  if (!result.ok) return result;

  // R320.1 — a task-raised decision outranks anything on the chain, because the
  // queue has to drain before a chain item may be finalized at all.
  if (result.state.tasks.length > 0) return result;

  let current = result.state;
  const extra: GameEvent[] = [];
  let pending = nextDecision(current);

  // Finalizing one item can uncover the next: an unpayable cost or an
  // impossible choice removes its trigger, and the item beneath may still owe
  // choices of its own.
  for (;;) {
    // R355.8 — "In order to put a spell or ability on the chain, valid choices
    // must be made for all targets." With nothing legal to choose, there are
    // none to be made, so the ability does not go on the chain at all.
    if (pending?.prompt.kind === "chooseTargets" && pending.prompt.legal.length === 0) {
      const chainIndex = pending.prompt.chainIndex;
      const item = current.chain[chainIndex];
      current = { ...current, chain: current.chain.slice(0, chainIndex) };
      if (item !== undefined) {
        extra.push({
          type: "abilityDeclined",
          playerId: item.controller,
          cardId: chainItemCardId(item),
        });
      }
      pending = nextDecision(current);
      continue;
    }
    if (pending !== null) break;

    const paid = payTriggerCosts(current);
    if (paid === null) break;
    current = paid.state;
    extra.push(...paid.events);
    pending = nextDecision(current);
  }

  if (extra.length > 0) {
    result = { ...result, state: current, events: [...result.events, ...extra] };
  } else {
    result = { ...result, state: current };
  }

  if (pending === null) {
    return { ...result, state: { ...result.state, pending: null } };
  }

  return {
    ok: true,
    state: { ...result.state, pending },
    events: [
      ...result.events,
      {
        type: "decisionRequired",
        playerId: pending.player,
        kind: pending.prompt.kind,
      },
    ],
  };
}

/** R355.8 / R383.3.a — resolve the outstanding choice. */
export function decide(
  state: GameState,
  playerId: PlayerId,
  choice: { targets?: CardId[]; perform?: boolean },
): ActionResult {
  const pending = state.pending;
  if (pending === null) return rejected("noDecision");
  if (pending.player !== playerId) return rejected("notYourDecision");

  const { prompt } = pending;

  // R117 — the setup Mulligan. Zero cards is a legal answer ("keep").
  if (prompt.kind === "mulligan") {
    const chosen = choice.targets ?? [];
    if (chosen.length > prompt.max) return rejected("wrongTargetCount");
    if (!chosen.every((id) => prompt.legal.includes(id))) {
      return rejected("invalidTarget");
    }
    const done = applyMulligan(state, playerId, chosen);
    const worked = runTasks(done.state, done.events);
    return afterTasks(worked.state, [...done.events, ...worked.events]);
  }

  // R323.12 — the Turn Player picks which staged battlefield opens.
  if (prompt.kind === "chooseStagedBattlefield") {
    const chosen = choice.targets ?? [];
    const battlefieldId = chosen[0];
    if (chosen.length !== 1) return rejected("wrongTargetCount");
    if (battlefieldId === undefined || !prompt.legal.includes(battlefieldId)) {
      return rejected("invalidTarget");
    }
    const opened = applyStagedShowdown(state, battlefieldId);
    const worked = runTasks(opened.state, opened.events);
    return afterTasks(worked.state, [...opened.events, ...worked.events]);
  }

  // A task-raised decision belongs to the queue, not to a chain item: answer
  // it, then let the queue carry on from where it suspended.
  if (prompt.kind === "assignCombatDamage") {
    const chosen = choice.targets ?? [];
    if (chosen.length !== 1) return rejected("wrongTargetCount");
    const cardId = chosen[0];
    if (cardId === undefined || !prompt.legal.includes(cardId)) {
      return rejected("invalidTarget");
    }
    return resumeTasks(state, cardId, playerId);
  }

  // R372 — which replacement applies to a death. Belongs to the queue: the
  // cleanup stopped half-way to ask and resumes with the answer recorded.
  if (prompt.kind === "orderReplacements") {
    const chosen = choice.targets ?? [];
    const sourceId = chosen[0];
    if (chosen.length !== 1) return rejected("wrongTargetCount");
    if (sourceId === undefined || !prompt.legal.includes(sourceId)) {
      return rejected("invalidTarget");
    }
    const worked = runTasks(
      applyReplacementOrder(state, prompt.subject, sourceId),
    );
    return afterTasks(worked.state, worked.events);
  }

  // A choice made mid-resolution belongs to the queue, like combat assignment.
  // R372 for damage — the full order, since which is applied first changes
  // the number that lands.
  if (prompt.kind === "orderDamage") {
    const chosen = choice.targets ?? [];
    if (chosen.length !== prompt.legal.length) {
      return rejected("wrongTargetCount");
    }
    if (!chosen.every((id) => prompt.legal.includes(id))) {
      return rejected("invalidTarget");
    }
    // Two things can be waiting on this: an effect that paused mid-resolution,
    // or the combat damage task, which asks before dealing.
    const head = state.tasks[0];
    const answered =
      head?.kind === "combatDamage"
        ? applyDamageOrder(state, prompt.subject, chosen)
        : applyResumeAnswer(state, chosen);
    const worked = runTasks(answered);
    return afterTasks(worked.state, worked.events);
  }

  // R436.1 — a Predict's Recycle choice. "Any number" includes none, so the
  // only check is that every named card was one of the revealed ones.
  if (prompt.kind === "predict") {
    const chosen = choice.targets ?? [];
    if (!chosen.every((id) => prompt.legal.includes(id))) {
      return rejected("invalidTarget");
    }
    if (new Set(chosen).size !== chosen.length) return rejected("invalidTarget");
    const worked = runTasks(applyResumeAnswer(state, chosen));
    return afterTasks(worked.state, worked.events);
  }

  // R436.1.a — the order the kept cards go back in. The whole list, top first.
  if (prompt.kind === "orderPredicted") {
    const chosen = choice.targets ?? [];
    if (chosen.length !== prompt.legal.length) {
      return rejected("wrongTargetCount");
    }
    if (
      new Set(chosen).size !== chosen.length ||
      !chosen.every((id) => prompt.legal.includes(id))
    ) {
      return rejected("invalidTarget");
    }
    const worked = runTasks(applyResumeAnswer(state, chosen));
    return afterTasks(worked.state, worked.events);
  }

  // "Choose one —" on a trigger. The answer is a mode index rather than a
  // card, so it arrives on `targets` as a number in string form.
  if (prompt.kind === "chooseMode") {
    const chosen = choice.targets ?? [];
    if (chosen.length !== 1) return rejected("wrongTargetCount");
    const mode = Number(chosen[0]);
    if (!Number.isInteger(mode) || !prompt.legal.includes(mode)) {
      return rejected("invalidMode");
    }
    const item = state.chain[prompt.chainIndex];
    if (item === undefined || item.kind !== "trigger") return rejected("noDecision");
    return awaitDecisions({
      ok: true,
      state: {
        ...state,
        chain: state.chain.map((each, i) =>
          i === prompt.chainIndex ? { ...each, mode } : each,
        ),
        pending: null,
      },
      events: [],
    });
  }

  if (prompt.kind === "chooseFromRevealed") {
    const chosen = choice.targets ?? [];
    if (chosen.length !== Math.max(1, prompt.keep)) {
      return rejected("wrongTargetCount");
    }
    if (!chosen.every((id) => prompt.legal.includes(id))) {
      return rejected("invalidTarget");
    }
    const worked = runTasks(applyResumeAnswer(state, chosen));
    return afterTasks(worked.state, worked.events);
  }

  const item = state.chain[prompt.chainIndex];
  if (item === undefined || item.kind !== "trigger") return rejected("noDecision");

  if (prompt.kind === "confirmOptional") {
    // R383.3.a.2 — declining removes it from the chain; it never triggered.
    if (choice.perform === false) {
      return awaitDecisions({
        ok: true,
        state: {
          ...state,
          chain: state.chain.filter((_, i) => i !== prompt.chainIndex),
          priorityPasses: 0,
        },
        events: [
          {
            type: "abilityDeclined",
            playerId,
            cardId: item.sourceId,
          },
        ],
      });
    }

    return awaitDecisions({
      ok: true,
      state: {
        ...state,
        chain: state.chain.map((entry, i) =>
          i === prompt.chainIndex && entry.kind === "trigger"
            ? { ...entry, optionalResolved: true }
            : entry,
        ),
      },
      events: [],
    });
  }

  // One answer per prompt, appended in the order the card asks for them.
  const targets = choice.targets ?? [];
  if (targets.length !== 1) return rejected("wrongTargetCount");
  if (!targets.every((id) => prompt.legal.includes(id))) {
    return rejected("invalidTarget");
  }

  return awaitDecisions({
    ok: true,
    state: {
      ...state,
      chain: state.chain.map((entry, i) =>
        i === prompt.chainIndex
          ? { ...entry, targets: [...entry.targets, ...targets] }
          : entry,
      ),
    },
    events: [{ type: "targetsChosen", playerId, targets }],
  });
}

function withPlayer(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
): GameState {
  return { ...state, players: { ...state.players, [playerId]: player } };
}

/**
 * A harness action, not a rules action: Riftbound has no "draw a card" move.
 * Drawing happens in the Draw Phase or from an effect, both of which go through
 * `drawCards` and can Burn Out (R431). This rejects on an empty deck instead,
 * so tests using it as a generic "make something happen" stay honest.
 */
export function drawCard(state: GameState, playerId: PlayerId): ActionResult {
  const player = state.players[playerId];
  const [drawnId, ...remainingDeck] = player.mainDeck;

  if (drawnId === undefined) {
    return rejected("deckEmpty");
  }

  return {
    ok: true,
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          mainDeck: remainingDeck,
          hand: [...player.hand, drawnId],
        },
      },
    },
    events: [{ type: "cardDrawn", playerId, cardId: drawnId }],
  };
}

export function playUnitFromHand(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  destination: Location = { kind: "base", player: playerId },
  payOptional = false,
  playFrom = 0,
): ActionResult {
  const player = state.players[playerId];
  const card = state.cards[cardId];

  if (card === undefined) {
    return rejected("cardNotFound");
  }
  // R359.2.d — non-unit Gear "enters the Board Ready at the player's Base",
  // so it is played through here too, with no location to choose.
  const isGear = card.type === "gear";
  if (card.type !== "unit" && !isGear) {
    return rejected("wrongCardType");
  }

  // R355.1.a — offering to pay an optional additional cost the card does not
  // have is not a choice that exists, so it is rejected rather than ignored.
  if (
    payOptional &&
    !additionalCostsOf(state, cardId).some((extra) => extra.optional)
  ) {
    return rejected("noAdditionalCost");
  }

  // R354.1 and the rules that widen it: hand, Champion Zone (R108.3.d) and
  // Facedown Zone (R811.1.b) are one shape, so what the zone changes about the
  // play is read off it rather than branched on here.
  const zone = playZonesFor(state, playerId, cardId)[playFrom];

  if (zone?.grantsReaction === true) {
    // R811.1.d.1 — a hidden permanent must go back to the battlefield it was
    // hidden at, and nowhere else.
    if (
      zone.destination !== undefined &&
      !sameLocation(destination, zone.destination)
    ) {
      return rejected("invalidDestination");
    }
    if (!canPlayAtThisTiming(state, playerId, ["reaction"])) {
      return rejected("wrongTiming");
    }
    if (chainExists(state) && state.priority !== playerId) {
      return rejected("notYourPriority");
    }
  } else if (playedWithReactionTiming(state, playerId, cardId, destination)) {
    // R822.1.b — an Ambushing unit "has [Reaction] as long as I'm being played
    // to a battlefield where you control Units", so the timing it may be played
    // at depends on where it is going, not on the card alone.
    if (!canPlayAtThisTiming(state, playerId, ["reaction"])) {
      return rejected("wrongTiming");
    }
    // R338.1 — while the chain is up, only the priority holder may act.
    if (chainExists(state) && state.priority !== playerId) {
      return rejected("notYourPriority");
    }
  } else {
    if (state.turn.player !== playerId) {
      return rejected("notYourTurn");
    }
    if (state.turn.phase !== "main") {
      return rejected("wrongPhase");
    }
    // R343.1.a — cards can't be played during a showdown state by default.
    if (state.showdown !== null) {
      return rejected("showdownInProgress");
    }
    // A chain up is a Closed State; playing a unit needs [Reaction] (R813).
    if (chainExists(state)) {
      return rejected("wrongTiming");
    }
  }

  if (zone === undefined) {
    return rejected("notInHand");
  }
  if (zone.destination === undefined) {
    // R355.2 — the chosen location has to be a valid one. R355.2.a's default is
    // "the controller's Base or a Battlefield the controller controls"; anything
    // beyond that is a permission the card carries (R355.2.b). R811.1.d.1.a is
    // the one exception, and the zone answers for it above.
    if (!isGear && !isValidPlayLocation(state, playerId, cardId, destination)) {
      return rejected("invalidDestination");
    }
    if (isGear && destination.kind !== "base") {
      return rejected("invalidDestination");
    }
  }

  // R356 — the Total Cost, not the printed one: base modifications, then any
  // additional cost the player chose to pay, then discounts. R356.1.b.3 is why
  // a hidden card can still owe something: an additional cost raises a base
  // cost of zero back above it.
  const cost = totalCostOf(state, playerId, cardId, {
    payOptional,
    ignoreBaseCost: zone.ignoreBaseCost === true,
    ...(zone.alternateCost !== undefined
      ? { alternateCost: zone.alternateCost }
      : {}),
  });
  const remainingPool = spend(player.runePool, cost, {
    kind: "playCard",
    cardType: card.type,
  });
  if (remainingPool === undefined) {
    return rejected("cannotAffordCost");
  }

  const playedFrom: PlaySource = zone.source;
  // Whatever a waiting "your next card costs less" gave, it gave it to this
  // card and is spent. R354 step 1 then takes the card out of wherever it
  // came from — "move the card from its current zone to the Chain".
  const leftZone = leaveZone(
    consumeDiscount(state, playerId),
    playerId,
    cardId,
    zone,
  );

  return {
    ok: true,
    state: {
      ...withPlayer(leftZone, playerId, {
        ...leftZone.players[playerId],
        runePool: remainingPool,
      }),
      permanents: {
        ...state.permanents,
        [cardId]: {
          cardId,
          controller: playerId,
          // R359.2.c — a unit enters exhausted; R359.2.d — gear enters ready.
          // R369.3 is the family of replacement effects that alter *how* a
          // unit enters, and [Accelerate] is one of them rather than a case
          // spelled out here.
          exhausted:
            !isGear &&
            !entersReady(state, playerId, cardId, {
              paidAdditionalCost: payOptional,
            }),
          location: destination,
          damage: 0,
          // R205 — a later "if you paid the additional cost" checks whether the
          // game action happened, so it is recorded rather than re-derived.
          ...(payOptional ? { paidAdditionalCost: true as const } : {}),
          playedFrom,
        },
      },
      battlefields: applyContested(state, destination, playerId),
      playedThisTurn: recordFinalized(state, playerId, cardId),
    },
    events: [
      { type: "costPaid", playerId, cardId, cost },
      // R383.4.a.4 — a gear's own "when you play this" is a play effect too,
      // and `unitPlayed`'s subject filters are what tell the two apart.
      { type: "unitPlayed", playerId, cardId },
    ],
  };
}

/**
 * R190.3.a — arriving at a battlefield you don't already control applies
 * Contested. Establishing control needs a Showdown or Combat (R190.4), which
 * doesn't exist yet, so control itself is never set here.
 */
function applyContested(
  state: GameState,
  destination: Location,
  mover: PlayerId,
): Record<CardId, BattlefieldState> {
  if (destination.kind !== "battlefield") {
    return state.battlefields;
  }

  const battlefield = state.battlefields[destination.id];
  if (battlefield === undefined || battlefield.controller === mover) {
    return state.battlefields;
  }

  return {
    ...state.battlefields,
    [destination.id]: { ...battlefield, contestedBy: mover },
  };
}

/**
 * R144 — a unit's inherent Standard Move. Costs exhausting the unit, is Main
 * Phase only, and may go base→battlefield or battlefield→base. Battlefield to
 * battlefield needs Ganking (R144.4.c / R810).
 */
export function standardMove(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  destination: Location,
): ActionResult {
  if (state.turn.player !== playerId) {
    return rejected("notYourTurn");
  }
  if (state.turn.phase !== "main") {
    return rejected("wrongPhase");
  }
  // R144.1.c — a standard move can't be performed during a showdown or combat.
  if (state.showdown !== null) {
    return rejected("showdownInProgress");
  }

  const card = state.cards[cardId];
  const permanent = state.permanents[cardId];
  if (card === undefined) {
    return rejected("cardNotFound");
  }
  if (permanent === undefined) {
    return rejected("notOnBoard");
  }
  if (card.type !== "unit") {
    return rejected("notAPermanent");
  }
  if (controllerOf(state, permanent.cardId) !== playerId) {
    return rejected("sourceNotControlled");
  }
  // R144.2 — exhausting the unit is the cost, so it must be ready.
  if (permanent.exhausted) {
    return rejected("alreadyExhausted");
  }
  // Vex, Apathetic — "They can't move it this turn."
  if (movementRestricted(state, cardId)) {
    return rejected("cannotMove");
  }
  if (sameLocation(permanent.location, destination)) {
    return rejected("alreadyThere");
  }

  const origin = permanent.location;
  const toOwnBase =
    destination.kind === "base" && destination.player === playerId;
  const toBattlefield =
    destination.kind === "battlefield" &&
    state.battlefields[destination.id] !== undefined;

  if (!toOwnBase && !toBattlefield) {
    return rejected("invalidDestination");
  }
  // R810.1.b — "I may move to a battlefield from another battlefield with a
  // standard move." R810.3 makes having Ganking a characteristic, so it is
  // read through the layers: Boots of Swiftness grants it by being attached
  // (R477.2.c), and a unit wearing them can gank as surely as one that prints
  // the keyword.
  if (
    origin.kind === "battlefield" &&
    destination.kind === "battlefield" &&
    !keywordsOf(state, cardId).includes("ganking")
  ) {
    return rejected("invalidDestination");
  }

  return {
    ok: true,
    state: {
      ...state,
      permanents: {
        ...state.permanents,
        [cardId]: { ...permanent, exhausted: true, location: destination },
      },
      battlefields: applyContested(state, destination, playerId),
    },
    events: [{ type: "unitMoved", playerId, cardId, from: origin, to: destination }],
  };
}

/** R347.2 — the player with Focus passes; two passes in sequence close it. */
export function passFocus(state: GameState, playerId: PlayerId): ActionResult {
  if (state.showdown === null) {
    return rejected("noShowdown");
  }
  if (state.showdown.focus !== playerId) {
    return rejected("notYourFocus");
  }

  const progress = runPassFocus(state, playerId);
  return thenCleanup({
    ok: true,
    state: progress.state,
    events: progress.events,
  });
}

/**
 * R421 — Hide. R811.1.c.2 keeps it off the chain, so it takes effect at once;
 * a cleanup still follows because the board changed.
 */
export function hide(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  battlefieldId: CardId,
): ActionResult {
  const outcome = runHide(state, playerId, cardId, battlefieldId);
  if (typeof outcome === "string") return rejected(outcome);
  return thenCleanup({ ok: true, state: outcome.state, events: outcome.events });
}

/**
 * R354–359 — playing a spell. Steps 1–6 run atomically here: the card moves to
 * the chain, targets are taken from the action, the cost is paid, and it
 * finalizes. A spell then *lingers* on the chain (R359.3) rather than resolving,
 * which is what gives the opponent a window to react.
 */
export function playSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  targets: CardId[] = [],
  payOptional = false,
  payRepeats: number[] = [],
  playFrom = 0,
  modes: number[] = [],
): ActionResult {
  const player = state.players[playerId];
  const card = state.cards[cardId];

  if (card === undefined) return rejected("cardNotFound");
  if (card.type !== "spell") return rejected("wrongCardType");

  // R354.1 and the rules that widen it — see `playZonesFor`. What the zone
  // changes about this play is read off it rather than branched on here.
  const zone = playZonesFor(state, playerId, cardId)[playFrom];
  if (zone === undefined) return rejected("notInHand");

  // R811.1.b — the Facedown Zone grants [Reaction] on top of the card's own
  // keywords. R829.1.b.2 is the contrast: [Flow] changes the zone a spell can
  // be played from and nothing else about its timing.
  const timingKeywords =
    zone.grantsReaction === true
      ? ["reaction", ...card.keywords]
      : card.keywords;
  if (!canPlayAtThisTiming(state, playerId, timingKeywords)) {
    return rejected("wrongTiming");
  }
  // R338.1 — while the chain is up, only the player holding priority may act.
  if (chainExists(state) && state.priority !== playerId) {
    return rejected("notYourPriority");
  }

  const hasOptional = additionalCostsOf(state, cardId).some(
    (extra) => extra.optional,
  );
  if (payOptional && !hasOptional) return rejected("noAdditionalCost");

  // R820.1.c.3 — "Each Repeat Cost can be paid only a single time", so a
  // repeated index is not a second payment but a malformed action.
  const repeats = repeatCostsOf(state, cardId);
  if (new Set(payRepeats).size !== payRepeats.length) {
    return rejected("noAdditionalCost");
  }
  if (payRepeats.some((index) => repeats[index] === undefined)) {
    return rejected("noAdditionalCost");
  }
  // R820.3 — one additional execution for each instance paid for.
  const executions = 1 + payRepeats.length;

  // "Choose one —". R820.2 makes the mode one of the Relevant Choices made as
  // the card is played, and R820.2.a lets each execution choose for itself, so
  // there is one entry per execution rather than one per card.
  const modeCount = modeCountOf(state, cardId);
  const chosenModes =
    modeCount === 0
      ? Array.from({ length: executions }, () => 0)
      : modes.length === executions
        ? modes
        : undefined;
  if (chosenModes === undefined) return rejected("wrongModeCount");
  if (modeCount > 0 && chosenModes.some((m) => m < 0 || m >= modeCount)) {
    return rejected("invalidMode");
  }
  // Curtain Call — "Choose one you haven't already chosen". Only bites when a
  // [Repeat] gives the same play more than one execution.
  if (
    spellAbility(state, cardId)?.distinctModes === true &&
    new Set(chosenModes).size !== chosenModes.length
  ) {
    return rejected("invalidMode");
  }

  // R356.1.b — a hidden card is played "ignoring its base cost", which
  // R356.1.b.3 still lets an additional cost raise back above zero.
  const cost = totalCostOf(state, playerId, cardId, {
    payOptional,
    payRepeats,
    ignoreBaseCost: zone.ignoreBaseCost === true,
    ...(zone.alternateCost !== undefined
      ? { alternateCost: zone.alternateCost }
      : {}),
    // R809.1.d — Deflect prices the targets, so they are part of the cost.
    targets,
  });

  const remainingPool = spend(player.runePool, cost, {
    kind: "playCard",
    cardType: "spell",
  });
  if (remainingPool === undefined) return rejected("cannotAffordCost");

  // R820.1.c.2 / R829.1.c.2 — a [Repeat] or [Flow] cost "may include both
  // resource costs and non-resource costs". The resources went through
  // `spend`; discarding, disempowering and the rest are paid the same way an
  // ability's costs are, and refuse the play if they cannot be.
  const extraCosts: AbilityCost[] = [
    ...(zone.extraCosts ?? []),
    ...payRepeats.flatMap((index) =>
      (repeats[index] ?? []).filter((each) => each.kind !== "pay"),
    ),
  ];
  // R354 step 1 — "Move the card from its current zone to the Chain" is the
  // *first* step of playing, before R355's choices and R356's costs. Taking it
  // out of its zone here rather than at the end is what stops a discard cost
  // from being paid with the very card being played.
  const afterZone = leaveZone(
    consumeDiscount(state, playerId),
    playerId,
    cardId,
    zone,
  );
  let afterExtras: GameState = withPlayer(afterZone, playerId, {
    ...afterZone.players[playerId],
    runePool: remainingPool,
  });
  const extraEvents: GameEvent[] = [];
  for (const each of extraCosts) {
    const paid = payAbilityCost(afterExtras, each, {
      controller: playerId,
      sourceId: cardId,
      targets,
    });
    if (paid === undefined) return rejected("cannotAffordCost");
    afterExtras = paid.state;
    extraEvents.push(...paid.events);
  }

  // R355.5/R355.8 — a spell's choices are made as it is played, and each one
  // has to be valid for the filter the card names in that position.
  if (spellTargeting(state, cardId, chosenModes[0]!) !== undefined) {
    // Each execution's choices are judged on their own. R820.2.a is explicit
    // that a repeat "may choose the same target or a different one", so the
    // no-reusing-an-object rule binds inside one execution and not across two.
    // The stride is per-execution rather than fixed: two modes of the same card
    // can want different numbers of things.
    let offset = 0;
    for (const mode of chosenModes) {
      const filters = spellTargeting(state, cardId, mode) ?? [];
      const chosen: CardId[] = [];
      for (const [index, filter] of filters.entries()) {
        const targetId = targets[offset + index];
        if (targetId === undefined) return rejected("wrongTargetCount");
        const legal = legalTargets(state, playerId, filter, cardId);
        // R355.5.a-style uniqueness: two filters naming two things cannot both
        // be answered with the same object.
        if (!legal.includes(targetId) || chosen.includes(targetId)) {
          return rejected("invalidTarget");
        }
        chosen.push(targetId);
      }
      offset += filters.length;
    }
    if (targets.length !== offset) return rejected("wrongTargetCount");
  } else {
    for (const targetId of targets) {
      const isOnBoard = state.permanents[targetId] !== undefined;
      const isOnChain = state.chain.some(
        (item) => item.kind === "spell" && item.cardId === targetId,
      );
      if (!isOnBoard && !isOnChain) return rejected("invalidTarget");
    }
  }

  return {
    ok: true,
    state: {
      ...afterExtras,
      chain: [
        ...state.chain,
        {
          kind: "spell" as const,
          cardId,
          controller: playerId,
          targets,
          ...(payOptional ? { paidAdditionalCost: true as const } : {}),
          // R820.3 — how many *additional* times the instructions run.
          ...(payRepeats.length > 0 ? { repeats: payRepeats.length } : {}),
          ...(modeCount > 0 ? { modes: chosenModes } : {}),
          // R829.1.b.1 — the replacement belongs to this play, so the chain
          // item is what carries it off the chain.
          ...(zone.banishOnLeave === true ? { banishOnLeave: true as const } : {}),
          playedFrom: zone.source,
        },
      ],
      // R337.4 — the controller of the newest item receives priority; the
      // chain only resolves once both players pass in sequence (R339).
      priority: playerId,
      priorityPasses: 0,
      playedThisTurn: recordFinalized(state, playerId, cardId),
    },
    events: [
      { type: "costPaid", playerId, cardId, cost },
      ...extraEvents,
      { type: "spellPlayed", playerId, cardId },
    ],
  };
}

/**
 * R806 / R813 — a spell needs [Reaction] to be played while the chain is up
 * (a Closed State), and [Action] or [Reaction] during a showdown. Otherwise it
 * needs a Neutral Open State on its controller's own Main Phase.
 */
function canPlayAtThisTiming(
  state: GameState,
  playerId: PlayerId,
  keywords: readonly string[],
): boolean {
  if (chainExists(state)) return keywords.includes("reaction");
  if (state.showdown !== null) {
    return keywords.includes("reaction") || keywords.includes("action");
  }
  return state.turn.player === playerId && state.turn.phase === "main";
}

/**
 * R339/R340 — passing priority. Once both players pass in sequence the newest
 * finalized item resolves; the chain is LIFO.
 */
export function passPriority(
  state: GameState,
  playerId: PlayerId,
): ActionResult {
  if (!chainExists(state)) return rejected("noShowdown");
  if (state.priority !== playerId) return rejected("notYourPriority");

  const opponent = playerId === "p1" ? "p2" : "p1";
  const events: GameEvent[] = [{ type: "priorityPassed", playerId }];
  const passes = state.priorityPasses + 1;

  // R339 — only once everyone has passed in sequence does the top item resolve.
  if (passes < 2) {
    return {
      ok: true,
      state: { ...state, priority: opponent, priorityPasses: passes },
      events,
    };
  }

  const item = newestItem(state);
  if (item === undefined) return rejected("noShowdown");

  const sourceId = chainItemCardId(item);
  const card = state.cards[sourceId];
  let current: GameState = {
    ...state,
    chain: state.chain.slice(0, -1),
  };

  if (card !== undefined) {
    // A trigger carries its own ability; a spell's rules text is its first.
    // Both are read through the layers rather than off the printed card, so
    // copied rules text and keyword shorthand are as real as printed text.
    // A spell's rules text is its first *resolving* ability. Cards now carry
    // non-resolving ones too — play permissions, additional costs, cost
    // modifiers — and those can be printed above the text that does the work.
    const ability =
      item.kind === "trigger"
        ? item.ability
        : abilitiesOf(current, sourceId).find(
            (each) => each.kind === "activated" || each.kind === "triggered",
          );
    // Neither a passive (read live by the layer pipeline) nor a play permission
    // (read off a card in hand) ever resolves, so both contribute nothing here
    // even if one is somehow reached.
    const resolving =
      ability !== undefined &&
      (ability.kind === "activated" || ability.kind === "triggered")
        ? ability
        : undefined;

    // R820.1.d — "execute the instructions of this chain item one additional
    // time during resolution", once per [Repeat] cost paid. Expressed as a
    // `seq` rather than a loop because an execution can stop mid-way to ask
    // (R321): `seq` folds its remaining steps into the paused effect, so the
    // second execution waits for the first to finish answering.
    //
    // R820.2.a lets each execution choose for itself — both its mode and its
    // targets — so the later copies read later slices of the same flat
    // `targets` list, and the offsets are accumulated rather than a fixed
    // stride: two modes of the same card can want different numbers of things.
    const chosenModes =
      item.kind === "spell"
        ? (item.modes ??
          Array.from({ length: 1 + (item.repeats ?? 0) }, () => 0))
        : [item.mode ?? 0];

    const steps: Effect[] = [];
    let offset = 0;
    for (const mode of chosenModes) {
      if (resolving === undefined) break;
      const arm = modeOf(resolving, mode);
      steps.push(shiftTargets(arm.effect, offset));
      offset += arm.targeting?.filters.length ?? 0;
    }
    const effect: Effect =
      steps.length === 1
        ? steps[0]!
        : { op: "seq" as const, steps };

    const sourceLocation = sourceLocationOf(current, item);

    const outcome = execute(current, effect, {
      controller: item.controller,
      sourceId,
      targets: item.targets,
      ...(sourceLocation !== undefined ? { sourceLocation } : {}),
      ...(item.kind === "spell" && item.paidAdditionalCost === true
        ? { paidAdditionalCost: true }
        : {}),
      ...(item.kind === "spell" && item.playedFrom !== undefined
        ? { playedFrom: item.playedFrom }
        : {}),
    });
    // An effect that stopped to ask leaves the rest of itself on the queue.
    const parked = park(outcome);
    current = parked.state;
    events.push(...parked.events);

    if (item.kind === "spell") {
      // R359.3.d — a resolved spell leaves the chain. Where it goes is
      // `leaveChain`'s business, not this step's.
      const left = leaveChain(current, item, "resolved");
      current = left.state;
      events.push(
        {
          type: "spellResolved",
          playerId: item.controller,
          cardId: item.cardId,
        },
        ...left.events,
      );
    } else {
      events.push({
        type: "triggerResolved",
        playerId: item.controller,
        cardId: sourceId,
      });
    }
  }

  // R424.1.a.3 — the Revealed state "lasts until the resolution of that spell
  // or ability finishes". This is that moment, so it ends here rather than
  // lingering into whatever resolves next.
  if (current.revealed.length > 0) current = { ...current, revealed: [] };

  // R340.2/340.4 — an empty chain reopens the state; otherwise the controller
  // of the new top item receives priority.
  const stillUp = current.chain.length > 0;
  current = {
    ...current,
    priority: stillUp
      ? (current.chain[current.chain.length - 1]?.controller ?? null)
      : null,
    priorityPasses: 0,
  };

  return awaitDecisions(thenCleanup({ ok: true, state: current, events }));
}

export function endTurn(
  state: GameState,
  playerId: PlayerId,
): ActionResult {
  if (state.turn.player !== playerId) {
    return rejected("notYourTurn");
  }
  // A showdown or an unresolved chain has to settle before the turn can end.
  if (state.showdown !== null || chainExists(state)) {
    return rejected("showdownInProgress");
  }

  // R317 — ending the turn queues its first step and lets the driver walk the
  // rest, pausing at any step that raises a trigger (R335) or needs a decision.
  const worked = runTasks(
    enqueue(state, {
      kind: "turnStep",
      player: playerId,
      step: "ending",
      number: state.turn.number,
    }),
  );
  return { ok: true, state: worked.state, events: worked.events };
}

/**
 * Pays one ability cost, or returns undefined if it can't be paid. Only rune
 * sources are handled so far — recycling a main-deck card as a cost (Ekko,
 * Recurrent's "Recycle me") needs permanents to be recyclable first.
 */
function payAbilityCost(
  state: GameState,
  cost: AbilityCost,
  context: EffectContext,
): { state: GameState; events: GameEvent[] } | undefined {
  const { controller, sourceId } = context;
  const player = state.players[controller];
  const rune = state.runes[sourceId];
  const permanent = state.permanents[sourceId];

  switch (cost.kind) {
    // R414.1.b — an already-exhausted object can't be exhausted again. Runes
    // and permanents both track this, so either can pay it.
    // R383.3.b — "pay [1]" written into the front of a triggered ability's
    // effect is that ability's base cost, so it is paid to finalize.
    case "pay": {
      const remaining = spend(player.runePool, cost.cost, {
        kind: "activateAbility",
      });
      if (remaining === undefined) return undefined;
      return {
        state: withPlayer(state, controller, { ...player, runePool: remaining }),
        events: [
          {
            type: "costPaid",
            playerId: controller,
            cardId: sourceId,
            cost: cost.cost,
          },
        ],
      };
    }

    // R728 — XP is a plain number on the player, so the cost is a subtraction
    // that fails when the player is short.
    case "spendXP": {
      if (player.xp < cost.amount) return undefined;
      return {
        state: withPlayer(state, controller, {
          ...player,
          xp: player.xp - cost.amount,
        }),
        events: [
          { type: "xpGained", playerId: controller, amount: -cost.amount },
        ],
      };
    }

    // R701–705 — "Spend my buff". The buff is the cost, so an unbuffed source
    // simply cannot pay it.
    case "spendBuff": {
      if (permanent === undefined || permanent.buffed !== true) return undefined;
      const { buffed: _spent, ...rest } = permanent;
      return {
        state: {
          ...state,
          permanents: { ...state.permanents, [sourceId]: rest },
        },
        events: [],
      };
    }

    // R442.1.a — an unempowered source cannot pay this; as a cost that is a
    // refusal, where R442.1.a.1 makes the *effect* silently do nothing.
    case "disempowerSelf": {
      if (permanent === undefined || permanent.empowered !== true) {
        return undefined;
      }
      const { empowered: _spent, ...rest } = permanent;
      return {
        state: {
          ...state,
          permanents: { ...state.permanents, [sourceId]: rest },
        },
        events: [
          { type: "disempowered", playerId: controller, cardId: sourceId },
        ],
      };
    }

    // R422.3 — "the Action must be able to be completed for the cost to be
    // paid", so a short hand cannot pay it at all. Which cards go is not asked:
    // a cost is paid as the ability is played, and R355 leaves no room to stop
    // and ask there, so this takes from the front. Written up as a deviation.
    case "discard": {
      if (player.hand.length < cost.count) return undefined;
      const going = player.hand.slice(0, cost.count);
      return {
        state: withPlayer(state, controller, {
          ...player,
          hand: player.hand.slice(cost.count),
          trash: [...player.trash, ...going],
        }),
        events: going.map((cardId) => ({
          type: "cardDiscarded" as const,
          playerId: controller,
          cardId,
        })),
      };
    }

    case "exhaustSelf": {
      if (rune !== undefined) {
        if (rune.exhausted) return undefined;
        return {
          state: {
            ...state,
            runes: { ...state.runes, [sourceId]: { ...rune, exhausted: true } },
          },
          events: [],
        };
      }
      // R107.4.c — the Champion Legend has no permanent, so its exhausted
      // state lives on the player. Gloomist pays with it.
      if (player.legend === sourceId) {
        if (player.legendExhausted === true) return undefined;
        return {
          state: withPlayer(state, controller, {
            ...player,
            legendExhausted: true,
          }),
          events: [],
        };
      }
      if (permanent !== undefined) {
        if (permanent.exhausted) return undefined;
        return {
          state: {
            ...state,
            permanents: {
              ...state.permanents,
              [sourceId]: { ...permanent, exhausted: true },
            },
          },
          events: [],
        };
      }
      return undefined;
    }

    // R416.1.b — runes recycle to the bottom of the rune deck. No ready
    // requirement, so an exhausted rune can still pay this. Recycling a
    // main-deck permanent goes to the Main Deck instead and isn't modelled yet.
    case "recycleSelf": {
      if (rune === undefined) {
        return undefined;
      }
      const { [sourceId]: _removed, ...remainingRunes } = state.runes;
      return {
        state: {
          ...withPlayer(state, controller, {
            ...player,
            runes: player.runes.filter((id) => id !== sourceId),
            runeDeck: [...player.runeDeck, sourceId],
          }),
          runes: remainingRunes,
        },
        events: [{ type: "runeRecycled", playerId: controller, cardId: sourceId }],
      };
    }

    default: {
      const unhandled: never = cost;
      return undefined;
    }
  }
}

function controlsSource(
  state: GameState,
  playerId: PlayerId,
  sourceId: CardId,
): boolean {
  const player = state.players[playerId];
  return (
    player.runes.includes(sourceId) ||
    (state.permanents[sourceId] !== undefined &&
      controllerOf(state, sourceId) === playerId)
  );
}

export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  sourceId: CardId,
  abilityIndex: number,
  targets: CardId[] = [],
  mode = 0,
): ActionResult {
  const card = state.cards[sourceId];
  if (card === undefined) {
    return rejected("cardNotFound");
  }

  const ability = abilitiesOf(state, sourceId)[abilityIndex];
  // Only activated abilities can be activated; triggered ones fire on their own.
  if (ability === undefined || ability.kind !== "activated") {
    return rejected("abilityNotFound");
  }

  if (!controlsSource(state, playerId, sourceId)) {
    return rejected("sourceNotControlled");
  }

  // R381 — by default an activated ability may only be used on its
  // controller's turn, in an Open State. [Action] and [Reaction] widen that
  // (R806, R813). With no chain yet the state is always Open, so only the
  // turn restriction is enforceable here.
  if (ability.timing === "default" && state.turn.player !== playerId) {
    return rejected("notYourTurn");
  }

  // "Use only once per turn." R383.3.e.1's shape for an activated ability:
  // once it has been used that many times it cannot be used again, so it stops
  // being a legal move rather than resolving to nothing.
  const useTally = `use:${sourceId}#${abilityIndex}`;
  if (
    ability.usesPerTurn !== undefined &&
    (state.triggeredThisTurn[useTally] ?? 0) >= ability.usesPerTurn
  ) {
    return rejected("abilityNotFound");
  }

  // R827.1.c.1 — "Play only if not Empowered." A printed restriction on
  // playing the ability at all, so it is checked before anything is chosen or
  // paid, and `legalActions` stops offering the move once it fails.
  if (
    ability.when !== undefined &&
    !conditionHolds(state, ability.when, {
      controller: playerId,
      sourceId,
      targets,
    })
  ) {
    return rejected("abilityNotFound");
  }

  // "Choose one —" is one of those choices too, and it comes first: which
  // targets the ability wants depends on the arm taken.
  if (ability.modes !== undefined) {
    if (mode < 0 || mode >= ability.modes.length) return rejected("invalidMode");
  }

  // R355.5 / R818.1.b.1 — an activated ability's choices are made as it is
  // activated, and Equip's chosen unit is one of them.
  const arm = modeOf(ability, mode);
  const filters = arm.targeting?.filters ?? [];
  if (targets.length !== filters.length) return rejected("wrongTargetCount");
  for (const [index, filter] of filters.entries()) {
    const legal = legalTargets(state, playerId, filter, sourceId);
    if (!legal.includes(targets[index]!)) return rejected("invalidTarget");
  }

  const context: EffectContext = { controller: playerId, sourceId, targets };

  let current =
    ability.usesPerTurn === undefined
      ? state
      : {
          ...state,
          triggeredThisTurn: {
            ...state.triggeredThisTurn,
            [useTally]: (state.triggeredThisTurn[useTally] ?? 0) + 1,
          },
        };
  const events: GameEvent[] = [];
  // R809.1.c — "Spells and abilities an opponent controls that target [me]
  // cost … more to play as an additional cost", so an ability pays it too.
  const deflect = deflectTax(state, playerId, targets);
  const costs: AbilityCost[] =
    deflect === undefined ? ability.costs : [...ability.costs, deflect];
  for (const cost of costs) {
    const paid = payAbilityCost(current, cost, context);
    if (paid === undefined) {
      return rejected("cannotPayAbilityCost");
    }
    current = paid.state;
    events.push(...paid.events);
  }

  const parked = park(execute(current, arm.effect, context));

  return {
    ok: true,
    state: parked.state,
    events: [...events, ...parked.events],
  };
}

export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.winner !== null) {
    return rejected("gameOver");
  }
  // R320.1 — nothing finalizes or resolves while a choice is outstanding.
  if (state.pending !== null && action.type !== "decide") {
    return rejected("decisionPending");
  }

  switch (action.type) {
    case "drawCard":
      return thenCleanup(drawCard(state, action.playerId));
    case "playUnitFromHand":
      return thenCleanup(
        playUnitFromHand(
          state,
          action.playerId,
          action.cardId,
          action.destination,
          action.payOptional,
        ),
      );
    case "standardMove":
      return thenCleanup(
        standardMove(state, action.playerId, action.cardId, action.destination),
      );
    case "passFocus":
      return passFocus(state, action.playerId);
    case "hide":
      return hide(state, action.playerId, action.cardId, action.battlefieldId);
    case "passPriority":
      return passPriority(state, action.playerId);
    case "decide":
      return decide(state, action.playerId, {
        ...(action.targets !== undefined ? { targets: action.targets } : {}),
        ...(action.perform !== undefined ? { perform: action.perform } : {}),
      });
    case "playSpell":
      return thenCleanup(
        playSpell(
          state,
          action.playerId,
          action.cardId,
          action.targets,
          action.payOptional,
          action.payRepeats,
          action.playFrom,
          action.modes,
        ),
      );
    case "endTurn":
      // endTurn drives the queue itself, so its events are already scanned.
      return thenCleanup(endTurn(state, action.playerId), { scanned: true });
    case "activateAbility":
      return thenCleanup(activateAbility(
        state,
        action.playerId,
        action.sourceId,
        action.abilityIndex,
        action.targets,
        action.mode,
      ));
    default: {
      const unhandled: never = action;
      return rejected("cardNotFound");
    }
  }
}
