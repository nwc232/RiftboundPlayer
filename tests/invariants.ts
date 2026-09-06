import { owesDecision } from "../src/actions.js";
import type { Action } from "../src/actions.js";
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
export function checkInvariants(state: GameState, after: Action): void {
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
