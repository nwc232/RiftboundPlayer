import { characteristicsOf } from "./layers.js";
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
export function costOf(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): Cost {
  let cost = characteristicsOf(state, cardId).cost;

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
