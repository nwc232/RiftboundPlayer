import type { Ability } from "./abilities.js";
import type { ShowdownState } from "./showdown.js";
import type { TurnState } from "./turn.js";

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
  abilities: Ability[];
  keywords: Keyword[];
  /** Units only. Absent elsewhere; treated as 0. */
  might?: number;
}

export interface RuneState {
  cardId: CardId;
  domain: Domain;
  exhausted: boolean;
}

/** Keywords the engine actually checks. Others exist; they get added as needed. */
export type Keyword = "ganking" | "tank" | "backline";

/** R198 — the places permanents can be: each player's base, and each battlefield. */
export type Location =
  | { kind: "base"; player: PlayerId }
  | { kind: "battlefield"; id: CardId };

export function sameLocation(a: Location, b: Location): boolean {
  if (a.kind === "base" && b.kind === "base") return a.player === b.player;
  if (a.kind === "battlefield" && b.kind === "battlefield") return a.id === b.id;
  return false;
}

/**
 * R190 — control is binary and belongs to at most one player. Contested is a
 * temporary status applied when a unit arrives whose controller doesn't already
 * control the battlefield (R190.3.a).
 */
export interface BattlefieldState {
  cardId: CardId;
  controller: PlayerId | null;
  /** Who applied Contested — they gain Focus (R345) and are the Attacker (R464.2.c.1). */
  contestedBy: PlayerId | null;
}

/** Runtime state a card only has once it's a permanent on the board — doesn't exist while the card is in hand/deck. */
export interface PermanentState {
  cardId: CardId;
  controller: PlayerId;
  exhausted: boolean;
  location: Location;
  /** R142 — marked damage, cleared by healing. Lethal at or above Might. */
  damage: number;
}

export interface PlayerState {
  id: PlayerId;
  /** Index 0 is the top of the deck (the next card drawn). */
  mainDeck: CardId[];
  hand: CardId[];
  trash: CardId[];
  /** Index 0 is the top of the rune deck (the next rune channeled). */
  runeDeck: CardId[];
  /** Runes on the board, in the order they were channeled (oldest first). */
  runes: CardId[];
  runePool: RunePool;
  points: number;
  /** R470 — a battlefield may only be scored once per turn per player. */
  scoredThisTurn: CardId[];
}

export interface GameState {
  turn: TurnState;
  players: Record<PlayerId, PlayerState>;
  cards: Record<CardId, CardInstance>;
  permanents: Record<CardId, PermanentState>;
  runes: Record<CardId, RuneState>;
  battlefields: Record<CardId, BattlefieldState>;
  /** Battlefields in play, in a stable display order. */
  battlefieldOrder: CardId[];
  showdown: ShowdownState | null;
  winner: PlayerId | null;
}

/** Every permanent at a location, in insertion order. */
export function permanentsAt(
  state: GameState,
  location: Location,
): PermanentState[] {
  return Object.values(state.permanents).filter((permanent) =>
    sameLocation(permanent.location, location),
  );
}

export function permanentsControlledBy(
  state: GameState,
  playerId: PlayerId,
): PermanentState[] {
  return Object.values(state.permanents).filter(
    (permanent) => permanent.controller === playerId,
  );
}
