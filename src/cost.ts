import { DOMAINS } from "./state.js";
import type {
  Cost,
  Domain,
  PaymentPurpose,
  PaymentRestriction,
  PowerCount,
  ResourceBucket,
  RunePool,
} from "./state.js";

export const EMPTY_POOL: RunePool = { buckets: [] };

export const FREE: Cost = { energy: 0, power: {}, anyPower: 0 };

export function allows(
  restriction: PaymentRestriction | null,
  purpose: PaymentPurpose,
): boolean {
  if (restriction === null) {
    return true;
  }
  return (
    purpose.kind === "playCard" && purpose.cardType === restriction.cardType
  );
}

function sameRestriction(
  a: PaymentRestriction | null,
  b: PaymentRestriction | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.kind === b.kind && a.cardType === b.cardType;
}

/** Adds resources to the bucket with a matching restriction, creating one if needed. */
function addToBucket(
  pool: RunePool,
  restriction: PaymentRestriction | null,
  add: (bucket: ResourceBucket) => ResourceBucket,
): RunePool {
  const index = pool.buckets.findIndex((bucket) =>
    sameRestriction(bucket.restriction, restriction),
  );

  if (index === -1) {
    const fresh: ResourceBucket = {
      restriction,
      energy: 0,
      power: {},
      universalPower: 0,
    };
    return { buckets: [...pool.buckets, add(fresh)] };
  }

  return {
    buckets: pool.buckets.map((bucket, i) =>
      i === index ? add(bucket) : bucket,
    ),
  };
}

/**
 * Two costs summed component-wise. R356.2 stacks additional costs onto a base
 * cost this way, and a compound ability cost ("[1][Fury], exhaust me") is the
 * same sum.
 */
export function addCosts(a: Cost, b: Cost): Cost {
  const power: PowerCount = { ...a.power };
  for (const [domain, amount] of Object.entries(b.power)) {
    const key = domain as keyof PowerCount;
    power[key] = (power[key] ?? 0) + amount;
  }
  return {
    energy: a.energy + b.energy,
    power,
    anyPower: a.anyPower + b.anyPower,
  };
}

export function addEnergy(
  pool: RunePool,
  amount: number,
  restriction: PaymentRestriction | null = null,
): RunePool {
  return addToBucket(pool, restriction, (bucket) => ({
    ...bucket,
    energy: bucket.energy + amount,
  }));
}

export function addPower(
  pool: RunePool,
  domain: Domain,
  amount: number,
  restriction: PaymentRestriction | null = null,
): RunePool {
  return addToBucket(pool, restriction, (bucket) => ({
    ...bucket,
    power: { ...bucket.power, [domain]: (bucket.power[domain] ?? 0) + amount },
  }));
}

export function addUniversalPower(
  pool: RunePool,
  amount: number,
  restriction: PaymentRestriction | null = null,
): RunePool {
  return addToBucket(pool, restriction, (bucket) => ({
    ...bucket,
    universalPower: bucket.universalPower + amount,
  }));
}

/** Aggregate across every bucket, ignoring restrictions — for display and tests. */
export function totals(pool: RunePool): {
  energy: number;
  power: PowerCount;
  universalPower: number;
} {
  const power: Record<string, number> = {};
  let energy = 0;
  let universalPower = 0;

  for (const bucket of pool.buckets) {
    energy += bucket.energy;
    universalPower += bucket.universalPower;
    for (const domain of DOMAINS) {
      const held = bucket.power[domain] ?? 0;
      if (held > 0) {
        power[domain] = (power[domain] ?? 0) + held;
      }
    }
  }

  return { energy, power, universalPower };
}

interface WorkingBucket {
  restriction: PaymentRestriction | null;
  eligible: boolean;
  energy: number;
  power: Record<string, number>;
  universalPower: number;
}

/**
 * Spends `cost` from `pool` for `purpose`, returning the remaining pool, or
 * undefined if it can't be covered.
 *
 * Energy and Power are separate currencies (R163.1/163.2) — Power never pays an
 * Energy cost. Spending is greedy along two axes, both for the same reason:
 * always spend the least flexible resource that will do the job, so the more
 * flexible ones survive for later costs.
 */
export function spend(
  pool: RunePool,
  cost: Cost,
  purpose: PaymentPurpose,
): RunePool | undefined {
  const working: WorkingBucket[] = pool.buckets.map((bucket) => ({
    restriction: bucket.restriction,
    eligible: allows(bucket.restriction, purpose),
    energy: bucket.energy,
    power: { ...bucket.power },
    universalPower: bucket.universalPower,
  }));

  // Restricted buckets first: they're spendable on less, so holding them back
  // tends to waste them.
  const spendable = working
    .filter((bucket) => bucket.eligible)
    .sort(
      (a, b) =>
        Number(b.restriction !== null) - Number(a.restriction !== null),
    );

  let energyOwed = cost.energy;
  for (const bucket of spendable) {
    if (energyOwed === 0) break;
    const taken = Math.min(bucket.energy, energyOwed);
    bucket.energy -= taken;
    energyOwed -= taken;
  }
  if (energyOwed > 0) {
    return undefined;
  }

  // Domain requirements: matching Power first, universal Power only for the gap.
  for (const domain of DOMAINS) {
    let owed = cost.power[domain] ?? 0;
    if (owed === 0) continue;

    for (const bucket of spendable) {
      if (owed === 0) break;
      const taken = Math.min(bucket.power[domain] ?? 0, owed);
      bucket.power[domain] = (bucket.power[domain] ?? 0) - taken;
      owed -= taken;
    }
    for (const bucket of spendable) {
      if (owed === 0) break;
      const taken = Math.min(bucket.universalPower, owed);
      bucket.universalPower -= taken;
      owed -= taken;
    }

    if (owed > 0) {
      return undefined;
    }
  }

  // [A] requirements accept anything, so drain plain domain Power before
  // touching universal Power.
  let anyOwed = cost.anyPower;
  for (const bucket of spendable) {
    for (const domain of DOMAINS) {
      if (anyOwed === 0) break;
      const taken = Math.min(bucket.power[domain] ?? 0, anyOwed);
      bucket.power[domain] = (bucket.power[domain] ?? 0) - taken;
      anyOwed -= taken;
    }
  }
  for (const bucket of spendable) {
    if (anyOwed === 0) break;
    const taken = Math.min(bucket.universalPower, anyOwed);
    bucket.universalPower -= taken;
    anyOwed -= taken;
  }
  if (anyOwed > 0) {
    return undefined;
  }

  return {
    buckets: working.map((bucket) => ({
      restriction: bucket.restriction,
      energy: bucket.energy,
      power: bucket.power,
      universalPower: bucket.universalPower,
    })),
  };
}

export function canPay(
  pool: RunePool,
  cost: Cost,
  purpose: PaymentPurpose,
): boolean {
  return spend(pool, cost, purpose) !== undefined;
}
