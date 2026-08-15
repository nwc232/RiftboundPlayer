import type {
  AbilityCost,
  AbilityTiming,
  ActivatedAbility,
  Effect,
} from "./abilities.js";
import { FREE } from "./cost.js";
import type { CardInstance, Domain } from "./state.js";

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
