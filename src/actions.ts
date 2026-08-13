import { execute } from "./abilities.js";
import type { AbilityCost, EffectContext } from "./abilities.js";
import { spend } from "./cost.js";
import type { GameEvent } from "./events.js";
import type { CardId, GameState, PlayerId, PlayerState } from "./state.js";

export type Action =
  | { type: "drawCard"; playerId: PlayerId }
  | { type: "playUnitFromHand"; playerId: PlayerId; cardId: CardId }
  | { type: "channelRune"; playerId: PlayerId }
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
  | "abilityNotFound"
  | "sourceNotControlled"
  | "cannotPayAbilityCost";

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectionReason };

function rejected(reason: RejectionReason): ActionResult {
  return { ok: false, reason };
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
): ActionResult {
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
        base: [...player.base, cardId],
        runePool: remainingPool,
      }),
      permanents: {
        ...state.permanents,
        [cardId]: { cardId, exhausted: true },
      },
    },
    events: [
      { type: "costPaid", playerId, cardId, cost: card.cost },
      { type: "unitPlayed", playerId, cardId },
    ],
  };
}

export function channelRune(
  state: GameState,
  playerId: PlayerId,
): ActionResult {
  const player = state.players[playerId];
  const [runeId, ...remainingDeck] = player.runeDeck;

  if (runeId === undefined) {
    return rejected("runeDeckEmpty");
  }

  const card = state.cards[runeId];
  if (card === undefined || card.domain === undefined) {
    return rejected("cardNotFound");
  }

  return {
    ok: true,
    state: {
      ...withPlayer(state, playerId, {
        ...player,
        runeDeck: remainingDeck,
        runes: [...player.runes, runeId],
      }),
      runes: {
        ...state.runes,
        [runeId]: { cardId: runeId, domain: card.domain, exhausted: false },
      },
    },
    events: [{ type: "runeChanneled", playerId, cardId: runeId }],
  };
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
  return player.runes.includes(sourceId) || player.base.includes(sourceId);
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

  const context: EffectContext = { controller: playerId, sourceId };

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
  switch (action.type) {
    case "drawCard":
      return drawCard(state, action.playerId);
    case "playUnitFromHand":
      return playUnitFromHand(state, action.playerId, action.cardId);
    case "channelRune":
      return channelRune(state, action.playerId);
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
