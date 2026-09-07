import { owesDecision } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import type { ChainItem } from "../src/chain.js";
import { keywordsOf } from "../src/layers.js";
import type { GameState } from "../src/state.js";

/**
 * Things that should never be true of a board, checked after every action a
 * random playthrough takes.
 *
 * These exist because of what the playthroughs *could not* catch. Their
 * assertions were: every offered action is accepted, nobody gets stuck, the
 * game finds a winner, no prompt is left dangling at the end. Three real bugs
 * satisfied all four — a trigger that reached the chain and resolved having
 * never been asked what it wanted looks exactly like a turn going by. The
 * engine was doing *less* than it should, quietly, and only a statement about
 * what the board may never look like can see that.
 */
export function checkInvariants(
  state: GameState,
  after: Action,
  /**
   * The board the action was taken against. Chain timing is a statement about
   * a *transition* — "nothing without [Reaction] joins a chain that already
   * exists" is unanswerable from the resulting board alone, because by then
   * the chain it joined and the chain it made are the same object.
   */
  before?: GameState,
): void {
  const context = () => JSON.stringify(after);

  // R462.3 — no battlefield may hold three players' units at once. Units, not
  // permanents: R461 defines a staged combat by units and R449.2 counts them,
  // so a gear standing there is not a third side.
  for (const battlefieldId of state.battlefieldOrder) {
    const present = new Set(
      Object.values(state.permanents)
        .filter(
          (permanent) =>
            permanent.location.kind === "battlefield" &&
            permanent.location.id === battlefieldId &&
            state.cards[permanent.cardId]?.type === "unit",
        )
        .map((permanent) => permanent.controller),
    );
    if (present.size > 2) {
      throw new Error(
        `three players' units at ${battlefieldId} after ${context()}`,
      );
    }
  }

  /**
   * R337.1 — "the controller of the oldest Pending Chain Item *must* complete
   * the steps of Playing that Pending Item." So an item owing a choice, with
   * nobody being asked for it, is a game that can only go forward by throwing
   * that choice away. It is the signature of every stranded-trigger bug found
   * so far, and it is cheap to state: something owes an answer and no question
   * is on the table.
   */
  if (state.pending === null && state.winner === null) {
    const owing = state.chain.find((item) => owesDecision(item));
    if (owing !== undefined) {
      throw new Error(
        `chain item ${"sourceId" in owing ? owing.sourceId : "?"} owes a ` +
          `decision but nobody is being asked, after ${context()}`,
      );
    }
  }

  /**
   * Structural, rather than a rule: the state should never refer to something
   * that is not there. R652's Removal of a Player is what makes this worth
   * asserting — it takes a seat, its cards, its runes and its battlefield off
   * the board in one go, and a single missed reference leaves a card id
   * pointing at nothing for the rest of the game.
   */
  for (const [cardId, permanent] of Object.entries(state.permanents)) {
    if (state.cards[cardId] === undefined) {
      throw new Error(`permanent ${cardId} has no card, after ${context()}`);
    }
    const { location } = permanent;
    if (location.kind === "base") {
      if (!state.turnOrder.includes(location.player)) {
        throw new Error(
          `${cardId} stands at ${location.player}'s base, and ${location.player} ` +
            `is not in this game, after ${context()}`,
        );
      }
    } else if (state.battlefields[location.id] === undefined) {
      throw new Error(
        `${cardId} stands at ${location.id}, which is not in play, after ${context()}`,
      );
    }
  }

  // Every seat in the turn order has a player, and every player is seated.
  for (const id of state.turnOrder) {
    if (state.players[id] === undefined) {
      throw new Error(`${id} is in the turn order with no seat, after ${context()}`);
    }
  }
  for (const id of Object.keys(state.players)) {
    if (!state.turnOrder.includes(id as (typeof state.turnOrder)[number])) {
      throw new Error(`${id} has a seat but no turn, after ${context()}`);
    }
  }

  /**
   * An answer that was accepted has to have gone somewhere.
   *
   * This is the shape of the worst bug in this file's history, because it
   * fails so quietly: a Predict raised by an effect parked on the queue, with
   * a cleanup legitimately queued in front of it, and the answer delivered to
   * whatever sat at position zero. The cleanup ignored it. `applyAction`
   * returned ok. The identical prompt came straight back, and a random player
   * answered it 59,808 times on turn 13 before the step cap gave up — while
   * every existing assertion held, because nobody was stuck, nothing was
   * illegal, and no decision was stranded.
   *
   * Compared against the whole board rather than against the prompt, because
   * the same prompt legitimately survives an answer more often than it looks.
   * R383.3.a's decline removes its item from the chain — and the *next* item
   * then asks the same question about what is now index 0, which is identical
   * text about a different card. Narrower versions of this check called that a
   * dropped answer twice before the board settled the argument.
   */
  if (before !== undefined && after.type === "decide") {
    // Two stages, because comparing whole boards on every answer costs more
    // than every other check in this file put together. An answer that moved
    // the queue or cleared the prompt is the overwhelming majority and is
    // settled cheaply; only the ones that look suspicious are weighed in full.
    const suspect =
      JSON.stringify(before.pending) === JSON.stringify(state.pending) &&
      JSON.stringify(before.tasks) === JSON.stringify(state.tasks);
    if (suspect && JSON.stringify(before) === JSON.stringify(state)) {
      throw new Error(
        `answering ${JSON.stringify(state.pending?.prompt).slice(0, 120)} ` +
          `changed nothing at all, after ${context()}`,
      );
    }
  }

  /**
   * R337.1 — "the controller of the *oldest* Pending Chain Item must complete
   * the steps of Playing that Pending Item", and R337.1.b: "Chain Items are
   * Finalized in the order they were appended to the Chain."
   *
   * So when the chain is what the game is waiting on, the person being asked
   * is the controller of the oldest item that still owes something. Asking the
   * newest instead is the bug this engine already had once, and the existing
   * "somebody owes an answer and nobody is being asked" only sees the version
   * of it that strands a decision entirely — asking the *wrong* one of two
   * looks, from there, like a game proceeding normally.
   *
   * Only while the queue is quiet. R319.3 lets a Cleanup run with a chain up,
   * and a Cleanup may put its own question to somebody else; that is a task
   * being handled, which R334's HOT comes before FEPR precisely to allow.
   */
  if (state.pending !== null && state.tasks.length === 0) {
    const oldest = state.chain.findIndex((item) => owesDecision(item));
    const { prompt } = state.pending;
    // The three prompts a chain item raises all carry the item they are for,
    // which is what makes this sharp: comparing controllers alone would miss
    // the case that was actually reported, where one player owned both
    // triggers and being asked about the wrong one looked identical.
    const asking =
      prompt.kind === "confirmOptional" ||
      prompt.kind === "chooseMode" ||
      prompt.kind === "chooseTargets"
        ? prompt.chainIndex
        : null;
    if (oldest !== -1 && asking !== null && asking !== oldest) {
      throw new Error(
        `asked about chain item ${asking} (${sourceOf(state.chain[asking]!)}) ` +
          `while ${oldest} (${sourceOf(state.chain[oldest]!)}) is the oldest ` +
          `owing a choice, after ${context()}`,
      );
    }
    // And a question that names no item at all, raised while an item owes one,
    // is the same fault wearing different clothes.
    if (oldest !== -1 && asking === null && state.chain.length > 0) {
      const owed = state.chain[oldest]!;
      if (state.pending.player !== owed.controller) {
        throw new Error(
          `${state.pending.player} is being asked (${prompt.kind}) while ` +
            `${sourceOf(owed)} — the oldest item owing a choice — is ` +
            `${owed.controller}'s, after ${context()}`,
        );
      }
    }
  }

  /**
   * R331.1.a/b — "Cards of all Categories, by default, cannot be played during
   * a Closed State", and R338.1.a.2 says what lifts the default: "one with
   * Reaction or one that will have Reaction when played under appropriate
   * circumstances". R822.1.b's [Ambush] is the second half of that sentence,
   * and R811.1.b's Facedown Zone grants it outright.
   *
   * Asked of the transition rather than of `legalActions`, on purpose: the
   * point is to check the rule against the engine, not the engine against
   * itself. `legalActions` filters its candidates through `applyAction`, so
   * the two agreeing proves only that they share a mistake.
   */
  if (
    before !== undefined &&
    before.chain.length > 0 &&
    state.chain.length > before.chain.length
  ) {
    for (const item of state.chain.slice(before.chain.length)) {
      // A trigger is not *played* — R359.3 puts it on the chain by itself, and
      // no timing rule applies to it.
      if (item.kind !== "spell") continue;
      // R811.1.b — played from the Facedown Zone, which grants [Reaction].
      if (item.playedFrom === "facedown") continue;
      const keywords = keywordsOf(before, item.cardId);
      if (keywords.includes("reaction") || keywords.includes("ambush")) continue;
      throw new Error(
        `${item.cardId} joined a chain of ${before.chain.length} with no ` +
          `reaction timing (${keywords.join(", ") || "no keywords"}), after ${context()}`,
      );
    }
  }

  // R149.3 — an unattached non-Unit gear left at a battlefield is recalled in
  // the cleanup, so once the queue is quiet none should be standing there.
  if (state.tasks.length > 0 || state.chain.length > 0) return;
  for (const [cardId, permanent] of Object.entries(state.permanents)) {
    if (permanent.location.kind !== "battlefield") continue;
    if (permanent.attachedTo !== undefined) continue;
    if (state.cards[cardId]?.type !== "gear") continue;
    throw new Error(
      `loose gear ${cardId} left at ${permanent.location.id} after ${context()}`,
    );
  }
}

/** The card a chain item is about, for a message. */
function sourceOf(item: ChainItem): string {
  return item.kind === "spell" ? item.cardId : item.sourceId;
}
