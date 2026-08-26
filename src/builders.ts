import type {
  AbilityCost,
  AbilityTiming,
  ActivatedAbility,
  AdditionalCostAbility,
  Effect,
  CostModifierAbility,
  PassiveAbility,
  PlayPermissionAbility,
} from "./abilities.js";
import type { PlayPermission } from "./play.js";
import type {
  DelayedTiming,
  Duration,
  Modification,
  PassiveCondition,
  PassiveScope,
} from "./layers.js";
import type { Condition } from "./conditions.js";
import { FREE } from "./cost.js";
import type { TokenKind } from "./tokens.js";
import type {
  CardInstance,
  Cost,
  Domain,
  Keyword,
  PlaySource,
} from "./state.js";

// Effects. Each of these builds data and does nothing else — addEnergy(1)
// returns { op: "addEnergy", amount: 1 }, it does not add any energy.

export function addEnergy(amount: number): Effect {
  return { op: "addEnergy", amount };
}

export function addPower(
  domain: Domain | "selfDomain",
  amount: number,
): Effect {
  return { op: "addPower", domain, amount };
}

export function seq(...steps: Effect[]): Effect {
  return { op: "seq", steps };
}

// Costs.

export const exhaustSelf: AbilityCost = { kind: "exhaustSelf" };
export const recycleSelf: AbilityCost = { kind: "recycleSelf" };

// Abilities.

export function activated(
  costs: AbilityCost[],
  effect: Effect,
  timing: AbilityTiming = "default",
): ActivatedAbility {
  return { kind: "activated", timing, costs, effect };
}

export function dealDamage(amount: number, targetIndex = 0): Effect {
  return { op: "dealDamage", amount, targetIndex };
}

export function draw(count: number): Effect {
  return { op: "draw", count };
}

export function counterSpell(targetIndex = 0): Effect {
  return { op: "counterSpell", targetIndex };
}

/**
 * R432.1 — "give a unit +N Might this turn". `min`/`max` are R477.3.b's
 * limitation, applied and remembered once: Ahri, Inquisitive's "-2 Might this
 * turn, to a minimum of 1" is `modifyMight(-2, "thisTurn", { min: 1 })`.
 */
export function modifyMight(
  amount: number,
  duration: Duration,
  limits: { min?: number; max?: number } = {},
  targetIndex = 0,
): Effect {
  return {
    op: "modifyMight",
    amount,
    duration,
    targetIndex,
    ...(limits.min !== undefined ? { min: limits.min } : {}),
    ...(limits.max !== undefined ? { max: limits.max } : {}),
  };
}

/** Last Stand — "Double a friendly unit's Might this turn." (R432.1.a) */
export function doubleMight(duration: Duration, targetIndex = 0): Effect {
  return { op: "modifyMight", double: true, duration, targetIndex };
}

/** Fortified Position — "It gains [Shield 2] this combat." */
export function grantKeywordFor(
  keyword: Keyword,
  duration: Duration,
  value?: number,
  targetIndex = 0,
): Effect {
  return {
    op: "grantKeywordFor",
    keyword,
    duration,
    targetIndex,
    ...(value !== undefined ? { value } : {}),
  };
}

/**
 * R180/R184 — "Play two 3 [M] Mech unit tokens to your base" (Ferrous
 * Forerunner) is `createToken("mech", 2)`. Units enter exhausted by default
 * (R185.2.d); `ready` is R184.1's override.
 */
