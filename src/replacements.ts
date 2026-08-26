import { holds } from "./conditions.js";
import type { Condition, ConditionContext } from "./conditions.js";
import { keywordsOf } from "./layers.js";
import type { CardId, GameState, PlayerId } from "./state.js";

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
