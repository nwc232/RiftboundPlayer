import type { GameEvent } from "./events.js";
import type { CardId, GameState, PlayerId } from "./state.js";

export type Action =
  | { type: "drawCard"; playerId: PlayerId }
  | { type: "playUnitFromHand"; playerId: PlayerId; cardId: CardId };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

function nothingHappened(state: GameState): ActionResult {
  return { state, events: [] };
}

export function drawCard(state: GameState, playerId: PlayerId): ActionResult {
  const player = state.players[playerId];
  const [drawnId, ...remainingDeck] = player.mainDeck;

  if (drawnId === undefined) {
    return nothingHappened(state);
  }

  return {
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

  if (card === undefined || card.type !== "unit") {
    return nothingHappened(state);
  }

  const handIndex = player.hand.indexOf(cardId);
  if (handIndex === -1) {
    return nothingHappened(state);
  }

  const newHand = [
    ...player.hand.slice(0, handIndex),
    ...player.hand.slice(handIndex + 1),
  ];

  return {
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
      return nothingHappened(state);
    }
  }
}
