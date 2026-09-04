import type {
  AbilityCost,
  AbilityTiming,
  ActivatedAbility,
  AdditionalCostAbility,
  CostAuraAbility,
  KeywordAuraAbility,
  Ability,
  EmpowerAbility,
  Mode,
  FlowAbility,
  RepeatAbility,
  Effect,
  CostModifierAbility,
  EntryReplacementAbility,
  PassiveAbility,
  PlayPermissionAbility,
  ReplacementAbility,
  RestrictionAuraAbility,
  BoardRestriction,
} from "./abilities.js";
import type { Targeting, TargetFilter } from "./decisions.js";
import type { PlayPermission } from "./play.js";
import type {
  CostKeyword,
  DelayedTiming,
  Duration,
  Modification,
  PassiveCondition,
  PassiveScope,
  Restriction,
} from "./layers.js";
import type { Condition } from "./conditions.js";
import { FREE } from "./cost.js";
import type { TokenKind } from "./tokens.js";
import type {
  CardInstance,
  CardType,
  Cost,
  Domain,
  Keyword,
  PaymentRestriction,
  PlaySource,
} from "./state.js";

// Effects. Each of these builds data and does nothing else — addEnergy(1)
// returns { op: "addEnergy", amount: 1 }, it does not add any energy.

export function addEnergy(
  amount: number,
  /** Lux, Scorn of the Moon — resources that are not fully general. */
  restriction?: PaymentRestriction,
): Effect {
  return {
    op: "addEnergy",
    amount,
    ...(restriction === undefined ? {} : { restriction }),
  };
}

export function addPower(
  domain: Domain | "selfDomain",
  amount: number,
  restriction?: PaymentRestriction,
): Effect {
  return {
    op: "addPower",
    domain,
    amount,
    ...(restriction === undefined ? {} : { restriction }),
  };
}

/** "Use only to play spells" — and "…or use gear abilities" with the flag. */
export function onlyFor(
  cardType: CardType,
  orItsAbilities?: true,
): PaymentRestriction {
  return {
    kind: "onlyCardType",
    cardType,
    ...(orItsAbilities === undefined ? {} : { orItsAbilities }),
  };
}

/** Scorn of the Moon — "Spend this Energy only during showdowns." */
export const onlyInShowdowns: PaymentRestriction = {
  kind: "onlyDuringShowdown",
};

export function seq(...steps: Effect[]): Effect {
  return { op: "seq", steps };
}

// Costs.

export const exhaustSelf: AbilityCost = { kind: "exhaustSelf" };
export const recycleSelf: AbilityCost = { kind: "recycleSelf" };

/**
 * R422 — "discard 1" as a cost. R422.1.a leaves the choice to the discarding
 * player, so this is a `chosen` cost with the hand as its pool.
 */
export function discardCost(count = 1): AbilityCost {
  return { kind: "chosen", does: "discard", count };
}

/**
 * "Kill a friendly unit as an additional cost", and the rest of the family.
 * The filter says what may be named; the verb says what happens to it.
 */
export function chosenCost(
  does: Extract<AbilityCost, { kind: "chosen" }>["does"],
  from: TargetFilter,
  count: number | "any" = 1,
): AbilityCost {
  return { kind: "chosen", does, from, count };
}

// Abilities.

export function activated(
  costs: AbilityCost[],
  effect: Effect,
  timing: AbilityTiming = "default",
): ActivatedAbility {
  return { kind: "activated", timing, costs, effect };
}

export function dealDamage(amount: number, targetIndex = 0): Effect {
  return { op: "dealDamage", amount, targetIndex };
}

