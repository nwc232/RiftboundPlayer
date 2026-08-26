import type { Ability } from "./abilities.js";
import { controllerOf } from "./layers.js";
import type { ChainItem } from "./chain.js";
import type { PendingDecision } from "./decisions.js";
import type { ShowdownState } from "./showdown.js";
import type { DelayedEffect, Modifier } from "./layers.js";
import type { Task } from "./tasks.js";
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
  | { kind: "activateAbility" }
  /** R421.2 — Hide is a Discretionary Action, neither playing nor activating. */
  | { kind: "hide" };

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
  /**
   * R807.1.b / R814.1.b — the X in "Assault [X]" / "Shield [X]". Only read when
   * the matching keyword is present; a bare [Assault] is worth 1.
   */
  assault?: number;
  shield?: number;
  /**
   * R185.1 — "token" is an intrinsic category: a token can never stop being
   * one, and a card can never become one. R186.1 is what it buys us — a token
   * leaving the board ceases to exist rather than going to a trash.
   */
  isToken?: true;
}

export interface RuneState {
  cardId: CardId;
  domain: Domain;
  exhausted: boolean;
}

/** Keywords the engine actually checks. Others exist; they get added as needed. */
/**
 * Keywords the engine checks. [Action] and [Reaction] are genuine keywords
 * (R806, R813) rather than a separate timing field.
 */
export type Keyword =
  | "ganking"
  | "tank"
  | "backline"
  | "action"
  | "reaction"
  /** R807 / R814 — passive keywords carrying a value; see `Characteristics`. */
  | "assault"
  | "shield"
  /** R816 — "at the start of my controller's Beginning Phase, kill this." */
  | "temporary"
  /**
   * R822 — a play permission plus a timing grant, not a combat keyword.
   * R822.4 makes having it a characteristic other cards can check, which is
   * why it lives here rather than as a bare ability.
   */
  | "ambush"
  /**
   * R811 — the prerequisite for the Hide action (R421), plus [Reaction] and a
   * free play once the card is facedown. R811.5.a: having the keyword is
   * independent of actually being facedown.
   */
  | "hidden";

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

/** R464.2.c.3 — which side of a combat a unit is on. */
export type Designation = "attacker" | "defender";

/** Runtime state a card only has once it's a permanent on the board — doesn't exist while the card is in hand/deck. */
export interface PermanentState {
  cardId: CardId;
  controller: PlayerId;
  /**
   * R56 — a killed card goes to its *owner's* trash, which is not always its
   * controller. R183 defines a token's owner as whoever controlled the effect
   * that created it. Absent means owner and controller are the same.
   */
  owner?: PlayerId;
  exhausted: boolean;
  location: Location;
  /** R142 — marked damage, cleared by healing. Lethal at or above Might. */
  damage: number;
  /**
   * R323.2 — Attacker/Defender, assigned while a combat is in progress at this
   * unit's battlefield and removed when combat ends (R466.7.a). Assault and
   * Shield key off this rather than off "is a combat happening".
   */
  designation?: Designation;
  /**
   * R426.1.b / R702.3 — a unit has at most one Buff counter, worth +1 Might
   * (R703). Buffing an already-buffed unit does nothing at all (R426.1.c).
   */
  buffed?: true;
  /**
   * R423 — binary, and cleared in the end-of-turn cleanup (R423.1.a.2). A
   * stunned unit contributes no Might to combat damage (R423.1.b) but still
   * needs its full Might in damage to die (R423.1.c).
   */
  stunned?: true;
}

export interface PlayerState {
  id: PlayerId;
  /** Index 0 is the top of the deck (the next card drawn). */
  mainDeck: CardId[];
  hand: CardId[];
  trash: CardId[];
  /** R108.6 — removed from play in a harder-to-recover way than the trash. */
  banished: CardId[];
  /** Index 0 is the top of the rune deck (the next rune channeled). */
  runeDeck: CardId[];
  /** Runes on the board, in the order they were channeled (oldest first). */
  runes: CardId[];
  runePool: RunePool;
  points: number;
  /** R470 — a battlefield may only be scored once per turn per player. */
  scoredThisTurn: CardId[];
  /**
   * R107.4 — the Champion Legend, which cannot be removed or moved from its
   * zone (R107.4.d). Null only in hand-built test boards.
   */
  legend: CardId | null;
  /**
   * R108.3 — the Chosen Champion. It starts here and is *playable from here*
   * (R108.3.d), which makes it a permanently available extra card rather than
   * an inert marker. Null once played, or in hand-built test boards.
   */
  champion: CardId | null;
}

/**
 * R107.3 — a card in a battlefield's Facedown Zone. R421.3 makes the *effect
 * that put it there* define what may be done with it; everything here is
 * [Hidden]'s version of that (R811.1.b).
 */
export interface FacedownCard {
  cardId: CardId;
  /** R107.3.c — must also control the associated battlefield. */
  controller: PlayerId;
  /** R811.1.b — playable "beginning on the next turn", so which one this was. */
  hiddenOnTurn: number;
}

/** R107.3.b — "Each Facedown Zone has a maximum occupancy of one card." */
export const FACEDOWN_CAPACITY = 1;

export interface GameState {
  turn: TurnState;
  players: Record<PlayerId, PlayerState>;
  cards: Record<CardId, CardInstance>;
  permanents: Record<CardId, PermanentState>;
  runes: Record<CardId, RuneState>;
  battlefields: Record<CardId, BattlefieldState>;
  /** Battlefields in play, in a stable display order. */
  battlefieldOrder: CardId[];
  /**
   * R107.3 — the Facedown Zone of each battlefield, keyed by battlefield id.
   * A zone of its own rather than a field on BattlefieldState: R107.3.e says a
   * Facedown Zone is not a location, and R107.3.f makes it a public zone whose
   * contents are private.
   */
  facedown: Record<CardId, FacedownCard>;
  /**
   * R812.1.c — which cards each player has *finalized* this turn. [Legion] asks
   * whether "a card different than the one with the Legion ability has been
   * Finalized by you on the same turn", so it is the list, not a count, that
   * answers it. Cleared as each turn opens.
   */
  playedThisTurn: Record<PlayerId, CardId[]>;
  showdown: ShowdownState | null;
  winner: PlayerId | null;
  /** R327 — LIFO; last entry resolves first. Empty means an Open State. */
  chain: ChainItem[];
  /** Who may act while the chain is up. Null outside a chain. */
  priority: PlayerId | null;
  /** R339 — the chain resolves once every player has passed in sequence. */
  priorityPasses: number;
  /** A choice the engine is waiting on; blocks everything else while set. */
  pending: PendingDecision | null;
  /**
   * R319/R334 — outstanding work, drained before priority is awarded or any
   * chain item resolves. Empty whenever the game is waiting on a player.
   */
  tasks: Task[];
  /**
   * Continuous effects with a lifetime of their own, rather than ones read live
   * off a permanent. Amounts here are already snapshotted (R477.3.b).
   */
  modifiers: Modifier[];
  /** Bumped for each token created, so minted ids stay deterministic. */
  tokensCreated: number;
  /** R485.7 — the player who did *not* start channels an extra rune on turn 2. */
  startingPlayer: PlayerId;
  /**
   * R317.1.a — effects scheduled to fire at a later moment, as opposed to
   * modifiers, which merely stop applying at one.
   */
  delayed: DelayedEffect[];
}

/** R56 / R183 — where a card goes when it leaves the board. */
export function ownerOf(permanent: PermanentState): PlayerId {
  return permanent.owner ?? permanent.controller;
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
    (permanent) => controllerOf(state, permanent.cardId) === playerId,
  );
}
