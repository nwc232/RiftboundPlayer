/**
 * The long soak: every deck pairing, forty seeds each, every invariant on.
 *
 * Kept out of `npm test` on purpose — 520 games and 174,000 actions is nearly
 * three minutes, which is the wrong price for every run and the right price
 * before handing the game to somebody else. `npm run soak`.
 *
 * It earns its keep by being *wide* where the suite is deep. The soaks in the
 * ordinary tests run four deck pairings; this runs thirteen, including every
 * three- and four-seat combination, and the one bug it has found so far was
 * reachable in none of the others: "banish a friendly unit, then its owner
 * plays it to any battlefield" took its destination as a chosen target and
 * nothing stopped that choice being a battlefield two *other* players were
 * already standing on (R449.2/R462.2.a). Once, in 520 games, in a three-seat
 * game, and impossible in a Duel where there is no third side to be.
 */
import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { legalActions } from "../src/legal.js";
import { matchup } from "../src/decks/index.js";
import type { GameState, PlayerId } from "../src/state.js";
import { chooseAction } from "./random-play.js";
import { checkInvariants } from "./invariants.js";
function lcg(seed: number) { let s=seed>>>0; return ()=>{ s=(s*1664525+1013904223)>>>0; return s/0x100000000; }; }
function whoActs(state: GameState): PlayerId {
  if (state.pending !== null) return state.pending.player;
  if (state.chain.length > 0 && state.priority !== null) return state.priority;
  if (state.showdown !== null) return state.showdown.focus;
  return state.turn.player;
}
describe("big soak", () => {
  it("runs every matchup over many seeds", () => {
    const plans = [[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4],[0,1,2],[2,3,4],[0,1,2,3]];
    let games = 0, steps = 0, unfinished = 0;
    const problems: string[] = [];
    for (const decks of plans) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const started = startGame(matchup({ decks, seed }));
        if (!started.ok) continue;
        let state: GameState = started.state;
        const rand = lcg(seed * 7919 + decks.length);
        games += 1;
        let n = 0;
        try {
          for (; n < 8000 && state.winner === null; n += 1) {
            const actor = whoActs(state);
            let options = legalActions(state, actor);
            if (options.length === 0) {
              for (const id of state.turnOrder) { options = legalActions(state, id); if (options.length > 0) break; }
              if (options.length === 0) break;
            }
            const action = chooseAction(state, options, rand);
            if (action === undefined) break;
            const before = state;
            const result = applyAction(state, action);
            if (!result.ok) { problems.push(`illegal ${JSON.stringify(action)} -> ${result.reason} (decks ${decks} seed ${seed})`); break; }
            state = result.state;
            checkInvariants(state, action, before);
          }
        } catch (error) { problems.push(`decks ${decks} seed ${seed} step ${n}: ${(error as Error).message}`); }
        steps += n;
        if (state.winner === null) unfinished += 1;
      }
    }
    process.stdout.write(`\n  ${games} games, ${steps} actions, ${unfinished} unfinished, ${problems.length} problems\n`);
    for (const problem of problems.slice(0, 12)) process.stdout.write(`    ${problem}\n`);
    expect(problems).toEqual([]);
  }, 1_800_000);
});
