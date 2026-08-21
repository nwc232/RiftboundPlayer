import type { PassiveAbility } from "./abilities.js";
import { permanentsAt, sameLocation } from "./state.js";
import type { CardId, GameState, Keyword, PermanentState } from "./state.js";

/**
 * R473–479. Layers are how game effects alter the characteristics of objects.
 * Nothing modified is ever stored: R476 describes the layers as something you
 * *re-evaluate*, not a result you remember, so this recomputes on every read.
 *
 * The three layers run in R477's order, and R476.2 requires recurring over them
 * until nothing changes — each effect applying at most once (R476.1). That loop
 * is not an optimisation detail, it is what makes R476.3's Fiora example work:
 * a buff raises Might in the arithmetic layer, which makes her Mighty, which
 * grants keywords back in the ability layer, which can add Might again.
 */
export interface Characteristics {
  might: number;
  keywords: Keyword[];
  /** R807.2 — Assault values from every source are summed, not redundant. */
  assault: number;
  /** R814.2 — likewise for Shield. */
  shield: number;
}

/** R477's layers, in the order they are applied. */
const LAYER_ORDER = ["trait", "ability", "arithmetic"] as const;
export type Layer = (typeof LAYER_ORDER)[number];

export type Modification =
  /** R477.1.a.1 — "a unit's Might becomes 4" is assignment, not arithmetic. */
  | { layer: "trait"; op: "setMight"; amount: number }
  /** R477.2 — granting a keyword. Assault/Shield carry a value (R807.1.b). */
  | { layer: "ability"; op: "grantKeyword"; keyword: Keyword; value?: number }
  /** R477.3 — the mathematics of raising and lowering Might. */
  | { layer: "arithmetic"; op: "addMight"; amount: number };

/** Who a passive ability modifies, relative to its source. */
export type PassiveScope =
  | { target: "self" }
  | { target: "otherFriendlyUnits"; here?: boolean };

/**
 * When a passive applies. Absent means always. `mighty` is R708 (Might 5+) and
 * is deliberately evaluated against the *current* pass, not printed Might —
 * that is the dependency R476.2's recursion exists to resolve.
 */
export type PassiveCondition =
  | { when: "attacking" }
  | { when: "defending" }
  | { when: "mighty" };

interface PendingModification {
  modification: Modification;
  condition: PassiveCondition | undefined;
  applied: boolean;
}

/** Every passive on the board that could modify `subject`. */
function passivesFor(
  state: GameState,
  subject: PermanentState,
): PendingModification[] {
  const found: PendingModification[] = [];

  for (const source of Object.values(state.permanents)) {
    const card = state.cards[source.cardId];
    if (card === undefined) continue;

    for (const ability of card.abilities) {
      if (ability.kind !== "passive") continue;
      if (!inScope(state, ability, source, subject)) continue;
      found.push({
        modification: ability.modification,
        condition: ability.condition,
        applied: false,
      });
    }
  }

  return found;
}

function inScope(
  state: GameState,
  ability: PassiveAbility,
  source: PermanentState,
  subject: PermanentState,
): boolean {
  switch (ability.scope.target) {
    case "self":
      return source.cardId === subject.cardId;

    case "otherFriendlyUnits": {
      if (source.cardId === subject.cardId) return false;
      if (source.controller !== subject.controller) return false;
      if (state.cards[subject.cardId]?.type !== "unit") return false;
      // "here" restricts the anthem to the source's own location.
      if (ability.scope.here === true) {
        return sameLocation(source.location, subject.location);
      }
      return true;
    }

    default: {
      const unhandled: never = ability.scope;
      return false;
    }
  }
}

function holds(
  condition: PassiveCondition | undefined,
  subject: PermanentState,
  might: number,
): boolean {
  if (condition === undefined) return true;

  switch (condition.when) {
    // R807.1.d.1 / R814.1.d.1 — tied to the designation, not to being in combat.
    case "attacking":
      return subject.designation === "attacker";
    case "defending":
      return subject.designation === "defender";
    // R708 — Mighty is Might 5 or greater, read from the current pass.
    case "mighty":
      return might >= 5;
    default: {
      const unhandled: never = condition;
      return false;
    }
  }
}

/**
 * R477.3.e — increases are applied before decreases. With no min/max clamping
 * modelled yet the sum is the same either way, but the order is the rule and
 * clamping (R477.3.b's "snapshotting") will depend on it.
 */
function arithmeticTotal(amounts: number[]): number {
  const increases = amounts.filter((amount) => amount > 0);
  const decreases = amounts.filter((amount) => amount < 0);
  return [...increases, ...decreases].reduce((sum, amount) => sum + amount, 0);
}

/**
 * The current characteristics of a permanent, with every applicable layer
 * effect applied. For anything not on the board, R711 says printed values
 * stand — a unit in the trash is Mighty on its printed Might alone.
 */
export function characteristicsOf(
  state: GameState,
  cardId: CardId,
): Characteristics {
  const card = state.cards[cardId];
  const printedMight = card?.might ?? 0;
  const printedKeywords = card?.keywords ?? [];

  const subject = state.permanents[cardId];
  if (card === undefined || subject === undefined) {
    return {
      might: printedMight,
      keywords: [...printedKeywords],
      assault: 0,
      shield: 0,
    };
  }

  const pending = passivesFor(state, subject);

  let baseMight = printedMight;
  let keywords = [...printedKeywords];
  // Printed Assault/Shield seed the totals that granted copies add to (R807.2).
  let assault = printedKeywords.includes("assault") ? (card.assault ?? 1) : 0;
  let shield = printedKeywords.includes("shield") ? (card.shield ?? 1) : 0;
  const arithmetic: number[] = [];

  const designationBonus = (): number => {
    if (subject.designation === "attacker") return assault;
    if (subject.designation === "defender") return shield;
    return 0;
  };
  const currentMight = (): number =>
    baseMight + arithmeticTotal(arithmetic) + designationBonus();

  // R476 — recur over the layers until a full pass changes nothing. The bound
  // is a safety net: each effect applies at most once (R476.1), so the loop
  // cannot run longer than the number of effects plus one settling pass.
  for (let pass = 0; pass <= pending.length; pass += 1) {
    let changed = false;

    for (const layer of LAYER_ORDER) {
      for (const entry of pending) {
        if (entry.applied) continue;
        if (entry.modification.layer !== layer) continue;
        if (!holds(entry.condition, subject, currentMight())) continue;

        switch (entry.modification.op) {
          case "setMight":
            baseMight = entry.modification.amount;
            break;
          case "grantKeyword": {
            const { keyword, value } = entry.modification;
            if (!keywords.includes(keyword)) keywords = [...keywords, keyword];
            if (keyword === "assault") assault += value ?? 1;
            if (keyword === "shield") shield += value ?? 1;
            break;
          }
          case "addMight":
            arithmetic.push(entry.modification.amount);
            break;
        }

        entry.applied = true;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return { might: currentMight(), keywords, assault, shield };
}

/** A unit's Might right now, after every layer effect (R710). */
export function mightOf(state: GameState, cardId: CardId): number {
  return characteristicsOf(state, cardId).might;
}

/** A unit's keywords right now, printed plus granted (R477.2). */
export function keywordsOf(state: GameState, cardId: CardId): Keyword[] {
  return characteristicsOf(state, cardId).keywords;
}
