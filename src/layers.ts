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
  | { layer: "arithmetic"; op: "addMight"; amount: number }
  /**
   * R477.3.b's third example — "Might increased to 5" from a *passive* does not
   * snapshot, so it is recomputed against whatever the running value is. That
   * is what makes it depend on other effects in its own layer (R479).
   */
  | { layer: "arithmetic"; op: "increaseMightTo"; target: number };

/** R317.2.c and R466.7.c — the two expiry points the rules define. */
export type Duration = "thisTurn" | "thisCombat";

/**
 * A continuous effect with a lifetime of its own, rather than one read live off
 * a permanent. R432.1.a is why the amount is stored rather than re-derived: a
 * unit with base 3 and Shield 2 hit by "double my Might this turn" gets a fixed
 * +5, and still has it after combat ends and the Shield stops applying — 8, not
 * 6. R477.3.b calls fixing the value this way "snapshotting".
 */
export interface Modifier {
  id: string;
  targetId: CardId;
  modification: Modification;
  duration: Duration;
}

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

type ArithmeticStep = Extract<Modification, { layer: "arithmetic" }>;

/**
 * R477.3.e — increases are applied before decreases.
 *
 * Within the increases, fixed amounts go before `increaseMightTo`, which is
 * R478/479's dependency made concrete: "increased to 5" alongside a "+2" yields
 * a different number depending on which lands first, and R479 says the effect
 * whose evaluation is altered by the sequence is the one that depends — so it
 * applies last. General dependency detection (R478.1.a/b, effects that alter
 * whether another effect exists or how many objects it reaches) is not
 * modelled; nothing in the vocabulary can do that yet.
 */
function runArithmetic(base: number, steps: ArithmeticStep[]): number {
  const fixedIncreases = steps.filter(
    (step) => step.op === "addMight" && step.amount > 0,
  );
  const dependent = steps.filter((step) => step.op === "increaseMightTo");
  const decreases = steps.filter(
    (step) => step.op === "addMight" && step.amount < 0,
  );

  let value = base;
  for (const step of fixedIncreases) {
    if (step.op === "addMight") value += step.amount;
  }
  for (const step of dependent) {
    if (step.op === "increaseMightTo") value = Math.max(value, step.target);
  }
  for (const step of decreases) {
    if (step.op === "addMight") value += step.amount;
  }
  return value;
}

/** R317.2.c / R466.7.c — drop every modifier whose lifetime has ended. */
export function expireModifiers(
  state: GameState,
  duration: Duration,
): GameState {
  const modifiers = state.modifiers.filter(
    (modifier) => modifier.duration !== duration,
  );
  if (modifiers.length === state.modifiers.length) return state;
  return { ...state, modifiers };
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

  const pending = [
    ...passivesFor(state, subject),
    // Stored modifiers carry an already-snapshotted amount (R477.3.b), so they
    // have no condition to re-evaluate — only a lifetime.
    ...state.modifiers
      .filter((modifier) => modifier.targetId === cardId)
      .map((modifier) => ({
        modification: modifier.modification,
        condition: undefined,
        applied: false,
      })),
  ];

  let baseMight = printedMight;
  let keywords = [...printedKeywords];
  // Printed Assault/Shield seed the totals that granted copies add to (R807.2).
  let assault = printedKeywords.includes("assault") ? (card.assault ?? 1) : 0;
  let shield = printedKeywords.includes("shield") ? (card.shield ?? 1) : 0;
  const arithmetic: ArithmeticStep[] = [];

  const designationBonus = (): number => {
    if (subject.designation === "attacker") return assault;
    if (subject.designation === "defender") return shield;
    return 0;
  };
  const currentMight = (): number =>
    runArithmetic(baseMight + designationBonus(), arithmetic);

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
          case "increaseMightTo":
            arithmetic.push(entry.modification);
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
