import { execute } from "./abilities.js";
import type { AbilityCost, Effect, EffectContext } from "./abilities.js";
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
import { chainExists, newestItem } from "./chain.js";
import { passFocus as runPassFocus, runCleanup } from "./showdown.js";
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
  | "invalidTarget";

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectionReason };

function rejected(reason: RejectionReason): ActionResult {
  return { ok: false, reason };
}

/** R453 — a cleanup runs when a move (or any board change) completes. */
function thenCleanup(result: ActionResult): ActionResult {
  if (!result.ok) return result;
  const cleaned = runCleanup(result.state);
  return {
    ok: true,
    state: cleaned.state,
    events: [...result.events, ...cleaned.events],
  };
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

  const remainingPool = spend(player.runePool, card.cost, {
    kind: "playCard",
    cardType: "spell",
  });
  if (remainingPool === undefined) return rejected("cannotAffordCost");

  // R355.8 — valid choices must exist for every target before it goes on.
  for (const targetId of targets) {
    const isOnBoard = state.permanents[targetId] !== undefined;
    const isOnChain = state.chain.some((item) => item.cardId === targetId);
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
      chain: [...state.chain, { cardId, controller: playerId, targets }],
      // R337.4 — the opponent gets the chance to respond.
      priority: playerId === "p1" ? "p2" : "p1",
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

  // The first pass hands priority over; the second resolves the top item.
  if (state.priority !== state.chain[state.chain.length - 1]?.controller) {
    return {
      ok: true,
      state: { ...state, priority: opponent },
      events,
    };
  }

  const item = newestItem(state);
  if (item === undefined) return rejected("noShowdown");

  const card = state.cards[item.cardId];
  let current: GameState = {
    ...state,
    chain: state.chain.slice(0, -1),
  };

  // R359.3.d — execute the spell, then it goes to its owner's trash.
  if (card !== undefined) {
    const outcome = execute(current, spellEffectOf(card), {
      controller: item.controller,
      sourceId: item.cardId,
      targets: item.targets,
    });
    current = outcome.state;
    events.push(...outcome.events);
    current = withPlayer(current, item.controller, {
      ...current.players[item.controller],
      trash: [...current.players[item.controller].trash, item.cardId],
    });
    events.push({
      type: "spellResolved",
      playerId: item.controller,
      cardId: item.cardId,
    });
  }

  // R340.2/340.4 — an empty chain reopens the state; otherwise the controller
  // of the new top item receives priority.
  const stillUp = current.chain.length > 0;
  current = {
    ...current,
    priority: stillUp
      ? (current.chain[current.chain.length - 1]?.controller ?? null)
      : null,
  };

  return thenCleanup({ ok: true, state: current, events });
}

/** A spell's rules text is its single ability's effect. */
function spellEffectOf(card: { abilities: { effect: Effect }[] }): Effect {
  return card.abilities[0]?.effect ?? { op: "seq", steps: [] };
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
  if (ability === undefined) {
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

  switch (action.type) {
    case "drawCard":
      return drawCard(state, action.playerId);
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
    case "playSpell":
      return playSpell(
        state,
        action.playerId,
        action.cardId,
        action.targets,
      );
    case "endTurn":
      return endTurn(state, action.playerId);
    case "activateAbility":
      return activateAbility(
        state,
        action.playerId,
        action.sourceId,
        action.abilityIndex,
      );
    default: {
      const unhandled: never = action;
      return rejected("cardNotFound");
    }
  }
}
