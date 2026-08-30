import { holds } from "./conditions.js";
import type { Condition, ConditionContext } from "./conditions.js";
import {
  controllerOf,
  keywordsOf,
  mightOf,
  restricted,
  tagsOf,
} from "./layers.js";
import type { PassiveScope } from "./layers.js";
import type { Effect } from "./abilities.js";
import type { GameEvent } from "./events.js";
import type { Duration } from "./layers.js";
import { sameLocation } from "./state.js";
import type {
  CardId,
  DamageReplacement,
  GameState,
  PermanentState,
  PlayerId,
} from "./state.js";

/**
 * R369 — a replacement effect "intercedes during the execution of a Game
 * Effect and alters its execution". It is not a trigger: R370.1.a.1 is
 * explicit that replacing an event is the same as the action that generated it
 * *not occurring*, so a replaced death fires no Deathknell.
 *
 * This is R369.3's family only — "Replacement Effects that apply to a unit as
 * it enters the Board … describing how the unit enters". The general
 * mechanism, where any event can be intercepted, is staged separately; see the
 * end of `reference/mechanic-survey.md`.
 */
export interface EntryReplacement {
  /**
   * R359.2.c makes a unit enter exhausted. "I enter ready" replaces that
   * event with one where it enters ready.
   */
  ready?: true;
  /** Absent means always. Breakneck Mech's "if you control another Mech". */
  when?: Condition;
}

/**
 * Every entry replacement on a card. R805.1.a's [Accelerate] — "If you do, I
 * enter ready" — is derived from the keyword rather than written out per card,
 * which is what lets it stop being a special case at the play site.
 */
export function entryReplacementsOf(
  state: GameState,
  cardId: CardId,
): EntryReplacement[] {
  const found: EntryReplacement[] = [];

  if (keywordsOf(state, cardId).includes("accelerate")) {
    found.push({ ready: true, when: { kind: "paidAdditionalCost" } });
  }

  for (const ability of state.cards[cardId]?.abilities ?? []) {
    if (ability.kind !== "entryReplacement") continue;
    const { kind: _tag, ...replacement } = ability;
    found.push(replacement);
  }

  return found;
}

/**
 * Whether `cardId` enters ready rather than exhausted. R370.1.c — replacement
 * effects are applied "before any qualifying event has actually occurred", so
 * this is asked while the permanent is still being built, not corrected after.
 */
export function entersReady(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  context: Pick<ConditionContext, "paidAdditionalCost">,
): boolean {
  const asked: ConditionContext = {
    controller: playerId,
    sourceId: cardId,
    // R355.5's choices are already made by now, but none of these ask about
    // them: they describe how the unit itself arrives.
    targets: [],
    ...(context.paidAdditionalCost !== undefined
      ? { paidAdditionalCost: context.paidAdditionalCost }
      : {}),
  };

  return entryReplacementsOf(state, cardId).some(
    (replacement) =>
      replacement.ready === true &&
      (replacement.when === undefined || holds(state, replacement.when, asked)),
  );
}

/**
 * R369, the general form — a replacement that intercedes in an event happening
 * to some *other* object rather than describing how its own source arrives.
 *
 * Only deaths so far, which is where the cards are: Soraka, Wanderer, Zhonya's
 * Hourglass, Guardian Angel, Altar of Blood. Damage is the next chokepoint.
 */
export interface DeathReplacement {
  /** Which dying units this can intercede for, relative to its source. */
  scope: PassiveScope;
  /**
   * What happens instead. Resolved with the dying unit as target 0, so
   * "instead heal it, exhaust it, and recall it" is `seq(heal(0), exhaust(0),
   * recall(0))`.
   */
  instead: Effect;
  /** Zhonya's Hourglass — "the **next time** a friendly unit would die". */
  oncePerTurn?: true;
}

/** One replacement, matched to the death it would intercede in. */
export interface ApplicableReplacement {
  sourceId: CardId;
  controller: PlayerId;
  instead: Effect;
  /** Where its `oncePerTurn` allowance is tallied. */
  tally: string;
}

/**
 * Every replacement that could apply to `cardId` dying. R374 — a replacement's
 * controller is the controller of its source, which is who R372 may have to
 * ask about ordering.
 */
export function deathReplacementsFor(
  state: GameState,
  cardId: CardId,
): ApplicableReplacement[] {
  const dying = state.permanents[cardId];
  if (dying === undefined) return [];

  const found: ApplicableReplacement[] = [];

  for (const source of Object.values(state.permanents)) {
    const abilities = state.cards[source.cardId]?.abilities ?? [];
    abilities.forEach((ability, index) => {
      if (ability.kind !== "replacement") return;
      if (!replacementCovers(state, ability.scope, source, dying)) return;

      // R371.1 — "may only be applied to the specified number of events each
      // turn. Once they have been applied to that many, they cannot be applied
      // to a later event in the same turn."
      const tally = `replace:${source.cardId}#${index}`;
      if (ability.oncePerTurn === true && (state.triggeredThisTurn[tally] ?? 0) >= 1) {
        return;
      }

      found.push({
        sourceId: source.cardId,
        controller: controllerOf(state, source.cardId),
        instead: ability.instead,
        tally,
      });
    });
  }

  return found;
}

/**
 * Whether a replacement's scope covers this dying unit. The same shapes a
 * passive uses, because they ask the same question — "is this one of mine,
 * here, weaker than me".
 */
