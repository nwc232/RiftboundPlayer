import { addCosts } from "./cost.js";
import { characteristicsOf, controllerOf, keywordsOf } from "./layers.js";
import { holds } from "./conditions.js";
import type { Condition } from "./conditions.js";
import type { CardId, Cost, GameState, PlayerId, PowerCount } from "./state.js";

/**
 * R477.3 arithmetic applied to a Cost rather than to Might. Kept out of the
 * layer pipeline on purpose: that pipeline runs over permanents, and a cost is
 * modified while the card is still in a hand, where R711 reads it as printed.
 * See ROADMAP §3b.
 */
export interface CostModifier {
  /** Subtracted component-wise, floored at zero. */
  reduce: Partial<Cost>;
  /** Absent means always. Noxus Hopeful's is `{ kind: "legion" }`. */
  when?: Condition;
}

function subtract(cost: Cost, by: Cost): Cost {
  return {
    energy: Math.max(0, cost.energy - by.energy),
    power: reducePower(cost.power, by.power),
    anyPower: Math.max(0, cost.anyPower - by.anyPower),
  };
}

/** Consumes the discount that `totalCostOf` just applied, if there was one. */
export function consumeDiscount(
  state: GameState,
  playerId: PlayerId,
): GameState {
  const index = state.pendingDiscounts.findIndex(
    (entry) => entry.player === playerId,
  );
  if (index === -1) return state;
  return {
    ...state,
    pendingDiscounts: state.pendingDiscounts.filter((_, i) => i !== index),
  };
}

function reducePower(power: PowerCount, by: PowerCount): PowerCount {
  const out: PowerCount = { ...power };
  for (const [domain, amount] of Object.entries(by)) {
    const key = domain as keyof PowerCount;
    out[key] = Math.max(0, (out[key] ?? 0) - amount);
  }
  return out;
}

/**
 * What `cardId` costs `playerId` right now. Starts from the card's current
 * cost rather than its printed one — R477.1.b.1.a lists Cost among the
 * copyable traits, so a copy pays what it copied.
 */
function applyDiscounts(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  starting: Cost,
): Cost {
  let cost = starting;

  for (const ability of state.cards[cardId]?.abilities ?? []) {
    if (ability.kind !== "costModifier") continue;
    if (
      ability.when !== undefined &&
      !holds(state, ability.when, {
        controller: playerId,
        sourceId: cardId,
        targets: [],
      })
    ) {
      continue;
    }

    const { reduce } = ability;
    cost = {
      energy: Math.max(0, cost.energy - (reduce.energy ?? 0)),
      power: reducePower(cost.power, reduce.power ?? {}),
      anyPower: Math.max(0, cost.anyPower - (reduce.anyPower ?? 0)),
    };
  }

  return cost;
}

/**
 * R356.2 — a cost added to a card's own. Mandatory ones "use the phrase 'as an
 * additional cost' and don't include the word 'may'" (R356.2.a.1); optional
 * ones do (R356.2.b.1) and are only paid if the player says so in step 2.
 */
export interface AdditionalCost {
  optional: boolean;
  cost: Cost;
}

/**
 * R135.2.e.6.c — `[C]` is "any power of that card's Domains". A single-domain
 * card resolves it to that domain; a multi-domain card would need a cost
 * component meaning "one of these", which `spend` cannot express, so it falls
 * back to `[A]`. Recorded as a deviation — it is strictly more permissive.
 */
function ownDomainPower(state: GameState, cardId: CardId, amount: number): Cost {
  const domains = state.cards[cardId]?.domains ?? [];
  const only = domains.length === 1 ? domains[0] : undefined;
  return only === undefined
    ? { energy: 0, power: {}, anyPower: amount }
    : { energy: 0, power: { [only]: amount }, anyPower: 0 };
}

/** Every additional cost attached to playing `cardId`, in no particular order. */
export function additionalCostsOf(
  state: GameState,
  cardId: CardId,
): AdditionalCost[] {
  const costs: AdditionalCost[] = [];

  // R805.1.a — [Accelerate]'s "[1][C]", read through the layers so a granted
  // keyword counts the same as a printed one.
  if (keywordsOf(state, cardId).includes("accelerate")) {
    costs.push({
      optional: true,
      cost: addCosts(
        { energy: 1, power: {}, anyPower: 0 },
        ownDomainPower(state, cardId, 1),
      ),
    });
  }

  for (const ability of state.cards[cardId]?.abilities ?? []) {
    if (ability.kind === "additionalCost") {
      costs.push({ optional: ability.optional === true, cost: ability.cost });
    }
  }

  return costs;
}

