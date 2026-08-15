import type { CardId, Cost, Domain, Location, PlayerId } from "./state.js";
import type { Phase } from "./turn.js";

export type GameEvent =
  | { type: "cardDrawn"; playerId: PlayerId; cardId: CardId }
  | { type: "unitPlayed"; playerId: PlayerId; cardId: CardId }
  | { type: "runeChanneled"; playerId: PlayerId; cardId: CardId }
  | { type: "runeRecycled"; playerId: PlayerId; cardId: CardId }
  | { type: "energyAdded"; playerId: PlayerId; amount: number }
  | { type: "powerAdded"; playerId: PlayerId; domain: Domain; amount: number }
  | { type: "costPaid"; playerId: PlayerId; cardId: CardId; cost: Cost }
  | { type: "turnBegan"; playerId: PlayerId; turn: number }
  | { type: "phaseBegan"; playerId: PlayerId; phase: Phase }
  | { type: "objectReadied"; playerId: PlayerId; cardId: CardId }
  | { type: "poolEmptied"; playerId: PlayerId }
  | {
      type: "unitMoved";
      playerId: PlayerId;
      cardId: CardId;
      from: Location;
      to: Location;
    };
