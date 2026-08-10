import type { CardId, Cost, Domain, PlayerId } from "./state.js";

export type GameEvent =
  | { type: "cardDrawn"; playerId: PlayerId; cardId: CardId }
  | { type: "unitPlayed"; playerId: PlayerId; cardId: CardId }
  | { type: "runeChanneled"; playerId: PlayerId; cardId: CardId }
  | { type: "runeRecycled"; playerId: PlayerId; cardId: CardId }
  | { type: "energyAdded"; playerId: PlayerId; amount: number }
  | { type: "powerAdded"; playerId: PlayerId; domain: Domain; amount: number }
  | { type: "costPaid"; playerId: PlayerId; cardId: CardId; cost: Cost };
