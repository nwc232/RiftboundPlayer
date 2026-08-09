import type { CardId, PlayerId } from "./state.js";

export type GameEvent =
  | { type: "cardDrawn"; playerId: PlayerId; cardId: CardId }
  | { type: "unitPlayed"; playerId: PlayerId; cardId: CardId };
