import type {
  AbilityCost,
  AbilityTiming,
  ActivatedAbility,
  Effect,
  PassiveAbility,
} from "./abilities.js";
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
import type { CardInstance, Cost, Domain, Keyword } from "./state.js";

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

/** R420 — Irresistible Faefolk's "move an enemy unit to that battlefield". */
export function moveUnit(
  to: "sourceLocation" | "base" = "sourceLocation",
  targetIndex = 0,
): Effect {
  return { op: "moveUnit", targetIndex, to };
}

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
