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

/**
 * What a bucket of resources may be spent on. Several cards add resources with
 * a usage restriction — Lux, Crownguard adds Energy "only to play spells".
 *
 * Only the card-type restriction is modelled so far. Others exist and need the
 * ability system first: Scorn of the Moon restricts by timing ("only during
 * showdowns"), and Butcher of the Sands restricts by a compound of card type
 * and ability source ("units or activated abilities of units").
 */
export type PaymentRestriction = { kind: "onlyCardType"; cardType: CardType };

/** What the resources are being spent on, checked against a bucket's restriction. */
export type PaymentPurpose =
  | { kind: "playCard"; cardType: CardType }
  | { kind: "activateAbility" };

/**
 * A pool of resources sharing one restriction. `universalPower` is Power that
 * satisfies a requirement of any domain (R163.2.b — the community calls it
 * Wild Power). A null restriction means the bucket can be spent on anything.
 */
export interface ResourceBucket {
  restriction: PaymentRestriction | null;
  energy: number;
  power: PowerCount;
  universalPower: number;
}

export interface RunePool {
  buckets: ResourceBucket[];
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
