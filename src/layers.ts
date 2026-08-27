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
  /** R809.2 — likewise for Deflect: granted values are summed, not redundant. */
  deflect: number;
  /**
   * Printed-or-copied Might, before the ability and arithmetic layers. This is
   * the value a copy effect takes: RiftJudge's ruling on LeBlanc's Reflection
   * is "the Reflection copies only the unit's copyable traits (printed Might
   * and Rules Text)" — so buffs, gear, and Might bonuses do not come across.
   */
  baseMight: number;
  /** R477.1.b.1.a's copyable traits, which a copy effect replaces wholesale. */
  name: string;
  type: CardType;
  cost: Cost;
  domain: Domain | undefined;
  /**
   * R133.8 — the card's tags. Copyable: a Reflection that becomes a copy of a
   * Mech is a Mech, and anything watching for the tag sees it.
   */
  tags: string[];
  /** "Rules Text" in R477.1.b.1.a's list. */
  abilities: Ability[];
  /**
   * Vilemaw — "Enemy units here with less Might than me don't deal combat
   * damage." The same shape as R423.1.b's Stunned: the unit contributes
   * nothing to the summed Might, but keeps its own Might against lethal.
   */
  silenced: boolean;
}

/** R477's layers, in the order they are applied. */
const LAYER_ORDER = ["trait", "ability", "arithmetic"] as const;
export type Layer = (typeof LAYER_ORDER)[number];

export type Modification =
  /** R477.1.a.1 — "a unit's Might becomes 4" is assignment, not arithmetic. */
  | { layer: "trait"; op: "setMight"; amount: number }
  /**
   * R477.1.b — becoming a copy. R477.1.b.1.a lists the copyable traits as
   * Name, Super Type, Type, Tags, Cost, Domain and Rules Text; Might is absent
   * from that list but is copied in practice, which RiftJudge's LeBlanc ruling
   * settles: "the Reflection copies only the unit's copyable traits (printed
   * Might and Rules Text)". Printed Might — buffs and gear stay behind.
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
  /**
   * Vex, Apathetic — "They can't move it this turn." A restriction rather than
   * a characteristic, but it lives here so it expires the same way everything
   * else with a duration does (R317.2.c).
   */
  | { layer: "ability"; op: "restrictMovement" }
  /** Vilemaw — "…don't deal combat damage." See `Characteristics.silenced`. */
  | { layer: "ability"; op: "silenceCombatDamage" }
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

/**
 * Who a passive ability modifies, relative to its source. `tag` narrows any of
 * them to R133.8's categories — Forecaster's "your Mechs have [Vision]".
 */
