export type PlayerId = "p1" | "p2";
export type CardId = string;
export type CardType = "unit" | "spell" | "gear" | "battlefield" | "legend" | "rune";

export interface CardInstance {
  id: CardId;
  name: string;
  type: CardType;
}

/** Runtime state a card only has once it's a permanent on the board — doesn't exist while the card is in hand/deck. */
export interface PermanentState {
  cardId: CardId;
  exhausted: boolean;
}

export interface PlayerState {
  id: PlayerId;
  /** Index 0 is the top of the deck (the next card drawn). */
  mainDeck: CardId[];
  hand: CardId[];
  base: CardId[];
}

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  cards: Record<CardId, CardInstance>;
  permanents: Record<CardId, PermanentState>;
}
