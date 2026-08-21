import type { Ability, Effect, PassiveAbility } from "./abilities.js";
import { sameLocation } from "./state.js";
import type {
  CardId,
  CardType,
  Cost,
  Domain,
  GameState,
  Keyword,
  PermanentState,
  PlayerId,
} from "./state.js";

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
  /** R477.1.b.1.a's copyable traits, which a copy effect replaces wholesale. */
  name: string;
  type: CardType;
  cost: Cost;
  domain: Domain | undefined;
  /** "Rules Text" in R477.1.b.1.a's list. */
  abilities: Ability[];
}

/** R477's layers, in the order they are applied. */
const LAYER_ORDER = ["trait", "ability", "arithmetic"] as const;
export type Layer = (typeof LAYER_ORDER)[number];

export type Modification =
  /** R477.1.a.1 — "a unit's Might becomes 4" is assignment, not arithmetic. */
  | { layer: "trait"; op: "setMight"; amount: number }
  /**
   * R477.1.b — becoming a copy. Only R477.1.b.1.a's copyable traits move
   * across: Name, Super Type, Type, Tags, Cost, Domain, Rules Text. Might is
   * conspicuously *not* on that list, so a Reflection token copying a 5-Might
   * unit stays at its own printed 0. See the survey's note on this.
   */
  | { layer: "trait"; op: "copyOf"; sourceId: CardId }
  /**
   * R477.1.a — Controller is a trait, so taking control is a layer effect
   * rather than a rewrite of the permanent. That is what lets Hostile
   * Takeover's "lose control of that unit at end of turn" simply expire.
   */
  | { layer: "trait"; op: "setController"; player: PlayerId }
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

/**
 * R317.2.c and R466.7.c are the two expiry points the rules define.
 * `permanent` is R477.3.b's "unlimited duration" — it still snapshots, it just
 * never expires; a copy effect is the usual case.
 */
export type Duration = "thisTurn" | "thisCombat" | "permanent";

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

/**
 * R317.1.a — "At the end of the turn Game Effects take place." A delayed effect
 * is something a resolved effect scheduled for later, as opposed to a modifier,
 * which merely stops applying. Hostile Takeover needs both halves: its control
 * change is a modifier that expires, its recall is an action that fires.
 */
export type DelayedTiming = "endOfTurn";

export interface DelayedEffect {
  id: string;
  at: DelayedTiming;
  controller: PlayerId;
  sourceId: CardId;
  effect: Effect;
  /** Frozen when scheduled — the choices were made back then (R355.5). */
  targets: CardId[];
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
  seen: ReadonlySet<CardId>,
): PendingModification[] {
  const found: PendingModification[] = [];

  for (const source of Object.values(state.permanents)) {
    const card = state.cards[source.cardId];
    if (card === undefined) continue;

    // A source that has become a copy of something grants the *copied* rules
    // text, so its abilities have to be read through the layers too.
    const abilities =
      source.cardId === subject.cardId
        ? card.abilities
        : characteristicsOf(state, source.cardId, seen).abilities;

    for (const ability of abilities) {
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
      if (
        controllerOf(state, source.cardId) !==
        controllerOf(state, subject.cardId)
      ) {
        return false;
      }
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

/**
 * Who currently controls a permanent (R477.1.a). Deliberately not the full
 * pipeline: control is read while *computing* characteristics — the layer
 * pipeline asks who controls a source to decide whether its anthem is friendly
 * — so this reads only stored trait-layer effects and cannot recur.
 *
 * A consequence is that a *passive* granting control is not supported; every
 * control-changing card in the pool works through a resolved effect instead.
 */
export function controllerOf(state: GameState, cardId: CardId): PlayerId {
  const permanent = state.permanents[cardId];
  let controller: PlayerId | undefined = permanent?.controller;

  for (const modifier of state.modifiers) {
    if (modifier.targetId !== cardId) continue;
    if (modifier.modification.op !== "setController") continue;
    controller = modifier.modification.player;
  }

  return controller ?? "p1";
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
  seen: ReadonlySet<CardId> = new Set(),
): Characteristics {
  const card = state.cards[cardId];
  const printedMight = card?.might ?? 0;
  const printedKeywords = card?.keywords ?? [];

  const printed = (): Characteristics => ({
    might: printedMight,
    keywords: [...printedKeywords],
    assault: 0,
    shield: 0,
    name: card?.name ?? cardId,
    type: card?.type ?? "unit",
    cost: card?.cost ?? { energy: 0, power: {}, anyPower: 0 },
    domain: card?.domain,
    abilities: card?.abilities ?? [],
  });

  const subject = state.permanents[cardId];
  // R711 — anything off the board is read on printed values alone. The `seen`
  // guard stops a copy cycle (A copies B, B copies A) recurring forever.
  if (card === undefined || subject === undefined || seen.has(cardId)) {
    return printed();
  }
  const nested = new Set([...seen, cardId]);

  const pending = [
    ...passivesFor(state, subject, nested),
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
  let copyable = {
    name: card.name,
    type: card.type,
    cost: card.cost,
    domain: card.domain,
    abilities: card.abilities,
  };
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

          /**
           * R477.1.b.1.b — a copy takes the source's *current* copyable traits,
           * not its printed ones, so copying a Reflection that is already a
           * copy of Honest Broker yields a third Honest Broker.
           */
          case "copyOf": {
            const source = characteristicsOf(
              state,
              entry.modification.sourceId,
              nested,
            );
            copyable = {
              name: source.name,
              type: source.type,
              cost: source.cost,
              domain: source.domain,
              abilities: source.abilities,
            };
            // Rules text came across, so any passives in it now apply too.
            for (const ability of source.abilities) {
              if (ability.kind !== "passive") continue;
              if (ability.scope.target !== "self") continue;
              pending.push({
                modification: ability.modification,
                condition: ability.condition,
                applied: false,
              });
            }
            break;
          }
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

  return { might: currentMight(), keywords, assault, shield, ...copyable };
}

/** A unit's Might right now, after every layer effect (R710). */
export function mightOf(state: GameState, cardId: CardId): number {
  return characteristicsOf(state, cardId).might;
}

/** A unit's keywords right now, printed plus granted (R477.2). */
export function keywordsOf(state: GameState, cardId: CardId): Keyword[] {
  return characteristicsOf(state, cardId).keywords;
}
