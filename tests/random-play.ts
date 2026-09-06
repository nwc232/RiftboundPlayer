import type { Action } from "../src/actions.js";
import type { GameState } from "../src/state.js";

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
    if (responses.length > 0 && rand() < 0.8) return pick(responses, rand);
  }

  // Otherwise: get on with the game, but not by ending the turn if there is
  // anything else to do, or the games never develop.
  const busy = live.filter((action) => action.type !== "endTurn");
  const pool = busy.length > 0 && rand() < 0.85 ? busy : live;
  return pick(pool, rand);
}

function pick<T>(from: T[], rand: () => number): T {
  return from[Math.floor(rand() * from.length)]!;
}
