import type { GameEvent } from "./events.js";
import type { CardId, GameState, PlayerId } from "./state.js";

export type Action =
  | { type: "drawCard"; playerId: PlayerId }
  | { type: "playUnitFromHand"; playerId: PlayerId; cardId: CardId };

export type RejectionReason =
  | "cardNotFound"
  | "wrongCardType"
  | "notInHand"
  | "deckEmpty";

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; reason: RejectionReason };

function rejected(reason: RejectionReason): ActionResult {
  return { ok: false, reason };
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

  const newHand = [
    ...player.hand.slice(0, handIndex),
    ...player.hand.slice(handIndex + 1),
  ];

  return {
    ok: true,
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: newHand,
          base: [...player.base, cardId],
        },
      },
      permanents: {
        ...state.permanents,
        [cardId]: { cardId, exhausted: true },
      },
    },
    events: [{ type: "unitPlayed", playerId, cardId }],
  };
}

export function applyAction(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case "drawCard":
      return drawCard(state, action.playerId);
    case "playUnitFromHand":
      return playUnitFromHand(state, action.playerId, action.cardId);
    default: {
      const unhandled: never = action;
      return rejected("cardNotFound");
    }
  }
}