export type PassiveScope =
  | { target: "self" }
  | { target: "otherFriendlyUnits"; here?: boolean; tag?: string }
  /**
   * "*Your* Mechs" and "your Sand Soldiers" include the source when the source
   * is one of them, which is what separates this from `otherFriendlyUnits` —
   * Forecaster is itself a Mech, and does have [Vision].
   */
  | { target: "friendlyUnits"; here?: boolean; tag?: string }
  /**
   * Vilemaw — "Enemy units here with less Might than me…". The Might
   * comparison lives in the scope rather than in a PassiveCondition because it
   * is relative to the *source*, and a condition only ever sees the subject.
   */
  | {
      target: "enemyUnits";
      here?: boolean;
      tag?: string;
      weakerThanSource?: true;
    };

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
      if (!inScope(state, ability, source, subject, seen)) continue;
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
  seen: ReadonlySet<CardId>,
): boolean {
  // R133.8 — every unit scope may be narrowed to a tag, and `seen` keeps the
  // read safe inside the recursion the copy layer runs.
  const scope = ability.scope;
  if (
    scope.target !== "self" &&
    scope.tag !== undefined &&
    !characteristicsOf(state, subject.cardId, seen).tags.includes(scope.tag)
  ) {
    return false;
  }

  switch (ability.scope.target) {
    case "self":
      return source.cardId === subject.cardId;

    case "enemyUnits": {
      if (
        controllerOf(state, source.cardId) ===
        controllerOf(state, subject.cardId)
      ) {
        return false;
      }
      if (state.cards[subject.cardId]?.type !== "unit") return false;
      if (
        ability.scope.here === true &&
        !sameLocation(source.location, subject.location)
      ) {
        return false;
      }
      if (ability.scope.weakerThanSource === true) {
        // Read through the pipeline on both sides, with `seen` guarding the
        // recursion — Vilemaw asks about Might as it stands, not as printed.
        const mine = characteristicsOf(state, source.cardId, seen).might;
        const theirs = characteristicsOf(state, subject.cardId, seen).might;
        if (theirs >= mine) return false;
      }
      return true;
    }

    case "otherFriendlyUnits":
    case "friendlyUnits": {
      // The only difference between the two: "*other* friendly units" excludes
      // the source, "your Mechs" does not.
      if (
        ability.scope.target === "otherFriendlyUnits" &&
        source.cardId === subject.cardId
      ) {
        return false;
      }
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

/**
 * Vex, Apathetic — "They can't move it this turn." Read as a flat modifier
 * scan for the same reason `controllerOf` is: this is asked while deciding
 * whether an action is legal, not while deriving a characteristic.
 */
export function movementRestricted(state: GameState, cardId: CardId): boolean {
  return state.modifiers.some(
    (modifier) =>
      modifier.targetId === cardId &&
      modifier.modification.op === "restrictMovement",
  );
}

/** R719 — every card Attached to `cardId`, which is its Top-Most Card. */
export function attachmentsTo(
  state: GameState,
  cardId: CardId,
): PermanentState[] {
  return Object.values(state.permanents).filter(
    (permanent) => permanent.attachedTo === cardId,
  );
}

/** R317.2.c / R466.7.c — drop every modifier whose lifetime has ended. */
export function expireModifiers(
  state: GameState,
  duration: Duration,
): GameState {
  const modifiers = state.modifiers.filter(
    (modifier) => modifier.duration !== duration,
  );
  // R369's damage replacements carry the same lifetimes, so they end here too
  // — Lotus Trap's doubling and Unyielding Spirit's prevention are both
  // "this turn".
  const replacements = state.damageReplacements.filter(
    (entry) => entry.duration !== duration,
  );
  if (
    modifiers.length === state.modifiers.length &&
    replacements.length === state.damageReplacements.length
  ) {
    return state;
  }
  return { ...state, modifiers, damageReplacements: replacements };
}

/**
 * The current characteristics of a permanent, with every applicable layer
 * effect applied. For anything not on the board, R711 says printed values
 * stand — a unit in the trash is Mighty on its printed Might alone.
 */
/**
 * R819.1.b — "Cards with Quick-Draw have Reaction inherently." Derived rather
 * than printed, and applied to the printed list as well as the layered one:
 * the keyword does its work while the card is still in hand, where R711 leaves
 * nothing but printed values to read.
 */
function withDerivedKeywords(keywords: Keyword[]): Keyword[] {
  return keywords.includes("quickDraw") && !keywords.includes("reaction")
    ? [...keywords, "reaction"]
    : keywords;
}

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
    baseMight: printedMight,
    keywords: withDerivedKeywords([...printedKeywords]),
    assault: 0,
    shield: 0,
    deflect: 0,
    name: card?.name ?? cardId,
    type: card?.type ?? "unit",
    cost: card?.cost ?? { energy: 0, power: {}, anyPower: 0 },
    domain: card?.domain,
    tags: [...(card?.tags ?? [])],
    abilities: card?.abilities ?? [],
    silenced: false,
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
    // R434.1.c/d — every Attached card appends its Effect Text to this card's
    // Rules Text and modulates its Might by its Might Bonus.
    ...attachmentsTo(state, cardId).flatMap((attached) => {
      const gear = state.cards[attached.cardId]?.attachment;
      if (gear === undefined) return [];
      const steps: PendingModification[] = [];
      if (gear.mightBonus !== undefined && gear.mightBonus !== 0) {
        steps.push({
          modification: {
            layer: "arithmetic",
            op: "addMight",
            amount: gear.mightBonus,
          },
          condition: undefined,
          applied: false,
        });
      }
      for (const keyword of gear.keywords ?? []) {
        steps.push({
          modification: { layer: "ability", op: "grantKeyword", keyword },
          condition: undefined,
          applied: false,
        });
      }
      return steps;
    }),
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
    tags: [...(card.tags ?? [])],
    abilities: card.abilities,
  };
  // Printed Assault/Shield seed the totals that granted copies add to (R807.2).
  let assault = printedKeywords.includes("assault") ? (card.assault ?? 1) : 0;
  let shield = printedKeywords.includes("shield") ? (card.shield ?? 1) : 0;
  // R809.1.b.3 — "If X is omitted, it is presumed to be 1."
  let deflect = printedKeywords.includes("deflect") ? (card.deflect ?? 1) : 0;
  const arithmetic: ArithmeticStep[] = [];
  let silenced = false;

  // R703 — "Each Buff individually contributes +1 Might to a Unit." A counter
  // rather than a modifier, so it is read off the permanent like a designation.
  const buffBonus = subject.buffed === true ? 1 : 0;

  const designationBonus = (): number => {
    if (subject.designation === "attacker") return assault;
    if (subject.designation === "defender") return shield;
    return 0;
  };
  const currentMight = (): number =>
    runArithmetic(baseMight + designationBonus() + buffBonus, arithmetic);

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
              tags: source.tags,
              abilities: source.abilities,
            };
            // Printed-or-copied Might, not the source's current Might: a copy
            // enters clean, without the original's buffs or gear bonuses.
            baseMight = source.baseMight;
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
          case "silenceCombatDamage":
            silenced = true;
            break;
          case "restrictMovement":
            // Read directly off the modifier list by `movementRestricted`; it
            // is a restriction on an action, not a characteristic.
            break;
          case "grantKeyword": {
            const { keyword, value } = entry.modification;
            if (!keywords.includes(keyword)) keywords = [...keywords, keyword];
            if (keyword === "assault") assault += value ?? 1;
            if (keyword === "shield") shield += value ?? 1;
            if (keyword === "deflect") deflect += value ?? 1;
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

  // R718.3 — an Attached card's Effect Text is appended to the Top-Most Card's
  // Rules Text; R718.2 makes its own printed text Inactive while it is there.
  const appended = attachmentsTo(state, cardId).flatMap(
    (attached) => state.cards[attached.cardId]?.attachment?.abilities ?? [],
  );

  return {
    might: currentMight(),
    baseMight,
    // Derived after the fixpoint, so a *granted* Quick-Draw brings its
    // Reaction with it.
    keywords: withDerivedKeywords(keywords),
    assault,
    shield,
    deflect,
    silenced,
    ...copyable,
    abilities:
      subject.attachedTo !== undefined
        ? []
        : [...copyable.abilities, ...appended],
  };
}

/** Vilemaw — whether this unit contributes its Might to combat damage. */
export function dealsCombatDamage(state: GameState, cardId: CardId): boolean {
  // R423.1.b — a Stunned unit contributes nothing either; both answers meet
  // here so `combatSides` has one question to ask.
  if (state.permanents[cardId]?.stunned === true) return false;
  return !characteristicsOf(state, cardId).silenced;
}

/** A unit's Might right now, after every layer effect (R710). */
export function mightOf(state: GameState, cardId: CardId): number {
  return characteristicsOf(state, cardId).might;
}

/**
 * R816.1.b — Temporary is "functionally short for" this triggered ability, so
 * the keyword is expanded into one rather than special-cased at every reader.
 * R816.2 makes multiple instances redundant, which one expansion gives us.
 */
const TEMPORARY: Ability = {
  kind: "triggered",
  trigger: { on: "phaseBegan", phase: "beginning", subject: "controller" },
  effect: { op: "killSelf" },
};

/**
 * R817.1.b — "When this is played, Predict 1." R817.1.c makes the trigger the
 * permanent entering the Board, which is what `unitPlayed` reports for gear as
 * well as units.
 */
/**
 * R819.1.d's second half — "When you play this, attach it to a Unit you
 * control." The first half, [Reaction], is a keyword rather than an ability
 * and is derived in `characteristicsOf`.
 */
const QUICK_DRAW: Ability = {
  kind: "triggered",
  trigger: { on: "unitPlayed", subject: "self" },
  targeting: { filters: [{ type: "unit", controller: "friendly" }] },
  effect: { op: "attachSelf", targetIndex: 0 },
};

/**
 * R821.1.c — "When you play me, you may choose a Card you control with the
 * Equipment tag … Pay the cost of its Equip ability, reduced by [A], to attach
 * it to this unit."
 *
 * `optional` is the "you may" (R383.3.a), asked before targets. The [A] is
 * R821.1.c's flat reduction, floored at zero by R821.1.c.3 for an Equip cost
 * that has no [A] in it.
 */
const WEAPONMASTER: Ability = {
  kind: "triggered",
  trigger: { on: "unitPlayed", subject: "self" },
  optional: true,
  // R150 — "Gear can have the Equipment tag", and R821.1.c chooses by it.
  targeting: {
    filters: [{ type: "gear", controller: "friendly", tag: "Equipment" }],
  },
  effect: {
    op: "equipChosen",
    targetIndex: 0,
    reduce: { energy: 0, power: {}, anyPower: 1 },
  },
};

const VISION: Ability = {
  kind: "triggered",
  trigger: { on: "unitPlayed", subject: "self" },
  effect: { op: "predict", count: 1 },
};

/**
 * A permanent's rules text as it currently stands: copied text rather than
 * printed where a copy applies, plus the abilities that keywords stand for.
 */
export function abilitiesOf(state: GameState, cardId: CardId): Ability[] {
  const now = characteristicsOf(state, cardId);
  const derived: Ability[] = [];
  if (now.keywords.includes("temporary")) derived.push(TEMPORARY);
  if (now.keywords.includes("vision")) derived.push(VISION);
  // R819.2 — "Multiple instances of Quick-Draw do not trigger separately", so
  // asking whether the keyword is present is the whole of it.
  if (now.keywords.includes("quickDraw")) derived.push(QUICK_DRAW);
  if (now.keywords.includes("weaponmaster")) derived.push(WEAPONMASTER);
  return derived.length === 0 ? now.abilities : [...now.abilities, ...derived];
}

/** A card's tags right now — printed, or the ones it is currently copying. */
export function tagsOf(state: GameState, cardId: CardId): string[] {
  return characteristicsOf(state, cardId).tags;
}

/** A unit's keywords right now, printed plus granted (R477.2). */
export function keywordsOf(state: GameState, cardId: CardId): Keyword[] {
  return characteristicsOf(state, cardId).keywords;
}
