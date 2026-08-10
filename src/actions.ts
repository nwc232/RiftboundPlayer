import { spend } from "./cost.js";
import type { GameEvent } from "./events.js";
import type { CardId, GameState, PlayerId, PlayerState } from "./state.js";

export type Action =
  | { type: "drawCard"; playerId: PlayerId }
  | { type: "playUnitFromHand"; playerId: PlayerId; cardId: CardId }
  | { type: "channelRune"; playerId: PlayerId }
  | { type: "exhaustRuneForEnergy"; playerId: PlayerId; runeId: CardId }
  | { type: "recycleRuneForPower"; playerId: PlayerId; runeId: CardId };

export type RejectionReason =
  | "cardNotFound"
  | "wrongCardType"
  | "notInHand"
  | "deckEmpty"
  | "runeDeckEmpty"
  | "runeNotFound"
  | "runeNotControlled"
  | "runeAlreadyExhausted"
  | "cannotAffordCost";

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

  const remainingPool = spend(player.runePool, card.cost);
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

export function exhaustRuneForEnergy(
  state: GameState,
  playerId: PlayerId,
  runeId: CardId,
): ActionResult {
  const player = state.players[playerId];
  const rune = state.runes[runeId];

  if (rune === undefined) {
    return rejected("runeNotFound");
  }
  if (!player.runes.includes(runeId)) {
    return rejected("runeNotControlled");
  }
  if (rune.exhausted) {
    return rejected("runeAlreadyExhausted");
  }

  return {
    ok: true,
    state: {
      ...withPlayer(state, playerId, {
        ...player,
        runePool: { ...player.runePool, energy: player.runePool.energy + 1 },
      }),
      runes: { ...state.runes, [runeId]: { ...rune, exhausted: true } },
    },
    events: [{ type: "energyAdded", playerId, amount: 1 }],
  };
}

export function recycleRuneForPower(
  state: GameState,
  playerId: PlayerId,
  runeId: CardId,
): ActionResult {
  const player = state.players[playerId];
  const rune = state.runes[runeId];

  if (rune === undefined) {
    return rejected("runeNotFound");
  }
  if (!player.runes.includes(runeId)) {
    return rejected("runeNotControlled");
  }

  const pool = player.runePool;
  const held = pool.power[rune.domain] ?? 0;

  const { [runeId]: _removed, ...remainingRunes } = state.runes;

  return {
    ok: true,
    state: {
      ...withPlayer(state, playerId, {
        ...player,
        runes: player.runes.filter((id) => id !== runeId),
        runeDeck: [...player.runeDeck, runeId],
        runePool: {
          ...pool,
          power: { ...pool.power, [rune.domain]: held + 1 },
        },
      }),
      runes: remainingRunes,
    },
    events: [
      { type: "runeRecycled", playerId, cardId: runeId },
      { type: "powerAdded", playerId, domain: rune.domain, amount: 1 },
    ],
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
    case "exhaustRuneForEnergy":
      return exhaustRuneForEnergy(state, action.playerId, action.runeId);
    case "recycleRuneForPower":
      return recycleRuneForPower(state, action.playerId, action.runeId);
    default: {
      const unhandled: never = action;
      return rejected("cardNotFound");
    }
  }
}
