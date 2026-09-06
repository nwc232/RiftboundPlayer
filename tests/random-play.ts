import type { Action } from "../src/actions.js";
import type { CardId, GameState } from "../src/state.js";

/**
 * The card a move is made with, where there is one. Used only to ask whether a
 * move would exercise something the run has not exercised yet.
 */
export function sourceOf(action: Action): CardId | undefined {
  switch (action.type) {
    case "playUnitFromHand":
    case "playSpell":
    case "hide":
    case "standardMove":
      return action.cardId;
    case "activateAbility":
      return action.sourceId;
    default:
      return undefined;
  }
}

/**
 * How a random playthrough picks its next move.
 *
 * Not uniform, and deliberately so. Uniform choice spends its whole time in
 * the shallow end: measured over 10,870 actions, random play sat at chain
 * depth 0 or 1 for 95% of states, reached depth 3 in one state in three
 * hundred, and played a card *onto* an existing chain 80 times — 0.7% of its
 * moves.
 *
 * Every bug found by hand so far has lived in exactly that region: a trigger
 * added onto a chain that already had items, a spell answering another spell,
 * a source that left the board before its own ability resolved. So the
 * chooser is weighted toward building chains rather than draining them.
 */
export function chooseAction(
  state: GameState,
  options: Action[],
  rand: () => number,
  /**
   * Whether a card is one the run has not exercised yet. Uniform play plateaus
   * hard: five times the seeds moved distinct abilities fired from 34 to 38 out
   * of 94, because the cards it has already played stay just as attractive as
   * the ones it has never touched. Given this, the chooser reaches for the new
   * one, which is what turns a soak into a search.
   */
  novel: (cardId: CardId) => boolean = () => false,
): Action | undefined {
  // R650 lets anyone concede at any moment, so `legalActions` offers it every
  // time. A random player who takes it ends the game on move one and
  // exercises nothing, so this one is declined rather than weighted.
  const live = options.filter((action) => action.type !== "concede");
  if (live.length === 0) return undefined;

  // Answering is never declined: a decision on the table is the only thing
  // that can happen, and it is usually the interesting half of a trigger.
  const answers = live.filter((action) => action.type === "decide");
  if (answers.length > 0) return pick(answers, rand);

  // With something already on the chain, prefer adding to it. This is the
  // whole point: `Faefolk → Gust → Pridestalker` is the shape that broke
  // three different things, and uniform play almost never builds it.
  if (state.chain.length > 0) {
    const responses = live.filter(
      (action) =>
        action.type === "playSpell" ||
        action.type === "playUnitFromHand" ||
        action.type === "activateAbility",
    );
    if (responses.length > 0 && rand() < 0.8) {
      return pick(unseen(responses, novel, rand), rand);
    }
  }

  // Otherwise: get on with the game, but not by ending the turn if there is
  // anything else to do, or the games never develop.
  const busy = live.filter((action) => action.type !== "endTurn");
  const pool = busy.length > 0 && rand() < 0.85 ? busy : live;
  return pick(unseen(pool, novel, rand), rand);
}

/**
 * Narrow to the moves that would exercise a card the run has not seen — most
 * of the time, not always. Always would be worse: a card whose ability only
 * fires on the *second* copy, or off a board state that takes a few turns to
 * build, is reached by repetition rather than by novelty, and a chooser that
 * refuses to repeat itself never gets there.
 */
function unseen(
  from: Action[],
  novel: (cardId: CardId) => boolean,
  rand: () => number,
): Action[] {
  if (rand() < 0.15) return from;
  const fresh = from.filter((action) => {
    const cardId = sourceOf(action);
    return cardId !== undefined && novel(cardId);
  });
  return fresh.length > 0 ? fresh : from;
}

function pick<T>(from: T[], rand: () => number): T {
  return from[Math.floor(rand() * from.length)]!;
}
