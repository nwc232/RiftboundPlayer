import { DOMAINS } from "./state.js";
import type { Cost, RunePool } from "./state.js";

export const EMPTY_POOL: RunePool = { energy: 0, power: {}, universalPower: 0 };

export const FREE: Cost = { energy: 0, power: {}, anyPower: 0 };

/**
 * Spends `cost` from `pool`, returning the remaining pool, or undefined if the
 * pool can't cover it. Energy and Power are separate currencies (R163.1/163.2):
 * Power never pays an Energy cost.
 */
export function spend(pool: RunePool, cost: Cost): RunePool | undefined {
  if (pool.energy < cost.energy) {
    return undefined;
  }

  const power: Record<string, number> = { ...pool.power };
  let universal = pool.universalPower;

  // Domain-specific requirements: prefer matching Power, fall back to universal.
  // Spending matching Power first is never worse, since universal Power can pay
  // for strictly more things than domain Power can.
  for (const domain of DOMAINS) {
    const need = cost.power[domain] ?? 0;
    if (need === 0) continue;

    const have = power[domain] ?? 0;
    if (have >= need) {
      power[domain] = have - need;
      continue;
    }

    const shortfall = need - have;
    if (universal < shortfall) {
      return undefined;
    }
    power[domain] = 0;
    universal -= shortfall;
  }

  // [A] requirements: any leftover Power will do, so spend domain Power first
  // and keep the more flexible universal Power for later costs.
  let anyRemaining = cost.anyPower;
  for (const domain of DOMAINS) {
    if (anyRemaining === 0) break;
    const have = power[domain] ?? 0;
    const spent = Math.min(have, anyRemaining);
    power[domain] = have - spent;
    anyRemaining -= spent;
  }

  if (anyRemaining > universal) {
    return undefined;
  }

  return {
    energy: pool.energy - cost.energy,
    power,
    universalPower: universal - anyRemaining,
  };
}

export function canPay(pool: RunePool, cost: Cost): boolean {
  return spend(pool, cost) !== undefined;
}