export function draw(count: number, targetIndex?: number): Effect {
  return {
    op: "draw",
    count,
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

export function counterSpell(targetIndex = 0): Effect {
  return { op: "counterSpell", targetIndex };
}

/**
 * R432.1 — "give a unit +N Might this turn". `min`/`max` are R477.3.b's
 * limitation, applied and remembered once: Ahri, Inquisitive's "-2 Might this
 * turn, to a minimum of 1" is `modifyMight(-2, "thisTurn", { min: 1 })`.
 */
export function modifyMight(
  amount: number,
  duration: Duration,
  limits: { min?: number; max?: number } = {},
  targetIndex = 0,
): Effect {
  return {
    op: "modifyMight",
    amount,
    duration,
    targetIndex,
    ...(limits.min !== undefined ? { min: limits.min } : {}),
    ...(limits.max !== undefined ? { max: limits.max } : {}),
  };
}

/** Last Stand — "Double a friendly unit's Might this turn." (R432.1.a) */
export function doubleMight(duration: Duration, targetIndex = 0): Effect {
  return { op: "modifyMight", double: true, duration, targetIndex };
}

/** Fortified Position — "It gains [Shield 2] this combat." */
export function grantKeywordFor(
  keyword: Keyword,
  duration: Duration,
  value?: number,
  targetIndex = 0,
): Effect {
  return {
    op: "grantKeywordFor",
    keyword,
    duration,
    targetIndex,
    ...(value !== undefined ? { value } : {}),
  };
}

/**
 * R180/R184 — "Play two 3 [M] Mech unit tokens to your base" (Ferrous
 * Forerunner) is `createToken("mech", 2)`. Units enter exhausted by default
 * (R185.2.d); `ready` is R184.1's override.
 */
export function createToken(
  token: TokenKind,
  count = 1,
  options: {
    ready?: true;
    to?: "base" | "sourceLocation" | "eventLocation";
    copyOfTarget?: number;
    copyOfSource?: true;
    grants?: Keyword[];
  } = {},
): Effect {
  return {
    op: "createToken",
    token,
    count,
    ...(options.ready !== undefined ? { ready: options.ready } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
    ...(options.copyOfTarget !== undefined
      ? { copyOfTarget: options.copyOfTarget }
      : {}),
    ...(options.copyOfSource !== undefined
      ? { copyOfSource: options.copyOfSource }
      : {}),
    ...(options.grants !== undefined ? { grants: options.grants } : {}),
  };
}

/** Possession — "Take control of it and recall it." */
export function takeControl(
  duration: Duration,
  options: { recall?: true } = {},
  targetIndex = 0,
): Effect {
  return {
    op: "takeControl",
    duration,
    targetIndex,
    ...(options.recall !== undefined ? { recall: options.recall } : {}),
  };
}

/** R317.1.a — "…at end of turn", scheduling an effect rather than a duration. */
export function delay(at: DelayedTiming, effect: Effect): Effect {
  return { op: "delay", at, effect };
}

/** R454 — send a unit to its controller's base. Not a move, so it contests nothing. */
export function recall(targetIndex = 0): Effect {
  return { op: "recall", targetIndex };
}

/** Gust, Rebuke — "Return a unit … to its owner's hand." */
export function returnToHand(targetIndex = 0): Effect {
  return { op: "returnToHand", targetIndex };
}

/** R427 — Thrill of the Hunt's "Banish a friendly unit". */
export function banish(targetIndex = 0): Effect {
  return { op: "banish", targetIndex };
}

/** R415 — First Mate's "ready another unit". */
export function ready(targetIndex = 0): Effect {
  return { op: "ready", targetIndex };
}

/** R426 — Pit Rookie's "buff another friendly unit". */
export function buff(targetIndex = 0): Effect {
  return { op: "buff", targetIndex };
}

/** R423 — Back Off's "[Stun] a unit". */
export function stun(targetIndex = 0): Effect {
  return { op: "stun", targetIndex };
}

/**
 * R369.3 — "I enter ready", and the conditional forms of it: Breakneck Mech's
 * "if you control another Mech", Xin Zhao's "if you have two or more other
 * units in your base".
 */
export function entersReady(when?: Condition): EntryReplacementAbility {
  return {
    kind: "entryReplacement",
    ready: true,
    ...(when !== undefined ? { when } : {}),
  };
}

/** Xin Zhao, Vigilant — "if you have two or more other units in your base". */
export function controlsOtherUnits(atLeast: number): Condition {
  return { kind: "controlsOtherUnits", atLeast };
}

/** Lotus Trap — "Double all damage that would be dealt to it this turn." */
export function scaleDamage(
  factor: number,
  duration: Duration,
  targetIndex = 0,
): Effect {
  return { op: "scaleDamage", targetIndex, factor, duration };
}

/**
 * R437 — "Prevent the next X [source] damage…". Omit `targetIndex` for
 * Unyielding Spirit's "prevent all spell and ability damage this turn", which
 * names no unit.
 */
export function preventDamage(
  amount: number | "all",
  duration: Duration,
  options: { from?: "any" | "spellOrAbility"; targetIndex?: number } = {},
): Effect {
  return {
    op: "preventDamage",
    amount,
    from: options.from ?? "any",
    duration,
    ...(options.targetIndex !== undefined
      ? { targetIndex: options.targetIndex }
      : {}),
  };
}

/** R142 — Soraka's "instead **heal it**". */
export function heal(targetIndex = 0): Effect {
  return { op: "heal", targetIndex };
}

/** R414 — "heal it, **exhaust it**, and recall it". */
export function exhaust(targetIndex = 0): Effect {
  return { op: "exhaust", targetIndex };
}

/**
 * R369 — a replacement effect that intercedes in a death. Soraka, Wanderer:
 * "If another unit you control here would die … instead heal it, exhaust it,
 * and recall it." The dying unit is target 0 of `instead`.
 */
export function replacesDeath(
  scope: PassiveScope,
  instead: Effect,
  options: { oncePerTurn?: true } = {},
): ReplacementAbility {
  return {
    kind: "replacement",
    on: "dies",
    scope,
    instead,
    ...(options.oncePerTurn !== undefined
      ? { oncePerTurn: options.oncePerTurn }
      : {}),
  };
}

/** R730.1 — Kha'Zix, Mutating Horror's "gain 2 XP". */
export function gainXP(amount: number): Effect {
  return { op: "gainXP", amount };
}

/** R433 — Switcheroo's "Swap the Might of two units at the same battlefield". */
export function swapMight(
  duration: Duration,
  targetIndex = 0,
  otherIndex = 1,
): Effect {
  return { op: "swapMight", duration, targetIndex, otherIndex };
}

/** Tideturner — "Move me to its location and it to my original location." */
export function swapLocations(targetIndex = 0): Effect {
  return { op: "swapLocations", targetIndex };
}

/** Rampage — "They deal damage equal to their Mights to each other." */
export function mutualDamage(targetIndex = 0, otherIndex = 1): Effect {
  return { op: "mutualDamage", targetIndex, otherIndex };
}

/** Targon's Peak — "ready 2 runes at the end of this turn". */
export function readyRunes(count: number): Effect {
  return { op: "readyRunes", count };
}

/** Seat of Power — "draw 1 for each other battlefield you or allies control". */
export function drawPerBattlefield(options: { excludeSource?: true } = {}): Effect {
  return {
    op: "drawPerBattlefield",
    ...(options.excludeSource !== undefined
      ? { excludeSource: options.excludeSource }
      : {}),
  };
}

/** Threshold of the Gray — "the attacker and defender each [Add] [1]". */
export function addEnergyToEach(amount: number): Effect {
  return { op: "addEnergyToEach", amount };
}

/** Scuttle Crab — "You can look at their facedown cards this turn." */
export function seeFacedown(duration: Duration = "thisTurn"): Effect {
  return { op: "seeFacedown", duration };
}

/** Vex, Apathetic — "They can't move it this turn." */
export function restrictMovement(duration: Duration, targetIndex = 0): Effect {
  return { op: "restrictMovement", duration, targetIndex };
}

/** Thrill of the Hunt — "Banish a friendly unit, then its owner plays it…". */
export function banishThenPlay(targetIndex = 0, destinationIndex = 1): Effect {
  return { op: "banishThenPlay", targetIndex, destinationIndex };
}

/** R818.1.c.2 — "[Cost]: Attach this gear to a unit you control." */
export function attachSelf(targetIndex = 0): Effect {
  return { op: "attachSelf", targetIndex };
}

/** Stacked Deck — "Look at the top 3 … Put 1 into your hand and recycle the rest." */
/**
 * "Choose an opponent. They score 1 point." Omit `targetIndex` for the plain
 * "score 1 point", which is the ability's own controller scoring.
 */
export function scorePoint(amount = 1, targetIndex?: number): Effect {
  return {
    op: "scorePoint",
    amount,
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

/**
 * R424 — "Reveal N cards from [zone]". Omit `count` for R424.3.a's whole zone
 * ("reveal your hand"); omit `targetIndex` for your own.
 */
export function reveal(
  from: "mainDeck" | "hand",
  count?: number,
  targetIndex?: number,
): Effect {
  return {
    op: "reveal",
    from,
    ...(count !== undefined ? { count } : {}),
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

/** R422 — "Discard X". Omit `targetIndex` for "discard X" (yourself). */
export function discard(count: number, targetIndex?: number): Effect {
  return {
    op: "discard",
    count,
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

/** R440 — "[Burn X]": the top X of a Main Deck into that player's trash. */
export function burn(count: number, targetIndex?: number): Effect {
  return {
    op: "burn",
    count,
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

/** R416 — "Recycle N cards from your hand." */
export function recycleFromHand(count: number): Effect {
  return { op: "recycleFromHand", count };
}

/** R436.3 — "Predict X". [Vision] (R817) is `predict(1)`. */
export function predict(count = 1): Effect {
  return { op: "predict", count };
}

export function lookAtTop(count: number, keep: number): Effect {
  return { op: "lookAtTop", count, keep };
}

/** Sabotage — "Choose a non-unit card from it, and recycle that card." */
export function recycleFromOpponentHand(exclude?: "unit"): Effect {
  return {
    op: "recycleFromOpponentHand",
    ...(exclude !== undefined ? { exclude } : {}),
  };
}

/** R420 — Irresistible Faefolk's "move an enemy unit to that battlefield". */
export function moveUnit(
  to: "sourceLocation" | "base" = "sourceLocation",
  targetIndex = 0,
): Effect {
  return { op: "moveUnit", targetIndex, to };
}

/**
 * R355.2.b / R822.1.d — rules text widening where a unit may be played.
 * [Ambush] itself is a keyword, not this: R822.4 makes having it a
 * characteristic other cards check.
 */
export function playPermission(
  permission: PlayPermission,
): PlayPermissionAbility {
  return { kind: "playPermission", permission };
}

/** Rengar, Trophy Hunter — "I can be played to a battlefield where there are enemy units." */
export const ambushEnemyBattlefields = playPermission({
  kind: "whereEnemyUnits",
});

// Conditions (R383.2.a.1). `ifThen` is the effect-level form — the conditional
// statement that sits *after* the instruction. The trigger-level form is a
// `requires` on the ability itself, not a builder.

export function ifThen(
  test: Condition,
  then: Effect,
  otherwise?: Effect,
): Effect {
  return {
    op: "conditional",
    test,
    then,
    ...(otherwise !== undefined ? { otherwise } : {}),
  };
}

/**
 * R812 — Noxus Hopeful's "[Legion] — I cost [2] less." The keyword is
 * shorthand for the condition, so the builder takes the reduction and supplies
 * it (R812.1.b.1).
 */
export function legionCostReduction(reduce: Partial<Cost>): CostModifierAbility {
  return { kind: "costModifier", reduce, when: { kind: "legion" } };
}

/**
 * R356.2.b — Pyke, Dockside Butcher's "You may pay [Fury] as an additional
 * cost to play me". Omit `optional` for R356.2.a's mandatory kind.
 */
/**
 * R820 — "[Repeat] [Cost]". Several on one card are independent of each other
 * (R820.1.c.2), so a card that prints three carries three of these.
 */
export function repeat(...costs: (Partial<Cost> | AbilityCost)[]): RepeatAbility {
  return { kind: "repeat", costs: costs.map(asAbilityCost) };
}

/**
 * Syndra, Transcendent — "While I'm in a showdown, your spells have [Repeat]
 * [2][Chaos]"; Kennen — "give it [Flow] equal to its cost this turn". Granting
 * a keyword whose value is a Cost rather than a number.
 */
export function grantCostKeyword(
  keyword: CostKeyword["keyword"],
  ...costs: (Partial<Cost> | AbilityCost)[]
): Modification {
  return {
    layer: "ability",
    op: "grantCostKeyword",
    keyword,
    costs: costs.map(asAbilityCost),
  };
}

/**
 * A bare resource amount is the common case, so the cost-keyword builders take
 * one directly; anything else is already an `AbilityCost`.
 */
function asAbilityCost(each: Partial<Cost> | AbilityCost): AbilityCost {
  return "kind" in each ? each : { kind: "pay", cost: { ...FREE, ...each } };
}

/**
 * R356.3 / R356.4 — a board ability that changes what *other* cards cost.
 * Helm of Suppression: `costAura({ affects: "enemy", match: { type: "spell" },
 * increase: { energy: 1 } })`.
 */
export function costAura(
  spec: Omit<CostAuraAbility, "kind">,
): CostAuraAbility {
  return { kind: "costAura", ...spec };
}

/**
 * Syndra, Transcendent — "your spells have [Repeat] [2][Chaos]". A board
 * ability granting a cost-valued keyword to cards that are not permanents.
 */
export function keywordAura(
  spec: Omit<KeywordAuraAbility, "kind" | "costs"> & {
    costs: (Partial<Cost> | AbilityCost)[];
  },
): KeywordAuraAbility {
  const { costs, ...rest } = spec;
  return { kind: "keywordAura", ...rest, costs: costs.map(asAbilityCost) };
}

/**
 * "Each player draws 1." The inner effect names the player it is running for
 * by `targetIndex`, counting past whatever the outer effect already chose.
 */
export function forEachPlayer(
  each: Effect,
  who: "each" | "eachOpponent" = "each",
): Effect {
  return { op: "forEachPlayer", who, each };
}

/**
 * A printed "can't" — one builder for the whole family, since they are one
 * sentence with a different verb.
 *
 * `scope` says whose action is forbidden: `{ target: "self" }` for "I can't be
 * readied", `{ target: "allUnits" }` for Minotaur Reckoner's "Units can't move
 * to base".
 */
export function restrict(
  restriction: Restriction,
  scope: PassiveScope = { target: "self" },
  when?: PassiveCondition,
): PassiveAbility {
  return passive(scope, { layer: "ability", op: "restrict", restriction }, when);
}

/**
 * A "can't" whose subject is not a permanent — a player, a battlefield, a
 * spell on the chain. Swept off the board rather than layered; see
 * `restrictions.ts` for why the family is split in two.
 */
export function restrictionAura(
  what: RestrictionAuraAbility["what"],
  affects: RestrictionAuraAbility["affects"],
  rest: Omit<RestrictionAuraAbility, "kind" | "what" | "affects"> = {},
): RestrictionAuraAbility {
  return { kind: "restrictionAura", what, affects, ...rest };
}

/**
 * Brynhir — "opponents can't play cards this turn". A board restriction with a
 * duration, aimed at a chosen player.
 */
export function restrictPlayer(
  restriction: Omit<BoardRestriction, "affects">,
  duration: Duration = "thisTurn",
  targetIndex = 0,
): Effect {
  return { op: "restrictPlayer", restriction, duration, targetIndex };
}

/** "I can't be chosen by enemy spells and abilities." */
export function untargetable(
  by: "enemy" | "any" = "enemy",
  when?: PassiveCondition,
): PassiveAbility {
  return restrict(
    { what: "beChosen", ...(by === "enemy" ? { by } : {}) },
    { target: "self" },
    when,
  );
}

/** One arm of a "Choose one —", with whatever that arm chooses for itself. */
export function mode(effect: Effect, targeting?: Targeting): Mode {
  return { effect, ...(targeting !== undefined ? { targeting } : {}) };
}

/**
 * R827 — "[Empower] [Cost]": an activated ability that Empowers its own
 * source, playable only while it is not already Empowered (R827.1.c.1).
 */
export function empower(
  ...costs: (Partial<Cost> | AbilityCost)[]
): EmpowerAbility {
  return { kind: "empower", costs: costs.map(asAbilityCost) };
}

/**
 * R828 — "[Empowered][>] [Text]": "While I have the Empowered status, this
 * card gains '[Text]'."
 *
 * R828.1.d is why the granted ability is usually a trigger: an Empowered
 * ability whose condition is "when I become Empowered" is active in time to
 * fire on the event that switched it on.
 */
export function empowered(ability: Ability): PassiveAbility {
  return passive(
    { target: "self" },
    { layer: "ability", op: "grantAbility", ability },
    { when: "empowered" },
  );
}

/**
 * R824 — "[Level N][>] [Text]": "While you have [N] or more XP, this card
 * gains '[Text]'." The same sentence as [Empowered] with a different
 * condition, so it is the same modification.
 */
export function level(n: number, ability: Ability): PassiveAbility {
  return passive(
    { target: "self" },
    { layer: "ability", op: "grantAbility", ability },
    { when: "xpAtLeast", amount: n },
  );
}

/**
 * R829 — "[Flow] [Cost]": play it from your trash for this instead of its
 * printed cost, then it is banished rather than trashed again.
 */
export function flow(...costs: (Partial<Cost> | AbilityCost)[]): FlowAbility {
  return { kind: "flow", costs: costs.map(asAbilityCost) };
}

export function additionalCost(
  cost: Cost | AbilityCost | (Cost | AbilityCost)[],
  /** R356.2.a.1 — an additional cost with no "may" on it is mandatory. */
  optional = true,
): AdditionalCostAbility {
  const list = Array.isArray(cost) ? cost : [cost];
  return {
    kind: "additionalCost",
    costs: list.map(asAbilityCost),
    ...(optional ? { optional } : {}),
  };
}

/** Astral Heron — "your next card costs [2][A][A] less". */
export function discountNextCard(reduce: Cost): Effect {
  return { op: "discountNextCard", reduce };
}

/** R383.2.a.1 — a gate made of several clauses that must all be true. */
export function allOf(...of: Condition[]): Condition {
  return { kind: "all", of };
}

/** Back Off — "If you played this from your hand, draw 1." */
export function playedFrom(zone: PlaySource): Condition {
  return { kind: "playedFrom", zone };
}

/** Evelynn, Entrancing — "…on your turn". */
export const onYourTurn: Condition = { kind: "yourTurn" };

/** R205 — "if you paid the additional cost". */
export const paidAdditionalCost: Condition = { kind: "paidAdditionalCost" };

/** Vex, Apathetic — "while I'm at a battlefield". */
export const atBattlefield: Condition = { kind: "sourceAtBattlefield" };

/** Kinkou Initiate — "if your other units have total Might 5 or more". */
export function otherUnitsTotalMight(atLeast: number): Condition {
  return { kind: "totalMight", of: "otherFriendlyUnits", atLeast };
}

/**
 * En Garde — "if it is the only unit you control there"; Kha'Zix, Mutating
 * Horror — "if an enemy unit is alone here".
 */
export function aloneThere(
  subject: "source" | "target",
  units: "friendly" | "enemy",
  targetIndex?: number,
): Condition {
  return {
    kind: "aloneThere",
    subject,
    units,
    ...(targetIndex !== undefined ? { targetIndex } : {}),
  };
}

// Passive abilities (R477). These modify characteristics rather than resolving,
// so they never touch the chain — the layer pipeline reads them live.

export function passive(
  scope: PassiveScope,
  modification: Modification,
  condition?: PassiveCondition,
): PassiveAbility {
  return {
    kind: "passive",
    scope,
    modification,
    ...(condition !== undefined ? { condition } : {}),
  };
}

/** Garen, Commander — "Other friendly units have +1 Might here." */
export function anthemMight(amount: number, here = true): PassiveAbility {
  return passive({ target: "otherFriendlyUnits", here }, {
    layer: "arithmetic",
    op: "addMight",
    amount,
  });
}

/**
 * Petal Pixie — "I have +1 Might for each of your units with [Temporary] at my
 * battlefield." A passive on the counting unit itself, since the subject of
 * "I have" is the source.
 */
export function mightPerUnit(
  amount: number,
  count: Extract<Modification, { op: "addMightPer" }>["count"],
): PassiveAbility {
  return passive({ target: "self" }, {
    layer: "arithmetic",
    op: "addMightPer",
    amount,
    count,
  });
}

/** Captain Farron — "Other friendly units here have [Assault]." */
export function anthemKeyword(
  keyword: Keyword,
  here = true,
  value?: number,
): PassiveAbility {
  return passive({ target: "otherFriendlyUnits", here }, {
    layer: "ability",
    op: "grantKeyword",
    keyword,
    ...(value !== undefined ? { value } : {}),
  });
}

/** A spell's rules text lives as a single ability holding its effect. */
export function spell(
  id: string,
  name: string,
  cost: Cost,
  effect: Effect,
  keywords: Keyword[] = [],
): CardInstance {
  return {
    id,
    name,
    type: "spell",
    cost,
    keywords,
    abilities: [activated([], effect, "default")],
  };
}

/**
 * A basic rune (R164.2): exhaust for 1 Energy, or recycle for 1 Power of its
 * own domain. Both abilities are printed with [Reaction].
 */
export function basicRune(id: string, domain: Domain): CardInstance {
  return {
    id,
    // R164 — a basic rune is a printed card, and the pool prints them in title
    // case ("Body Rune"). Matching the printed name is what lets anything
    // keyed on it — the UI's card art, a card that names a rune — find it.
    name: `${domain[0]!.toUpperCase()}${domain.slice(1)} Rune`,
    // R164.2 — a rune's two abilities. R416 puts no ready requirement on the
    // recycle, so one rune yields an energy *and* a power.
    text: `[Reaction] Exhaust: Add [1]. [Reaction] Recycle: Add [${domain}].`,
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
