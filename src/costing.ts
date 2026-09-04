import { addCosts } from "./cost.js";
import type { AbilityCost, CostAuraAbility } from "./abilities.js";
import type { PlayZone } from "./zones.js";
import { FREE } from "./cost.js";
import {
  characteristicsOf,
  controllerOf,
  keywordsOf,
  resourcePartOf,
} from "./layers.js";
import { legalTargets } from "./decisions.js";
import { holds } from "./conditions.js";
import type { Condition } from "./conditions.js";
import type { CardId, Cost, GameState, PlayerId, PowerCount } from "./state.js";
import { seatOf } from "./state.js";

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

  // R356.4 — the board's reductions alongside the card's own, and the floor a
  // "to a minimum of [1]" imposes on both.
  const auras = costAurasFor(state, playerId, cardId);
  const floors = auras.flatMap((aura) =>
    aura.minimum === undefined ? [] : [{ ...FREE, ...aura.minimum }],
  );
  const applyFloor = (value: Cost): Cost =>
    floors.reduce(
      (out, floor) => ({
        energy: Math.max(out.energy, floor.energy),
        power: out.power,
        anyPower: Math.max(out.anyPower, floor.anyPower),
      }),
      value,
    );

  for (const aura of auras) {
    if (aura.reduce === undefined) continue;
    const { reduce } = aura;
    cost = applyFloor({
      energy: Math.max(0, cost.energy - (reduce.energy ?? 0)),
      power: reducePower(cost.power, reduce.power ?? {}),
      anyPower: Math.max(0, cost.anyPower - (reduce.anyPower ?? 0)),
    });
  }

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
  costs: AbilityCost[];
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
      costs: [
        {
          kind: "pay",
          cost: addCosts(
            { energy: 1, power: {}, anyPower: 0 },
            ownDomainPower(state, cardId, 1),
          ),
        },
      ],
    });
  }

  for (const ability of state.cards[cardId]?.abilities ?? []) {
    if (ability.kind === "additionalCost") {
      costs.push({ optional: ability.optional === true, costs: ability.costs });
    }
  }

  return costs;
}

/**
 * Every non-resource cost this play has to pay, in the fixed order it pays
 * them. R356.2's additional costs, [Repeat]'s (R820.1.c.2) and [Flow]'s
 * (R829.1.c.2) all "may include both resource costs and non-resource costs";
 * the resource halves are summed by `totalCostOf` and paid in one go, and
 * these are the rest.
 *
 * The order is not incidental. `costChoices` on the action is indexed against
 * the choosing entries of this list, so `legalActions` and `applyAction` have
 * to walk it identically — which they do by both calling this rather than each
 * assembling their own.
 */
export function nonResourceCostsOf(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  options: {
    zone?: PlayZone;
    payOptional?: boolean;
    payRepeats?: readonly number[];
  } = {},
): AbilityCost[] {
  const repeats = repeatCostsOf(state, cardId, playerId);
  return [
    // R829.1.c.2 — [Flow]'s non-resource half, which belongs to the zone the
    // card is being played from rather than to the card.
    ...(options.zone?.extraCosts ?? []),
    // R356.2 — mandatory additional costs always, optional ones only when the
    // player chose to pay (R356.2.b.1).
    ...additionalCostsOf(state, cardId).flatMap((additional) =>
      additional.optional && options.payOptional !== true
        ? []
        : additional.costs,
    ),
    // R820.1.c.2 — and each [Repeat] cost this play elected to pay.
    ...(options.payRepeats ?? []).flatMap((index) => repeats[index] ?? []),
  ].filter((each) => each.kind !== "pay");
}

/**
 * What a `chosen` cost will accept. The filter says what may be named; the
 * verb adds its own requirement on top, because R414.1.b's "an exhausted
 * object cannot be exhausted" and R704's "you have no buff to spend" are
 * conditions of the *game action*, not of the choice.
 */
export function choicePoolFor(
  state: GameState,
  controller: PlayerId,
  cost: Extract<AbilityCost, { kind: "chosen" }>,
  sourceId: CardId,
): CardId[] {
  // R416.1 — the trash is a public zone, so there is nothing to filter by
  // beyond being in it.
  if (cost.fromTrash === true) return [...seatOf(state, controller).trash];
  // R422.1.a — a Discard chooses from the discarding player's hand, which is
  // not a board search and so has no filter to apply.
  if (cost.from === undefined) return seatOf(state, controller).hand;

  const pool = legalTargets(state, controller, cost.from, sourceId);
  switch (cost.does) {
    // R414.1.b — an already-exhausted object can't be exhausted again.
    case "exhaust":
      return pool.filter((cardId) => state.permanents[cardId]?.exhausted === false);
    // R701–705 — the buff *is* the cost, so an unbuffed unit cannot pay it.
    case "spendBuff":
      return pool.filter((cardId) => state.permanents[cardId]?.buffed === true);
    default:
      return pool;
  }
}

/**
 * The entries of `nonResourceCostsOf` that ask the player to choose something,
 * in the same order. One entry of the action's `costChoices` answers each.
 */
export function choosingCostsOf(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  options: {
    zone?: PlayZone;
    payOptional?: boolean;
    payRepeats?: readonly number[];
  } = {},
): Extract<AbilityCost, { kind: "chosen" }>[] {
  return nonResourceCostsOf(state, playerId, cardId, options).filter(
    (each): each is Extract<AbilityCost, { kind: "chosen" }> =>
      each.kind === "chosen",
  );
}

/**
 * R820.1.c — every [Repeat] cost printed on a card, in the order it prints
 * them, which is what `payRepeats` indexes into. R820.1.c.2 makes them
 * independent: Curtain Call's three are paid or not paid one at a time.
 */
