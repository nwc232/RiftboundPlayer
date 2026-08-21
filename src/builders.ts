import type {
  AbilityCost,
  AbilityTiming,
  ActivatedAbility,
  Effect,
  PassiveAbility,
} from "./abilities.js";
import type {
  Duration,
  Modification,
  PassiveCondition,
  PassiveScope,
} from "./layers.js";
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