function replacementCovers(
  state: GameState,
  scope: PassiveScope,
  source: PermanentState,
  dying: PermanentState,
): boolean {
  // R133.8 — a tag narrows any of the unit scopes, the same way it does for a
  // passive. Read through the layers so a copy is covered by what it copied.
  if (
    scope.target !== "self" &&
    scope.tag !== undefined &&
    !tagsOf(state, dying.cardId).includes(scope.tag)
  ) {
    return false;
  }

  switch (scope.target) {
    case "self":
      return source.cardId === dying.cardId;

    case "otherFriendlyUnits":
    case "friendlyUnits": {
      if (scope.target === "otherFriendlyUnits" && source.cardId === dying.cardId) {
        return false;
      }
      if (
        controllerOf(state, source.cardId) !== controllerOf(state, dying.cardId)
      ) {
        return false;
      }
      if (state.cards[dying.cardId]?.type !== "unit") return false;
      if (scope.here === true && !sameLocation(source.location, dying.location)) {
        return false;
      }
      return true;
    }

    case "enemyUnits": {
      if (
        controllerOf(state, source.cardId) === controllerOf(state, dying.cardId)
      ) {
        return false;
      }
      if (state.cards[dying.cardId]?.type !== "unit") return false;
      if (scope.here === true && !sameLocation(source.location, dying.location)) {
        return false;
      }
      if (scope.weakerThanSource === true) {
        return mightOf(state, dying.cardId) < mightOf(state, source.cardId);
      }
      return true;
    }

    case "allUnits": {
      if (state.cards[dying.cardId]?.type !== "unit") return false;
      if (scope.here === true) {
        return sameLocation(source.location, dying.location);
      }
      return true;
    }

    default: {
      const unhandled: never = scope;
      return false;
    }
  }
}

/**
 * R369.2 / R437 — every replacement watching damage of this kind headed at
 * this unit, in creation order and before any has been applied.
 */
export function damageReplacementsFor(
  state: GameState,
  cardId: CardId,
  from: "combat" | "spellOrAbility",
): DamageReplacement[] {
  return state.damageReplacements.filter(
    (entry) =>
      (entry.targetId === undefined || entry.targetId === cardId) &&
      (entry.from === "any" || entry.from === from),
  );
}

/**
 * R372's question: do several replacements apply to this damage, so that the
 * controller of the unit has an order to choose? The order changes the number
 * — the rules' own example has prevent-then-double landing differently from
 * double-then-prevent.
 */
export function ambiguousDamage(
  state: GameState,
  cardId: CardId,
  from: "combat" | "spellOrAbility",
): CardId[] | undefined {
  const sources = [
    ...new Set(
      damageReplacementsFor(state, cardId, from).map((entry) => entry.sourceId),
    ),
  ];
  return sources.length > 1 ? sources : undefined;
}

/**
 * Damage on its way to a unit, after every replacement has had its say.
 * R437.2.a allows the result to be 0 — "equivalent to not dealing damage".
 *
 * `order` is R372's answer, as source card ids. Without one the replacements
 * apply in creation order, which is only reached when there is nothing to
 * choose between.
 */
export function replaceDamage(
  state: GameState,
  cardId: CardId,
  amount: number,
  from: "combat" | "spellOrAbility",
  order: CardId[] = [],
): { state: GameState; amount: number; events: GameEvent[] } {
  // Ambessa — "I can't be dealt damage unless I'm in combat". A restriction,
  // not a prevention: nothing replaces the event, it simply cannot happen.
  // R437.2.a already treats an amount of 0 as "equivalent to not dealing
  // damage", so this is the same outcome without a replacement to order.
  if (restricted(state, cardId, "beDealtDamage")) {
    return { state, amount: 0, events: [] };
  }

  const applicable = damageReplacementsFor(state, cardId, from);
  if (applicable.length === 0) return { state, amount, events: [] };

  const ranked = [...applicable].sort((a, b) => {
    const left = order.indexOf(a.sourceId);
    const right = order.indexOf(b.sourceId);
    if (left === -1 && right === -1) return 0;
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  });

  let running = amount;
  const events: GameEvent[] = [];
  const spent = new Map<string, DamageReplacement>();

  for (const entry of ranked) {
    if (running === 0 && entry.op.kind === "prevent") continue;

    if (entry.op.kind === "scale") {
      running = running * entry.op.factor;
    } else {
      // R437.2 — the damage is replaced with that much less, floored at zero.
      const shield = entry.op.amount === "all" ? running : entry.op.amount;
      const stopped = Math.min(shield, running);
      running -= stopped;
      // R437.3 — "reduce the Prevent Value ... by the prevented amount."
      if (entry.op.amount !== "all") {
        spent.set(entry.id, {
          ...entry,
          op: { kind: "prevent", amount: entry.op.amount - stopped },
        });
      }
    }
  }

  if (running !== amount) {
    events.push({
      type: "damageReplaced",
      cardId,
      from: amount,
      to: running,
    });
  }

  // R437.3.a — a Prevent Value down to zero stops being tracked.
  const remaining = state.damageReplacements
    .map((entry) => spent.get(entry.id) ?? entry)
    .filter((entry) => entry.op.kind !== "prevent" || entry.op.amount !== 0);

  return {
    state: { ...state, damageReplacements: remaining },
    amount: running,
    events,
  };
}