export function repeatCostsOf(
  state: GameState,
  cardId: CardId,
  playerId?: PlayerId,
): AbilityCost[][] {
  return costKeywordsOf(state, cardId, "repeat", playerId);
}

/**
 * R829.1.c — every [Flow] cost printed on a card, in printed order. R829.1.c.3:
 * "If a spell has multiple instances of the Flow keyword with different costs,
 * its controller may choose which cost to apply as they play it."
 */
export function flowCostsOf(
  state: GameState,
  cardId: CardId,
  playerId?: PlayerId,
): AbilityCost[][] {
  return costKeywordsOf(state, cardId, "flow", playerId);
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
  playerId?: PlayerId,
): AbilityCost[][] {
  const own = characteristicsOf(state, cardId)
    .costKeywords.filter((each) => each.keyword === keyword)
    .map((each) => each.costs);

  // Syndra, Transcendent — "your spells have [Repeat] [2][Chaos]". Swept from
  // the board rather than layered, because the card is in a hand and R711
  // reads anything off the board on printed values alone.
  const card = state.cards[cardId];
  if (playerId === undefined || card === undefined) return own;

  const granted: AbilityCost[][] = [];
  for (const { sourceId, controller } of boardAuraSources(state)) {
    for (const ability of state.cards[sourceId]?.abilities ?? []) {
      if (ability.kind !== "keywordAura") continue;
      if (ability.keyword !== keyword) continue;

      const mine = controller === playerId;
      if (ability.affects === "friendly" && !mine) continue;
      if (ability.affects === "enemy" && mine) continue;

      const match = ability.match;
      if (match?.type !== undefined && card.type !== match.type) continue;
      if (match?.nonToken === true && card.isToken === true) continue;

      if (
        ability.when !== undefined &&
        !holds(state, ability.when, { controller, sourceId, targets: [] })
      ) {
        continue;
      }
      granted.push(ability.costs);
    }
  }
  return [...own, ...granted];
}

/**
 * Every board ability that changes what `cardId` costs `playerId` to play.
 *
 * Swept rather than layered: the card is in a hand, and R711 reads anything
 * off the board on printed values. R190.6.d is why an uncontrolled battlefield
 * contributes nothing — "you" refers to nobody, so its instructions are
 * ignored.
 */
function boardAuraSources(
  state: GameState,
): { sourceId: CardId; controller: PlayerId }[] {
  const sources: { sourceId: CardId; controller: PlayerId }[] = [
    ...Object.values(state.permanents).map((permanent) => ({
      sourceId: permanent.cardId,
      controller: controllerOf(state, permanent.cardId),
    })),
  ];
  for (const player of Object.values(state.players)) {
    if (player.legend !== null) {
      sources.push({ sourceId: player.legend, controller: player.id });
    }
  }
  for (const battlefieldId of state.battlefieldOrder) {
    const controller = state.battlefields[battlefieldId]?.controller;
    if (controller != null) sources.push({ sourceId: battlefieldId, controller });
  }
  return sources;
}

function costAurasFor(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): CostAuraAbility[] {
  const card = state.cards[cardId];
  if (card === undefined) return [];

  const found: CostAuraAbility[] = [];
  for (const { sourceId, controller } of boardAuraSources(state)) {
    for (const ability of state.cards[sourceId]?.abilities ?? []) {
      if (ability.kind !== "costAura") continue;

      // "Opponents' spells" is relative to whoever the aura belongs to.
      const mine = controller === playerId;
      if (ability.affects === "friendly" && !mine) continue;
      if (ability.affects === "enemy" && mine) continue;

      const match = ability.match;
      if (match?.type !== undefined && card.type !== match.type) continue;
      if (match?.nonToken === true && card.isToken === true) continue;
      if (
        match?.keyword !== undefined &&
        !(card.keywords ?? []).includes(match.keyword)
      ) {
        continue;
      }

      if (
        ability.when !== undefined &&
        !holds(state, ability.when, { controller, sourceId, targets: [] })
      ) {
        continue;
      }

      found.push(ability);
    }
  }
  return found;
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
   * Fizz, Trickster — "ignoring its Energy cost. (You must still pay its Power
   * cost.)" Narrower than `ignoreBaseCost`: only the Energy half goes.
   */
  waiveEnergy?: boolean;
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

  // Fizz — the Energy half of the base cost, and only that half. Applied
  // before R356.2's additional costs, which can then raise it again.
  if (options.waiveEnergy === true) total = { ...total, energy: 0 };

  // 2. Additional costs (R356.2).
  // Only the resource half is priced; R356.2's non-resource costs are paid as
  // the card is played, like any other ability cost.
  for (const additional of additionalCostsOf(state, cardId)) {
    if (additional.optional && options.payOptional !== true) continue;
    total = addCosts(total, resourcePartOf(additional.costs));
  }
  // R820.1.c.1 — a Repeat cost is "an Additional Cost to be paid during the
  // steps of playing the spell", so it lands in step 2 beside the others.
  // Only the resource half is priced here; R820.1.c.2's non-resource costs are
  // paid as the card is played, like any other ability cost.
  const repeats = repeatCostsOf(state, cardId, playerId);
  for (const index of new Set(options.payRepeats ?? [])) {
    const repeat = repeats[index];
    if (repeat !== undefined) total = addCosts(total, resourcePartOf(repeat));
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

  // 3. Cost increases (R356.3), swept off the board — see `costAurasFor`.
  for (const aura of costAurasFor(state, playerId, cardId)) {
    if (aura.increase === undefined) continue;
    total = addCosts(total, { ...FREE, ...aura.increase });
  }

  // 4. Discounts (R356.4).
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
