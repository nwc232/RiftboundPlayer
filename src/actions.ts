import { execute } from "./abilities.js";
import type { AbilityCost, EffectContext } from "./abilities.js";
import { spend } from "./cost.js";
import type { GameEvent } from "./events.js";
import { permanentsAt, sameLocation } from "./state.js";
import type {
  BattlefieldState,
  CardId,
  GameState,
  Location,
  PlayerId,
  PlayerState,
} from "./state.js";
import {
  chainExists,
  chainItemCardId,
  newestItem,
  sourceLocationOf,
} from "./chain.js";
import { legalTargets } from "./decisions.js";
import type { PendingDecision } from "./decisions.js";
import { collectTriggers } from "./triggers.js";
import { applyCombatAssignment, enqueue, runTasks } from "./tasks.js";
import { passFocus as runPassFocus } from "./showdown.js";
import { beginTurn, endTurn as runEndTurn } from "./turn.js";

export type Action =
  | { type: "drawCard"; playerId: PlayerId }
  | {
      type: "playUnitFromHand";
      playerId: PlayerId;
      cardId: CardId;
      destination?: Location;
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
      targets?: CardId[];
    }
  | {
      type: "activateAbility";
      playerId: PlayerId;
      sourceId: CardId;
      abilityIndex: number;
    };

export type RejectionReason =
  | "cardNotFound"
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

/**
 * R453 — a cleanup runs when a move (or any board change) completes. Triggered
 * abilities are then evaluated against everything that just happened, because
 * R383.2.c checks a trigger's condition after the inciting event is processed.
 */
function afterTasks(current: GameState, events: GameEvent[]): ActionResult {
  // R334.2 — pending chain items are only processed once every task is done.
  if (current.tasks.length > 0) {
    return { ok: true, state: current, events };
  }

  const triggered = collectTriggers(current, events);
  if (triggered.length === 0) {
    return { ok: true, state: current, events };
  }

  const state: GameState = {
    ...current,
    chain: [...current.chain, ...triggered],
    // R383.3.c — triggers go on the chain in any state; as with a spell, the
    // controller of the newest item then receives priority.
    priority: triggered[triggered.length - 1]?.controller ?? current.priority,
    priorityPasses: 0,
  };

  return awaitDecisions({
    ok: true,
    state,
    events: [
      ...events,
      ...triggered.map((item) => ({
        type: "abilityTriggered" as const,
        playerId: item.controller,
        cardId: chainItemCardId(item),
      })),
    ],
  });
}

function thenCleanup(result: ActionResult): ActionResult {
  if (!result.ok) return result;

  const worked = runTasks(enqueue(result.state, { kind: "cleanup" }));
  return afterTasks(worked.state, [...result.events, ...worked.events]);
}

/** Records an answer a task was waiting on, then lets the queue carry on. */
function resumeTasks(
  state: GameState,
  cardId: CardId,
  playerId: PlayerId,
): ActionResult {
  const worked = runTasks(applyCombatAssignment(state, cardId));
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

  const ability = state.cards[item.sourceId]?.abilities[item.abilityIndex];
  if (ability === undefined || ability.kind !== "triggered") return null;

  // R383.3.a is decided before targets are chosen — declining removes the
  // item, so there is no point choosing targets for it first.
  if (ability.optional === true && !item.optionalResolved) {
    return {
      player: item.controller,
      prompt: { kind: "confirmOptional", chainIndex },
    };
  }

  if (ability.targeting !== undefined && item.targets.length === 0) {
    return {
      player: item.controller,
      prompt: {
        kind: "chooseTargets",
        chainIndex,
        count: ability.targeting.count,
        legal: legalTargets(state, item.controller, ability.targeting.filter),
      },
    };
  }

  return null;
}