/**
 * R820.1.c — every [Repeat] cost printed on a card, in the order it prints
 * them, which is what `payRepeats` indexes into. R820.1.c.2 makes them
 * independent: Curtain Call's three are paid or not paid one at a time.
 */
export function repeatCostsOf(state: GameState, cardId: CardId): Cost[] {
  return costKeywordsOf(state, cardId, "repeat");
}

/**
 * R829.1.c — every [Flow] cost printed on a card, in printed order. R829.1.c.3:
 * "If a spell has multiple instances of the Flow keyword with different costs,
 * its controller may choose which cost to apply as they play it."
 */
export function flowCostsOf(state: GameState, cardId: CardId): Cost[] {
  return costKeywordsOf(state, cardId, "flow");
}

/**
 * Read through the layer pipeline, not off the printed card: R820.4 and R829.2
 * make these characteristics, so Syndra's "your spells have [Repeat] [2][C]"
 * has to count for as much as a printed one. R711 still applies — a card in
 * hand has no permanent, so the pipeline hands back its printed values.
 */
function costKeywordsOf(
  state: GameState,
  cardId: CardId,
  keyword: "repeat" | "flow" | "empower",
): Cost[] {
  return characteristicsOf(state, cardId)
    .costKeywords.filter((each) => each.keyword === keyword)
    .map((each) => each.cost);
}

export interface CostOptions {
  /**
   * R809.1.d — what this play chooses. Deflect imposes a Mandatory Additional
   * Cost "for each time they choose [me]", so the targets are part of pricing.
   */
  targets?: CardId[];
  /** R356.1.b — "ignoring its cost" sets the base cost to zero. */
  ignoreBaseCost?: boolean;
  /**
   * R829.1.c.1 — an Alternate Cost, which "replaces the base cost of the spell
   * to be paid during finalization". Distinct from `ignoreBaseCost`, which
   * zeroes it, and from an additional cost, which adds to it.
   */
  alternateCost?: Cost;
  /** R356.2.b.1 — whether the player chose to pay the optional additional cost. */
  payOptional?: boolean;
  /**
   * R820.1.c.2 — which of the card's [Repeat] costs this play pays, by index.
   * A list rather than a count because the costs differ from each other, and
   * R820.1.c.3 allows each at most once.
   */
  payRepeats?: number[];
}

/**
 * R356's full pipeline, in its order: base cost modifications, then additional
 * costs, then discounts. R356.1.b.3 is why the order matters — an additional
 * cost can raise a card played "ignoring its cost" back above zero.
 */
export function totalCostOf(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  options: CostOptions = {},
): Cost {
  // 1. Base cost, possibly set to zero (R356.1.b).
  let total: Cost =
    options.alternateCost !== undefined
      ? options.alternateCost
      : options.ignoreBaseCost === true
        ? { energy: 0, power: {}, anyPower: 0 }
        : characteristicsOf(state, cardId).cost;

  // 2. Additional costs (R356.2).
  for (const additional of additionalCostsOf(state, cardId)) {
    if (additional.optional && options.payOptional !== true) continue;
    total = addCosts(total, additional.cost);
  }
  // R820.1.c.1 — a Repeat cost is "an Additional Cost to be paid during the
  // steps of playing the spell", so it lands in step 2 beside the others.
  const repeats = repeatCostsOf(state, cardId);
  for (const index of new Set(options.payRepeats ?? [])) {
    const repeat = repeats[index];
    if (repeat !== undefined) total = addCosts(total, repeat);
  }

  // R356.2.a.2 / R809 — Deflect is a Mandatory Additional Cost, once per time
  // this play chooses a Deflecting object an opponent controls. R809.1.c.1:
  // "The Power used to pay this cost may always be of any Domain."
  for (const targetId of options.targets ?? []) {
    if (state.permanents[targetId] === undefined) continue;
    if (controllerOf(state, targetId) === playerId) continue;
    const value = characteristicsOf(state, targetId).deflect;
    if (value > 0) {
      total = addCosts(total, { energy: 0, power: {}, anyPower: value });
    }
  }

  // 4. Discounts (R356.4). Step 3, cost increases, has no card yet.
  // R356.4.d — a discount on the *total* applies after component ones, which
  // is where a waiting "your next card costs less" belongs.
  const discounted = applyDiscounts(state, playerId, cardId, total);
  const waiting = state.pendingDiscounts.find(
    (entry) => entry.player === playerId,
  );
  return waiting === undefined
    ? discounted
    : subtract(discounted, waiting.reduce);
}
