import type {
  Ability,
  AbilityCost,
  BoardRestriction,
  Effect,
  PassiveAbility,
} from "./abilities.js";
import { sameLocation, seatOf } from "./state.js";
import type {
  CardId,
  CardInstance,
  CardType,
  Cost,
  Domain,
  GameState,
  Keyword,
  Location,
  PermanentState,
  PlayerId,
  PowerCount,
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
/**
 * R820.4 / R829.2 / R827.4 — [Repeat], [Flow] and [Empower] are characteristics
 * like any other keyword, but the value each carries is a `Cost` rather than a
 * number, which is why they cannot ride in `keywords` beside [Assault 2].
 *
 * A list rather than a map: R820.1.c.2 and R829.1.c.3 both let one card carry
 * several with different costs, and R827.3 makes several [Empower]s "equivalent
 * to multiple activated abilities".
 */
export interface CostKeyword {
  keyword: "repeat" | "flow" | "empower";
  /**
   * R820.1.c.2, R827.1.c.2 and R829.1.c.2 all allow non-resource costs, so
   * this is what an ability costs generally rather than a bare `Cost`. The
   * resource half is priced through R356; the rest is paid as the card is
   * played, the way any other ability cost is.
   */
  costs: AbilityCost[];
}

/**
 * The resource half of a compound cost, which is the only half R356's pricing
 * pipeline can see. `payAbilityCost` handles the rest.
 */
export function resourcePartOf(costs: AbilityCost[]): Cost {
  let total: Cost = { energy: 0, power: {}, anyPower: 0 };
  for (const each of costs) {
    if (each.kind !== "pay") continue;
    const power: PowerCount = { ...total.power };
    for (const [domain, amount] of Object.entries(each.cost.power)) {
      const key = domain as keyof PowerCount;
      power[key] = (power[key] ?? 0) + amount;
    }
    total = {
      energy: total.energy + each.cost.energy,
      power,
      anyPower: total.anyPower + each.cost.anyPower,
    };
  }
  return total;
}

export interface Characteristics {
  might: number;
  /**
   * Which keywords this has, deduplicated — R8xx's "whether or not it has X is
   * a characteristic" is a yes/no question, and most keywords are redundant in
   * multiples (R816.2, R819.2, R822.2).
   */
  keywords: Keyword[];
  /**
   * How many instances of each, for the keywords where that matters: R817.2
   * ([Vision]) and R821.1.c.7 ([Weaponmaster]) both say multiple instances
   * trigger separately, which a set cannot express.
   */
  keywordCounts: Partial<Record<Keyword, number>>;
  /** R820/R827/R829 — the keywords whose value is a Cost. */
  costKeywords: CostKeyword[];
  /** R807.2 — Assault values from every source are summed, not redundant. */
  assault: number;
  /** R814.2 — likewise for Shield. */
  shield: number;
  /** R809.2 — likewise for Deflect: granted values are summed, not redundant. */
  deflect: number;
  /** R823.2 — and likewise for Hunt. */
  hunt: number;
  /**
   * Every "can't" currently on this object, with its qualifiers. Collected by
   * the pipeline like anything else, so a printed restriction, one granted by
   * an attachment and one gated on [Level 16] are the same question.
   *
   * `beChosen` bites only where something *chooses* (R355.5), so combat damage
   * assignment is untouched: R465.2.c assigns, it does not choose.
   */
  restrictions: Restriction[];
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

/**
 * The game actions a card can forbid. Seventeen cards in the pool say some
 * form of "can't", and they are one sentence with a different verb — "I can't
 * be chosen by enemy spells and abilities", "they can't move it this turn",
 * "I can't be readied", "I can't be dealt damage unless I'm in combat". One
 * vocabulary rather than one mechanism each, because the alternative is eight
 * near-identical readers that drift apart one card at a time. That had already
 * started: `untargetableBy` was read through the layer pipeline and movement
 * was read off a flat modifier scan, so a *passive* could restrict targeting
 * and could not restrict movement.
 */
export type RestrictedAction =
  /** R355.5 — "I can't be chosen by enemy spells and abilities." */
  | "beChosen"
  /** Vex, Determined Sentry, Minotaur Reckoner, Vilemaw's Lair. */
  | "move"
  /** R415 — Maduli the Gatekeeper's "I can't be readied". */
  | "beReadied"
  /** R437 — Ambessa's "can't be dealt damage unless I'm in combat". */
  | "beDealtDamage"
  /**
   * LeBlanc, Everywhere at Once — "Your [Temporary] effects at my battlefield
   * don't trigger." The keyword stays: R816.2's redundancy, Petal Pixie's
   * count and "a unit *without* [Temporary]" all still see it. What stops is
   * the ability it stands for, which is what "effects … don't trigger" says.
   */
  | "keywordTrigger";

export interface Restriction {
  what: RestrictedAction;
  /**
   * R355.5's "by *enemy* spells and abilities" — relative to the restricted
   * object's controller. Absent forbids it to everyone, which is why "any"
   * outranks "enemy" without a precedence rule: an unqualified restriction
   * bites whoever asks.
   */
  by?: "enemy";
  /**
   * "I can't move *to base*". Absent is Vex's "they can't move it", which is
   * every destination.
   */
  to?: "base";
  /**
   * Mageseeker Warden — "*spells and abilities* can't ready enemy units and
   * gear", which leaves R315.1's Awaken step alone. Absent forbids the action
   * however it arises.
   */
  source?: "effect";
  /**
   * Which keyword's derived ability is suppressed, for `keywordTrigger`. Only
   * the named one stops: LeBlanc silences [Temporary] and leaves [Vision] and
   * [Quick-Draw] alone.
   */
  keyword?: Keyword;
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
   * Every "can't" on an object. A restriction rather than a characteristic,
   * but it lives here so a durational one (Vex's "this turn") expires the way
   * everything else with a duration does (R317.2.c), and a passive one reaches
   * the same reader a granted one does.
   */
  | { layer: "ability"; op: "restrict"; restriction: Restriction }
  /**
   * Brynhir, Lilting Lullaby — a board restriction with a duration. It rides
   * the modifier list so R317.2.c expires it, and its `targetId` is a *player*
   * rather than a permanent: R133 makes a player a Game Object, and `PlayerId`
   * is a `CardId` structurally, so nothing about the list needed widening.
   * `restrictions.ts` reads it; the layer pipeline below skips it, because a
   * permanent is not its subject.
   */
  | {
      layer: "ability";
      op: "restrictPlayer";
      restriction: Omit<BoardRestriction, "affects">;
    }
  /**
   * Scuttle Crab — "You can look at their facedown cards this turn."
   *
   * R424.2.b is why this is not a Reveal: "a player may choose to show Private
   * information to one or more other players. This does not count as revealing
   * and does not trigger any effects that trigger when cards are revealed." So
   * it changes nothing about the game and everything about `viewOf` — which is
   * exactly where R107 lives. `targetId` is the player who may look, and like
   * `restrictPlayer` it rides the modifier list so R317.2.c ends it.
   */
  | { layer: "ability"; op: "seeFacedown" }
  /**
   * Fizz, Trickster — "you may play a spell from your trash with Energy cost
   * no more than [3], ignoring its Energy cost. Recycle that spell after you
   * play it."
   *
   * A permission granted to a *player*, so it rides the modifier list beside
   * the other two whose subject is one. `playZonesFor` reads it and offers the
   * play beside [Flow]'s, which opens the same door for a different reason.
   */
  | {
      layer: "ability";
      op: "playFromTrash";
      cardType?: CardType;
      /** Read as printed — R711 leaves a card in the trash on printed values. */
      maxEnergy?: number;
      waiveEnergy?: true;
      recycleOnLeave?: true;
    }
  /** Vilemaw — "…don't deal combat damage." See `Characteristics.silenced`. */
  | { layer: "ability"; op: "silenceCombatDamage" }
  /**
   * R824.1.b.1 / R828.1.b.1 — a Dependent Keyword's "this card gains
   * '[Text]'". [Level N] and [Empowered] are the same sentence with different
   * conditions, so both are this modification under a `PassiveCondition`
   * rather than two mechanisms.
   *
   * R477.2 puts granting rules text in the ability layer beside granting a
   * keyword, which is also why a granted ability can itself grant Might: the
   * fixpoint runs the arithmetic layer again after it.
   */
  | { layer: "ability"; op: "grantAbility"; ability: Ability }
  /**
   * Syndra, Transcendent — "your spells have [Repeat] [2][Chaos]"; Kennen —
   * "[Flow] equal to its cost this turn". Separate from `grantKeyword` because
   * the value is a Cost, and R820.1.c.2 makes each instance independent rather
   * than redundant.
   */
  | {
      layer: "ability";
      op: "grantCostKeyword";
      keyword: CostKeyword["keyword"];
      costs: AbilityCost[];
    }
  /** R477.3 — the mathematics of raising and lowering Might. */
  | { layer: "arithmetic"; op: "addMight"; amount: number }
  /**
   * Petal Pixie — "I have +1 Might **for each** of your units with [Temporary]
   * at my battlefield"; Sett, Kingpin — "for each buffed friendly unit at my
   * battlefield". The amount is a count of the board rather than a number, so
   * it is resolved when the modification is collected and moves the moment the
   * board does.
   */
  | {
      layer: "arithmetic";
      op: "addMightPer";
      /** Per matching object found. */
      amount: number;
      count: {
        /** Relative to the counting permanent's controller. */
        controller?: "friendly" | "enemy";
        keyword?: Keyword;
        buffed?: true;
        /** "…at my battlefield". */
        here?: true;
        /** R355.5's "another" — never count yourself. */
        excludeSelf?: true;
      };
    }
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
    }
  /**
   * Minotaur Reckoner — "*Units* can't move to base", with no side named, and
   * Vilemaw's Lair's "Units can't move from here to base" with `here`. The
   * only scope that reaches both players' units, which is why the restrictions
   * needed it and no anthem did.
   */
  | { target: "allUnits"; here?: boolean; tag?: string; keyword?: Keyword };

/**
 * When a passive applies. Absent means always. `mighty` is R708 (Might 5+) and
 * is deliberately evaluated against the *current* pass, not printed Might —
 * that is the dependency R476.2's recursion exists to resolve.
 */
export type PassiveCondition =
  | { when: "attacking" }
  | { when: "defending" }
  | { when: "mighty" }
  /** R441.2 — the Empowered status, which R441.1.a makes strictly binary. */
  | { when: "empowered" }
  /**
   * R824.1.b.1 — "[Level N]": "while you have [N] or more XP". Asked of the
   * *current controller* (R824.1.c.1), so a unit changing hands can gain or
   * lose the ability without anything else happening.
   */
  | { when: "xpAtLeast"; amount: number }
  /**
   * Ambessa — "unless I'm *in combat*", which is either designation. Distinct
   * from `attacking` and `defending`, which R807.1.d.1 ties to one side.
   */
  | { when: "inCombat" };

interface PendingModification {
  modification: Modification;
  condition: PassiveCondition | undefined;
  /** The negated half — see `PassiveAbility.unless`. */
  unless?: PassiveCondition;
  applied: boolean;
}

/**
 * The `seen` set for reading one source's rules text: everything on the board
 * except that source.
 *
 * Reading a source through the pipeline is what catches copied rules text
 * (R477.1.b). Letting *that* read recurse into every other permanent is what
 * made the pipeline exponential — memoising bounds recomputing the same
 * (card, seen) pair, but the number of distinct pairs is the number of
 * reachable subsets of the board, which is not bounded at all.
 *
 * So the read is stopped one level down: the source's own text is resolved
 * through the layers, and the sources *it* would read are resolved on printed
 * values, which is what R711 gives anything the pipeline declines to enter.
 * A copy of a copy therefore resolves; a passive granted to a card by another
 * card's passive, where that grant then changes a third card, does not.
 * Written up as a deviation.
 */
function oneLevel(
  state: GameState,
  seen: ReadonlySet<CardId>,
  except: CardId,
): ReadonlySet<CardId> {
  const bounded = new Set(seen);
  for (const cardId of Object.keys(state.permanents)) {
    if (cardId !== except) bounded.add(cardId);
  }
  return bounded;
}

/**
 * Whether a source's rules text could differ from what it printed.
 *
 * R477.1.b's copy and R477.2's granted ability are the only two things that
 * rewrite it — a copy modifier or a granted one aimed at this card, or a
 * printed passive that grants an ability to itself ([Empowered], [Level]).
 * Anything else reads the same off the card as it does through the pipeline,
 * at a fraction of the cost.
 */
function rulesTextCanDiffer(
  state: GameState,
  source: PermanentState,
  card: CardInstance,
): boolean {
  for (const modifier of state.modifiers) {
    if (modifier.targetId !== source.cardId) continue;
    const op = modifier.modification.op;
    if (op === "copyOf" || op === "grantAbility") return true;
  }
  return card.abilities.some(
    (ability) =>
      ability.kind === "passive" && ability.modification.op === "grantAbility",
  );
}

/** Every passive on the board that could modify `subject`. */
function passivesFor(
  state: GameState,
  subject: PermanentState,
  seen: ReadonlySet<CardId>,
): PendingModification[] {
  const found: PendingModification[] = [];

  // R190 — a battlefield is a Game Object with rules text, and Black Flame
  // Altar's "Units here with [Temporary] have [Shield]" is a passive like any
  // other. It is not a permanent, so it is not in `state.permanents`; a
  // battlefield's "here" is itself, which is the whole of what it needs to
  // stand in as a source.
  const battlefieldSources: PermanentState[] = state.battlefieldOrder.map(
    (battlefieldId) => ({
      cardId: battlefieldId,
      // R190.6.d — an uncontrolled battlefield has no "you", so a scope that
      // names a side finds nobody. `inScope` compares controllers, and
      // `controllerOf` falls back to p1 for anything it cannot place, which
      // would silently make an uncontrolled battlefield p1's. Naming the
      // controller explicitly is what stops that.
      controller: state.battlefields[battlefieldId]?.controller ?? "p1",
      exhausted: false,
      location: { kind: "battlefield", id: battlefieldId },
      damage: 0,
    }),
  );

  for (const source of [
    ...Object.values(state.permanents),
    ...battlefieldSources,
  ]) {
    const card = state.cards[source.cardId];
    if (card === undefined) continue;
    // R190.6.d — an uncontrolled battlefield has no "you", so its passives
    // that name a side are ignored. `allUnits` is the one scope that names
    // none, which is why Black Flame Altar works on a battlefield nobody
    // holds and an anthem over "your units" would not.
    const unheld =
      state.battlefields[source.cardId] !== undefined &&
      state.battlefields[source.cardId]?.controller == null;

    // A source that has become a copy of something grants the *copied* rules
    // text, so its abilities have to be read through the layers too — but only
    // *that* source does. Reading every permanent's text through the pipeline
    // made this mutually recursive across the whole board, which is a walk
    // over every ordering of it: fine at four permanents, and it hung the
    // process outright at nine. Two things can make a card's rules text differ
    // from what it prints, and both are cheap to test for.
    const abilities =
      source.cardId === subject.cardId || !rulesTextCanDiffer(state, source, card)
        ? card.abilities
        : characteristicsOf(state, source.cardId, oneLevel(state, seen, source.cardId))
            .abilities;

    for (const ability of abilities) {
      if (ability.kind !== "passive") continue;
      if (unheld && ability.scope.target !== "allUnits") continue;
      if (!inScope(state, ability, source, subject, seen)) continue;
      found.push({
        modification: ability.modification,
        condition: ability.condition,
        ...(ability.unless === undefined ? {} : { unless: ability.unless }),
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
  // Black Flame Altar — "Units here **with [Temporary]**". Read through the
  // pipeline, so a unit given the keyword qualifies as surely as one printing
  // it; `seen` guards the recursion the copy layer can open.
  if (
    scope.target === "allUnits" &&
    scope.keyword !== undefined &&
    !characteristicsOf(state, subject.cardId, seen).keywords.includes(
      scope.keyword,
    )
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

    case "allUnits": {
      if (state.cards[subject.cardId]?.type !== "unit") return false;
      if (ability.scope.here === true) {
        return sameLocation(source.location, subject.location);
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
  state: GameState,
  condition: PassiveCondition | undefined,
  subject: PermanentState,
  might: number,
): boolean {
  if (condition === undefined) return true;

  switch (condition.when) {
    // R441.1.a — "Empowered is a binary state."
    case "empowered":
      return subject.empowered === true;
    // R824.1.c.1 — read against whoever controls it *now*.
    case "xpAtLeast":
      return (
        seatOf(state, controllerOf(state, subject.cardId)).xp >=
        condition.amount
      );
    // R807.1.d.1 / R814.1.d.1 — tied to the designation, not to being in combat.
    case "attacking":
      return subject.designation === "attacker";
    case "defending":
      return subject.designation === "defender";
    case "inCombat":
      return subject.designation !== undefined;
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
 * How many permanents match, for the "for each" Might modifications.
 *
 * Read through the pipeline on the counted objects too — Petal Pixie counts
 * units *with [Temporary]*, and a unit given [Temporary] by Shadow's Call
 * counts as surely as one that printed it. `seen` is what keeps that safe
 * inside the copy layer's recursion.
 */
function countMatching(
  state: GameState,
  subject: PermanentState,
  count: Extract<Modification, { op: "addMightPer" }>["count"],
  seen: ReadonlySet<CardId>,
): number {
  const mine = controllerOf(state, subject.cardId);

  return Object.values(state.permanents).filter((permanent) => {
    if (count.excludeSelf === true && permanent.cardId === subject.cardId) {
      return false;
    }
    if (count.here === true && !sameLocation(subject.location, permanent.location)) {
      return false;
    }
    const its = controllerOf(state, permanent.cardId);
    if (count.controller === "friendly" && its !== mine) return false;
    if (count.controller === "enemy" && its === mine) return false;
    if (count.buffed === true && permanent.buffed !== true) return false;
    if (count.keyword !== undefined) {
      // The counted object's *own* characteristics, guarded against a cycle:
      // counting a unit whose Might depends on this count would not terminate.
      const theirs = seen.has(permanent.cardId)
        ? state.cards[permanent.cardId]?.keywords ?? []
        : characteristicsOf(state, permanent.cardId, seen).keywords;
      if (!theirs.includes(count.keyword)) return false;
    }
    return true;
  }).length;
}

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
 * Whether some game action is forbidden for `cardId` right now.
 *
 * The single reader for every "can't" in the pool. It goes through
 * `characteristicsOf` rather than scanning `state.modifiers`, which is what
 * lets a *passive* restrict an action — Minotaur Reckoner's "Units can't move
 * to base" is a passive over every unit, and the old flat scan could not see
 * it. A durational restriction (Vex's "this turn") is a stored modifier and
 * reaches the same pipeline, so both shapes answer here.
 */
export function restricted(
  state: GameState,
  cardId: CardId,
  what: RestrictedAction,
  context: {
    /** Who is trying to do it — for "by *enemy* spells and abilities". */
    actor?: PlayerId;
    /** Where a move is going, for a restriction that names a destination. */
    to?: Location;
    /**
     * Whether a spell or ability is doing this, rather than the game itself.
     * R315.1's Awaken readies without any spell or ability, which is what
     * Mageseeker Warden's "spells and abilities can't ready enemy units"
     * leaves alone.
     */
    bySpellOrAbility?: boolean;
  } = {},
): boolean {
  return characteristicsOf(state, cardId).restrictions.some((restriction) => {
    if (restriction.what !== what) return false;
    // Unqualified restrictions bite whoever asks, including the controller.
    if (restriction.by === "enemy") {
      if (context.actor === undefined) return false;
      if (controllerOf(state, cardId) === context.actor) return false;
    }
    // A restriction naming a destination only bites on that destination. With
    // no destination in hand the question is "is it restricted at all", which
    // a narrower restriction does not answer yes to.
    if (restriction.to !== undefined) {
      if (context.to === undefined) return false;
      if (context.to.kind !== "base") return false;
    }
    if (restriction.source === "effect" && context.bySpellOrAbility !== true) {
      return false;
    }
    return true;
  });
}

/**
 * Vex, Apathetic — "They can't move it this turn." Determined Sentry — "I
 * can't move to base."
 */
export function movementRestricted(
  state: GameState,
  cardId: CardId,
  destination?: Location,
): boolean {
  return restricted(state, cardId, "move", {
    ...(destination === undefined ? {} : { to: destination }),
  });
}

/**
 * Whether `chooser` may choose `cardId` at all (R355.5). Read through the
 * layers, so a printed "I can't be chosen by enemy spells and abilities", a
 * granted one, and one gated on "unless I'm in combat" are the same question.
 */
export function targetingRestricted(
  state: GameState,
  cardId: CardId,
  chooser: PlayerId,
): boolean {
  return restricted(state, cardId, "beChosen", { actor: chooser });
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
/**
 * The cost-valued keywords a card prints. Authored as ability entries rather
 * than as a card field, because each carries a whole `Cost` and a card may
 * print several of the same one.
 */
function printedCostKeywords(card: CardInstance | undefined): CostKeyword[] {
  const out: CostKeyword[] = [];
  for (const ability of card?.abilities ?? []) {
    if (
      ability.kind === "repeat" ||
      ability.kind === "flow" ||
      ability.kind === "empower"
    ) {
      out.push({ keyword: ability.kind, costs: ability.costs });
    }
  }
  return out;
}

/** R802 — one instance of each printed keyword to start with. */
function printedCounts(keywords: Keyword[]): Partial<Record<Keyword, number>> {
  const counts: Partial<Record<Keyword, number>> = {};
  for (const keyword of keywords) {
    counts[keyword] = (counts[keyword] ?? 0) + 1;
  }
  return counts;
}

function withDerivedKeywords(keywords: Keyword[]): Keyword[] {
  return keywords.includes("quickDraw") && !keywords.includes("reaction")
    ? [...keywords, "reaction"]
    : keywords;
}

/**
 * A per-state memo for `characteristicsOf`.
 *
 * Not an optimisation so much as a correctness bound on running time. The
 * pipeline is genuinely mutually recursive: working out what one permanent's
 * characteristics are means reading every *other* permanent's rules text
 * through the pipeline too, because a source that has become a copy grants the
 * text it copied. Each of those reads does the same. Unmemoised, that walks
 * every ordering of the board — factorial in the number of permanents, which
 * is fine at four and hangs the process at nine.
 *
 * `GameState` is immutable, so a state is a safe cache key: nothing that could
 * change an answer can change without a new state object. The `seen` set is
 * part of the key because it changes the answer — R711 hands back printed
 * values inside a copy cycle.
 *
 * A `WeakMap` means a discarded state's memo is collected with it, which
 * matters when `legalActions` builds a few hundred candidate states.
 */
const MEMO = new WeakMap<GameState, Map<string, Characteristics>>();

/**
 * The cache key for a `seen` set, computed once per set rather than once per
 * lookup. A frame builds one `nested` set and hands it to every recursive call
 * it makes, so keying by the set's identity turns what was a sort per call
 * into a sort per frame — which was the whole cost of the memo when it was
 * first added, and swamped the work it was there to avoid.
 */
const SEEN_KEYS = new WeakMap<ReadonlySet<CardId>, string>();

function seenKeyOf(seen: ReadonlySet<CardId>): string {
  if (seen.size === 0) return "";
  let key = SEEN_KEYS.get(seen);
  if (key === undefined) {
    key = [...seen].sort().join(",");
    SEEN_KEYS.set(seen, key);
  }
  return key;
}

export function characteristicsOf(
  state: GameState,
  cardId: CardId,
  seen: ReadonlySet<CardId> = new Set(),
): Characteristics {
  // The `seen` set is part of the key because it changes the answer: R711
  // hands back printed values inside a copy cycle.
  const suffix = seenKeyOf(seen);
  const key = suffix === "" ? cardId : `${cardId}|${suffix}`;

  let memo = MEMO.get(state);
  if (memo === undefined) {
    memo = new Map();
    MEMO.set(state, memo);
  }
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const computed = computeCharacteristics(state, cardId, seen);
  memo.set(key, computed);
  return computed;
}

function computeCharacteristics(
  state: GameState,
  cardId: CardId,
  seen: ReadonlySet<CardId>,
): Characteristics {
  const card = state.cards[cardId];
  const printedMight = card?.might ?? 0;
  const printedKeywords = card?.keywords ?? [];

  /**
   * R711 reads anything off the board on printed values, and that is right for
   * *modification* — a unit in the trash is Mighty on printed Might alone. An
   * explicit grant aimed at a card where it lies is a different thing, and
   * cards do it: Kennen, Storm of Shuriken gives "a spell in your trash [Flow]
   * equal to its cost this turn", which is worthless if the trash cannot hold
   * it. Only cost keywords, because only they are granted that way.
   */
  const storedCostKeywords: CostKeyword[] = state.modifiers
    .filter((modifier) => modifier.targetId === cardId)
    .flatMap((modifier) =>
      modifier.modification.layer === "ability" &&
      modifier.modification.op === "grantCostKeyword"
        ? [
            {
              keyword: modifier.modification.keyword,
              costs: modifier.modification.costs,
            },
          ]
        : [],
    );

  const printed = (): Characteristics => ({
    might: printedMight,
    baseMight: printedMight,
    keywords: withDerivedKeywords([...printedKeywords]),
    keywordCounts: printedCounts(printedKeywords),
    costKeywords: [...printedCostKeywords(card), ...storedCostKeywords],
    assault: 0,
    shield: 0,
    deflect: 0,
    hunt: 0,
    restrictions: [],
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

  const pending: PendingModification[] = [
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
  let keywordCounts = printedCounts(printedKeywords);
  let costKeywords = printedCostKeywords(card);
  let granted: Ability[] = [];
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
  // R823.1.c.2 — "If X is omitted, it is presumed to be 1."
  let hunt = printedKeywords.includes("hunt") ? (card.hunt ?? 1) : 0;
  const restrictions: Restriction[] = [];
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
        if (!holds(state, entry.condition, subject, currentMight())) continue;
        // "unless X" is the exception half, so the modification applies only
        // while X does *not* hold.
        if (
          entry.unless !== undefined &&
          holds(state, entry.unless, subject, currentMight())
        ) {
          continue;
        }

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
                ...(ability.unless === undefined
                  ? {}
                  : { unless: ability.unless }),
        ...(ability.unless === undefined ? {} : { unless: ability.unless }),
                applied: false,
              });
            }
            break;
          }
          case "silenceCombatDamage":
            silenced = true;
            break;

          // Collected rather than merged. Two restrictions on one object are
          // both true at once, and a narrower one never loosens a wider one:
          // "can't be chosen by enemies" beside "can't be chosen" is still
          // "can't be chosen", which falls out of asking whether *any* of them
          // bites rather than out of a precedence rule.
          case "restrict":
            restrictions.push(entry.modification.restriction);
            break;
          // Both have a *player* as their subject, not this permanent — see
          // the modifications.
          case "restrictPlayer":
          case "seeFacedown":
          case "playFromTrash":
            break;
          // R828.1.c — "As long as the Game Object has the Empowered status,
          // the Dependent Ability will be active." Appended rather than
          // replacing: R828.1.b.1's "this card *gains*" is additive, and the
          // card keeps everything it printed.
          case "grantAbility": {
            const gained = entry.modification.ability;
            granted = [...granted, gained];
            // A granted passive that modifies *this* permanent has to join the
            // pending list by hand. `passivesFor` ran before the grant existed,
            // and it could not have seen a self-scoped one in any case: R711's
            // `seen` guard hands back printed values for the very permanent
            // being derived. R476.2's loop then runs it like any other.
            if (
              gained.kind === "passive" &&
              inScope(state, gained, subject, subject, nested)
            ) {
              pending.push({
                modification: gained.modification,
                condition: gained.condition,
                ...(gained.unless === undefined
                  ? {}
                  : { unless: gained.unless }),
                applied: false,
              });
            }
            break;
          }

          case "grantCostKeyword":
            costKeywords = [
              ...costKeywords,
              {
                keyword: entry.modification.keyword,
                costs: entry.modification.costs,
              },
            ];
            break;

          case "grantKeyword": {
            const { keyword, value } = entry.modification;
            if (!keywords.includes(keyword)) keywords = [...keywords, keyword];
            // R817.2 / R821.1.c.7 — a *second* instance is not redundant for
            // every keyword, so the tally is kept whether or not the set grew.
            keywordCounts = {
              ...keywordCounts,
              [keyword]: (keywordCounts[keyword] ?? 0) + 1,
            };
            if (keyword === "assault") assault += value ?? 1;
            if (keyword === "shield") shield += value ?? 1;
            if (keyword === "deflect") deflect += value ?? 1;
            if (keyword === "hunt") hunt += value ?? 1;
            break;
          }
          case "addMight":
          case "increaseMightTo":
            arithmetic.push(entry.modification);
            break;
          // "…+1 Might **for each** …". The count is resolved here, where the
          // board and the counting permanent are both in hand, and becomes an
          // ordinary `addMight`. R476.2's fixpoint re-runs the whole
          // collection, so the number moves the moment the board does.
          case "addMightPer": {
            const found = countMatching(
              state,
              subject,
              entry.modification.count,
              nested,
            );
            arithmetic.push({
              layer: "arithmetic",
              op: "addMight",
              amount: entry.modification.amount * found,
            });
            break;
          }
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
    keywordCounts,
    costKeywords,
    assault,
    shield,
    deflect,
    hunt,
    restrictions,
    silenced,
    ...copyable,
    abilities:
      // R718.2 — an Attached card's own Rules Text is Inactive while it is
      // attached, so it contributes nothing, granted or otherwise.
      subject.attachedTo !== undefined
        ? []
        : [...copyable.abilities, ...appended, ...granted],
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

  // R827.1.c.1 — "[Empower] [Cost]" is short for "[Cost]: Empower this. Play
  // only if not Empowered." R827.3 makes several instances "equivalent to
  // multiple activated abilities", so each expands on its own.
  for (const each of now.costKeywords) {
    if (each.keyword !== "empower") continue;
    derived.push({
      kind: "activated",
      timing: "default",
      costs: each.costs,
      effect: { op: "empowerSelf" },
      // R441.1.b — "an Empowered Game Object can not be Empowered", which is
      // a legality gate on playing the ability rather than a no-op on
      // resolution.
      when: { kind: "notEmpowered" },
    });
  }
  // LeBlanc, Everywhere at Once — "Your [Temporary] effects at my battlefield
  // don't trigger." Asked here rather than in the trigger collector because it
  // is the *ability* that is absent, not the event that is ignored: nothing
  // downstream should see a Temporary trigger it then has to skip.
  const silenced = (keyword: Keyword): boolean =>
    now.restrictions.some(
      (restriction) =>
        restriction.what === "keywordTrigger" && restriction.keyword === keyword,
    );

  if (now.keywords.includes("temporary") && !silenced("temporary")) {
    derived.push(TEMPORARY);
  }
  // R817.2 — "Multiple instances of Vision trigger separately", unlike
  // R819.2's Quick-Draw and R816.2's Temporary, which are redundant. The tally
  // is what tells the three apart.
  for (let i = 0; i < (now.keywordCounts.vision ?? 0); i += 1) {
    derived.push(VISION);
  }
  // R819.2 — "Multiple instances of Quick-Draw do not trigger separately", so
  // asking whether the keyword is present is the whole of it.
  if (now.keywords.includes("quickDraw")) derived.push(QUICK_DRAW);
  // R821.1.c.7 — "Multiple instances of Weaponmaster trigger separately, and
  // can choose different targets."
  for (let i = 0; i < (now.keywordCounts.weaponmaster ?? 0); i += 1) {
    derived.push(WEAPONMASTER);
  }
  // R823.1.c.1 — "When I Conquer or Hold, my controller gains X XP." R823.1.b
  // makes it both a Conquer and a Hold effect, which is what omitting `method`
  // says. The value is read here rather than baked into a constant, because
  // R823.2 sums granted Hunt Values onto the printed one.
  if (now.hunt > 0) {
    derived.push({
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here" },
      effect: { op: "gainXP", amount: now.hunt },
    });
  }
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