/** Attaches any outstanding decision to the state, blocking other actions. */
function awaitDecisions(result: ActionResult): ActionResult {
  if (!result.ok) return result;

  // R320.1 — a task-raised decision outranks anything on the chain, because the
  // queue has to drain before a chain item may be finalized at all.
  if (result.state.tasks.length > 0) return result;

  const pending = nextDecision(result.state);
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

  const targets = choice.targets ?? [];
  if (targets.length !== prompt.count) return rejected("wrongTargetCount");
  if (!targets.every((id) => prompt.legal.includes(id))) {
    return rejected("invalidTarget");
  }

  return awaitDecisions({
    ok: true,
    state: {
      ...state,
      chain: state.chain.map((entry, i) =>
        i === prompt.chainIndex ? { ...entry, targets } : entry,
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
): ActionResult {
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

  const player = state.players[playerId];
  const card = state.cards[cardId];

  if (card === undefined) {
    return rejected("cardNotFound");
  }
  if (card.type !== "unit") {
    return rejected("wrongCardType");
  }

  const handIndex = player.hand.indexOf(cardId);
  if (handIndex === -1) {
    return rejected("notInHand");
  }

  const remainingPool = spend(player.runePool, card.cost, {
    kind: "playCard",
    cardType: "unit",
  });
  if (remainingPool === undefined) {
    return rejected("cannotAffordCost");
  }

  const newHand = [
    ...player.hand.slice(0, handIndex),
    ...player.hand.slice(handIndex + 1),
  ];

  return {
    ok: true,
    state: {
      ...withPlayer(state, playerId, {
        ...player,
        hand: newHand,
        runePool: remainingPool,
      }),
      permanents: {
        ...state.permanents,
        // R359.2.c — a unit enters exhausted, at the location chosen.
        [cardId]: {
          cardId,
          controller: playerId,
          exhausted: true,
          location: destination,
          damage: 0,
        },
      },
      battlefields: applyContested(state, destination, playerId),
    },
    events: [
      { type: "costPaid", playerId, cardId, cost: card.cost },
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
  if (permanent.controller !== playerId) {
    return rejected("sourceNotControlled");
  }
  // R144.2 — exhausting the unit is the cost, so it must be ready.
  if (permanent.exhausted) {
    return rejected("alreadyExhausted");
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
  // Battlefield to battlefield is only legal with Ganking.
  if (
    origin.kind === "battlefield" &&
    destination.kind === "battlefield" &&
    !card.keywords.includes("ganking")
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
): ActionResult {
  const player = state.players[playerId];
  const card = state.cards[cardId];

  if (card === undefined) return rejected("cardNotFound");
  if (card.type !== "spell") return rejected("wrongCardType");
  if (!player.hand.includes(cardId)) return rejected("notInHand");

  if (!canPlayAtThisTiming(state, playerId, card.keywords)) {
    return rejected("wrongTiming");
  }
  // R338.1 — while the chain is up, only the player holding priority may act.
  if (chainExists(state) && state.priority !== playerId) {
    return rejected("notYourPriority");
  }

  const remainingPool = spend(player.runePool, card.cost, {
    kind: "playCard",
    cardType: "spell",
  });
  if (remainingPool === undefined) return rejected("cannotAffordCost");

  // R355.8 — valid choices must exist for every target before it goes on.
  for (const targetId of targets) {
    const isOnBoard = state.permanents[targetId] !== undefined;
    const isOnChain = state.chain.some(
      (item) => item.kind === "spell" && item.cardId === targetId,
    );
    if (!isOnBoard && !isOnChain) return rejected("invalidTarget");
  }

  const handIndex = player.hand.indexOf(cardId);
  return {
    ok: true,
    state: {
      ...withPlayer(state, playerId, {
        ...player,
        hand: [
          ...player.hand.slice(0, handIndex),
          ...player.hand.slice(handIndex + 1),
        ],
        runePool: remainingPool,
      }),
      chain: [
        ...state.chain,
        { kind: "spell" as const, cardId, controller: playerId, targets },
      ],
      // R337.4 — the controller of the newest item receives priority; the
      // chain only resolves once both players pass in sequence (R339).
      priority: playerId,
      priorityPasses: 0,
    },
    events: [
      { type: "costPaid", playerId, cardId, cost: card.cost },
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
    const ability = card.abilities[
      item.kind === "trigger" ? item.abilityIndex : 0
    ];
    const effect = ability?.effect ?? { op: "seq" as const, steps: [] };

    const sourceLocation = sourceLocationOf(current, item);

    const outcome = execute(current, effect, {
      controller: item.controller,
      sourceId,
      targets: item.targets,
      ...(sourceLocation !== undefined ? { sourceLocation } : {}),
    });
    current = outcome.state;
    events.push(...outcome.events);

    if (item.kind === "spell") {
      // R359.3.d — a resolved spell goes to its owner's trash. A triggered
      // ability has no card to move; its source stays where it is.
      current = withPlayer(current, item.controller, {
        ...current.players[item.controller],
        trash: [...current.players[item.controller].trash, item.cardId],
      });
      events.push({
        type: "spellResolved",
        playerId: item.controller,
        cardId: item.cardId,
      });
    } else {
      events.push({
        type: "triggerResolved",
        playerId: item.controller,
        cardId: sourceId,
      });
    }
  }

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

  const progress = runEndTurn(state);
  return { ok: true, state: progress.state, events: progress.events };
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
    state.permanents[sourceId]?.controller === playerId
  );
}

export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  sourceId: CardId,
  abilityIndex: number,
): ActionResult {
  const card = state.cards[sourceId];
  if (card === undefined) {
    return rejected("cardNotFound");
  }

  const ability = card.abilities[abilityIndex];
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

  const context: EffectContext = { controller: playerId, sourceId, targets: [] };

  let current = state;
  const events: GameEvent[] = [];
  for (const cost of ability.costs) {
    const paid = payAbilityCost(current, cost, context);
    if (paid === undefined) {
      return rejected("cannotPayAbilityCost");
    }
    current = paid.state;
    events.push(...paid.events);
  }

  const outcome = execute(current, ability.effect, context);

  return {
    ok: true,
    state: outcome.state,
    events: [...events, ...outcome.events],
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
        ),
      );
    case "standardMove":
      return thenCleanup(
        standardMove(state, action.playerId, action.cardId, action.destination),
      );
    case "passFocus":
      return passFocus(state, action.playerId);
    case "passPriority":
      return passPriority(state, action.playerId);
    case "decide":
      return decide(state, action.playerId, {
        ...(action.targets !== undefined ? { targets: action.targets } : {}),
        ...(action.perform !== undefined ? { perform: action.perform } : {}),
      });
    case "playSpell":
      return thenCleanup(
        playSpell(state, action.playerId, action.cardId, action.targets),
      );
    case "endTurn":
      return thenCleanup(endTurn(state, action.playerId));
    case "activateAbility":
      return thenCleanup(activateAbility(
        state,
        action.playerId,
        action.sourceId,
        action.abilityIndex,
      ));
    default: {
      const unhandled: never = action;
      return rejected("cardNotFound");
    }
  }
}