export function createToken(
  token: TokenKind,
  count = 1,
  options: {
    ready?: true;
    to?: "base" | "sourceLocation";
    copyOfTarget?: number;
    grants?: Keyword[];
  } = {},
): Effect {
  return {
    op: "createToken",
    token,
    count,
    ...(options.ready !== undefined ? { ready: options.ready } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
    ...(options.copyOfTarget !== undefined
      ? { copyOfTarget: options.copyOfTarget }
      : {}),
    ...(options.grants !== undefined ? { grants: options.grants } : {}),
  };
}

/** Possession — "Take control of it and recall it." */
export function takeControl(
  duration: Duration,
  options: { recall?: true } = {},
  targetIndex = 0,
): Effect {
  return {
    op: "takeControl",
    duration,
    targetIndex,
    ...(options.recall !== undefined ? { recall: options.recall } : {}),
  };
}

/** R317.1.a — "…at end of turn", scheduling an effect rather than a duration. */
export function delay(at: DelayedTiming, effect: Effect): Effect {
  return { op: "delay", at, effect };
}

/** R454 — send a unit to its controller's base. Not a move, so it contests nothing. */
export function recall(targetIndex = 0): Effect {
  return { op: "recall", targetIndex };
}

/** Gust, Rebuke — "Return a unit … to its owner's hand." */
export function returnToHand(targetIndex = 0): Effect {
  return { op: "returnToHand", targetIndex };
}

/** R427 — Thrill of the Hunt's "Banish a friendly unit". */
export function banish(targetIndex = 0): Effect {
  return { op: "banish", targetIndex };
}

/** R415 — First Mate's "ready another unit". */
export function ready(targetIndex = 0): Effect {
  return { op: "ready", targetIndex };
}

/** R426 — Pit Rookie's "buff another friendly unit". */
export function buff(targetIndex = 0): Effect {
  return { op: "buff", targetIndex };
}

/** R423 — Back Off's "[Stun] a unit". */
export function stun(targetIndex = 0): Effect {
  return { op: "stun", targetIndex };
}

/** R730.1 — Kha'Zix, Mutating Horror's "gain 2 XP". */
export function gainXP(amount: number): Effect {
  return { op: "gainXP", amount };
}

/** R433 — Switcheroo's "Swap the Might of two units at the same battlefield". */
export function swapMight(
  duration: Duration,
  targetIndex = 0,
  otherIndex = 1,
): Effect {
  return { op: "swapMight", duration, targetIndex, otherIndex };
}

/** Tideturner — "Move me to its location and it to my original location." */
export function swapLocations(targetIndex = 0): Effect {
  return { op: "swapLocations", targetIndex };
}

/** Rampage — "They deal damage equal to their Mights to each other." */
export function mutualDamage(targetIndex = 0, otherIndex = 1): Effect {
  return { op: "mutualDamage", targetIndex, otherIndex };
}

/** Targon's Peak — "ready 2 runes at the end of this turn". */
export function readyRunes(count: number): Effect {
  return { op: "readyRunes", count };
}

/** Seat of Power — "draw 1 for each other battlefield you or allies control". */
export function drawPerBattlefield(options: { excludeSource?: true } = {}): Effect {
  return {
    op: "drawPerBattlefield",
    ...(options.excludeSource !== undefined
      ? { excludeSource: options.excludeSource }
      : {}),
  };
}

/** Threshold of the Gray — "the attacker and defender each [Add] [1]". */
export function addEnergyToEach(amount: number): Effect {
  return { op: "addEnergyToEach", amount };
}

/** Vex, Apathetic — "They can't move it this turn." */
export function restrictMovement(duration: Duration, targetIndex = 0): Effect {
  return { op: "restrictMovement", duration, targetIndex };
}

/** Thrill of the Hunt — "Banish a friendly unit, then its owner plays it…". */
export function banishThenPlay(targetIndex = 0, destinationIndex = 1): Effect {
  return { op: "banishThenPlay", targetIndex, destinationIndex };
}

/** R818.1.c.2 — "[Cost]: Attach this gear to a unit you control." */
export function attachSelf(targetIndex = 0): Effect {
  return { op: "attachSelf", targetIndex };
}

/** Stacked Deck — "Look at the top 3 … Put 1 into your hand and recycle the rest." */
export function lookAtTop(count: number, keep: number): Effect {
  return { op: "lookAtTop", count, keep };
}

/** Sabotage — "Choose a non-unit card from it, and recycle that card." */
export function recycleFromOpponentHand(exclude?: "unit"): Effect {
  return {
    op: "recycleFromOpponentHand",
    ...(exclude !== undefined ? { exclude } : {}),
  };
}

/** R420 — Irresistible Faefolk's "move an enemy unit to that battlefield". */
export function moveUnit(
  to: "sourceLocation" | "base" = "sourceLocation",
  targetIndex = 0,
): Effect {
  return { op: "moveUnit", targetIndex, to };
}

/**
 * R355.2.b / R822.1.d — rules text widening where a unit may be played.
 * [Ambush] itself is a keyword, not this: R822.4 makes having it a
 * characteristic other cards check.
 */
export function playPermission(
  permission: PlayPermission,
): PlayPermissionAbility {
  return { kind: "playPermission", permission };
}

/** Rengar, Trophy Hunter — "I can be played to a battlefield where there are enemy units." */
export const ambushEnemyBattlefields = playPermission({
  kind: "whereEnemyUnits",
});

// Conditions (R383.2.a.1). `ifThen` is the effect-level form — the conditional
// statement that sits *after* the instruction. The trigger-level form is a
// `requires` on the ability itself, not a builder.

export function ifThen(
  test: Condition,
  then: Effect,
  otherwise?: Effect,
): Effect {
  return {
    op: "conditional",
    test,
    then,
    ...(otherwise !== undefined ? { otherwise } : {}),
  };
}

/**
 * R812 — Noxus Hopeful's "[Legion] — I cost [2] less." The keyword is
 * shorthand for the condition, so the builder takes the reduction and supplies
 * it (R812.1.b.1).
 */
export function legionCostReduction(reduce: Partial<Cost>): CostModifierAbility {
  return { kind: "costModifier", reduce, when: { kind: "legion" } };
}

/**
 * R356.2.b — Pyke, Dockside Butcher's "You may pay [Fury] as an additional
 * cost to play me". Omit `optional` for R356.2.a's mandatory kind.
 */
export function additionalCost(
  cost: Cost,
  optional: true | undefined = true,
): AdditionalCostAbility {
  return { kind: "additionalCost", cost, ...(optional ? { optional } : {}) };
}

/** Astral Heron — "your next card costs [2][A][A] less". */
export function discountNextCard(reduce: Cost): Effect {
  return { op: "discountNextCard", reduce };
}

/** R383.2.a.1 — a gate made of several clauses that must all be true. */
export function allOf(...of: Condition[]): Condition {
  return { kind: "all", of };
}

/** Back Off — "If you played this from your hand, draw 1." */
export function playedFrom(zone: PlaySource): Condition {
  return { kind: "playedFrom", zone };
}

/** Evelynn, Entrancing — "…on your turn". */
export const onYourTurn: Condition = { kind: "yourTurn" };

/** R205 — "if you paid the additional cost". */
export const paidAdditionalCost: Condition = { kind: "paidAdditionalCost" };

/** Vex, Apathetic — "while I'm at a battlefield". */
export const atBattlefield: Condition = { kind: "sourceAtBattlefield" };

/** Kinkou Initiate — "if your other units have total Might 5 or more". */
export function otherUnitsTotalMight(atLeast: number): Condition {
  return { kind: "totalMight", of: "otherFriendlyUnits", atLeast };
}

/**
 * En Garde — "if it is the only unit you control there"; Kha'Zix, Mutating
 * Horror — "if an enemy unit is alone here".
 */
export function aloneThere(
  subject: "source" | "target",
  units: "friendly" | "enemy",
  targetIndex?: number,
): Condition {
  return {
    kind: "aloneThere",
    subject,
    units,
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

// Passive abilities (R477). These modify characteristics rather than resolving,
// so they never touch the chain — the layer pipeline reads them live.

export function passive(
  scope: PassiveScope,
  modification: Modification,
  condition?: PassiveCondition,
): PassiveAbility {
  return {
    kind: "passive",
    scope,
    modification,
    ...(condition !== undefined ? { condition } : {}),
  };
}

/** Garen, Commander — "Other friendly units have +1 Might here." */
export function anthemMight(amount: number, here = true): PassiveAbility {
  return passive({ target: "otherFriendlyUnits", here }, {
    layer: "arithmetic",
    op: "addMight",
    amount,
  });
}

/** Captain Farron — "Other friendly units here have [Assault]." */
export function anthemKeyword(
  keyword: Keyword,
  here = true,
  value?: number,
): PassiveAbility {
  return passive({ target: "otherFriendlyUnits", here }, {
    layer: "ability",
    op: "grantKeyword",
    keyword,
    ...(value !== undefined ? { value } : {}),
  });
}

/** A spell's rules text lives as a single ability holding its effect. */
export function spell(
  id: string,
  name: string,
  cost: Cost,
  effect: Effect,
  keywords: Keyword[] = [],
): CardInstance {
  return {
    id,
    name,
    type: "spell",
    cost,
    keywords,
    abilities: [activated([], effect, "default")],
  };
}

/**
 * A basic rune (R164.2): exhaust for 1 Energy, or recycle for 1 Power of its
 * own domain. Both abilities are printed with [Reaction].
 */
export function basicRune(id: string, domain: Domain): CardInstance {
  return {
    id,
    name: `${domain} rune`,
    type: "rune",
    cost: FREE,
    domain,
    keywords: [],
    abilities: [
      activated([exhaustSelf], addEnergy(1), "reaction"),
      activated([recycleSelf], addPower("selfDomain", 1), "reaction"),
    ],
  };
}
