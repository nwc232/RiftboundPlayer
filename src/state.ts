export type PlayerId = "p1" | "p2";
export type CardId = string;
export type CardType = "unit" | "spell" | "gear" | "battlefield" | "legend" | "rune";

export type Domain = "fury" | "calm" | "mind" | "body" | "chaos" | "order";

export const DOMAINS: readonly Domain[] = [
  "fury",
  "calm",
  "mind",
  "body",
  "chaos",
  "order",
];

export type PowerCount = Partial<Record<Domain, number>>;

/** `anyPower` is the [A] / rainbow requirement: satisfied by Power of any domain. */
export interface Cost {
  energy: number;
  power: PowerCount;
  anyPower: number;
}

/** `universalPower` is Power that can satisfy a requirement of any domain (R163.2.b). */
export interface RunePool {
  energy: number;
  power: PowerCount;
  universalPower: number;
}

export interface CardInstance {
  id: CardId;
  name: string;
  type: CardType;
  cost: Cost;
  /** Only runes carry this — the domain of Power they produce when recycled. */
  domain?: Domain;
}

export interface RuneState {
  cardId: CardId;
  domain: Domain;
  exhausted: boolean;
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
  /** Index 0 is the top of the rune deck (the next rune channeled). */
  runeDeck: CardId[];
  /** Runes on the board, in the order they were channeled (oldest first). */
  runes: CardId[];
  runePool: RunePool;
}

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  cards: Record<CardId, CardInstance>;
  permanents: Record<CardId, PermanentState>;
  runes: Record<CardId, RuneState>;
}
