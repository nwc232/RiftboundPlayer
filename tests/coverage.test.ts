import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { legalActions } from "../src/legal.js";
import { DECK_LISTS, instantiate, matchup } from "../src/decks/index.js";
import type { CardId, CardInstance, GameState } from "../src/state.js";
import { chooseAction, sourceOf } from "./random-play.js";

/**
 * How much of the card pool the random playthroughs actually reach.
 *
 * A pass count says nothing about this. "1287 tests" was true while three
 * triggers in a row were resolving having never been asked what they wanted —
 * and the shape of that bug is precisely a *drop* in how many abilities get to
 * do anything. Fixing those two deadlocks took the number of distinct triggers
 * reaching resolution from 49 to 77 across one soak, which is the single
 * clearest signal either bug existed.
 *
 * So this is a floor, not an exact set. An exact set would be brittle across
 * seeds and would have to be edited every time a deck changes; a floor catches
 * the thing worth catching, which is a collapse.
 *
 * What the number counts has been wrong twice, in the direction that flatters
 * nobody. It read 30 of 94 while three separate things held it down, none of
 * them the engine: every game was dealt the same unshuffled decks (R114), the
 * same battlefield was presented every time so two of every deck's three were
 * never in play, and a spell's effect — authored as an `activated` ability but
 * played with `playSpell` — was never counted at all. The last of those alone
 * was twenty-eight cards resolving perfectly well and reading as dead. Being
 * wrong about the oracle looks exactly like being wrong about the engine, so
 * the comments below say what each line is counting and why.
 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Only the two kinds that leave a signal: an action, and an event. */
function detectable(card: CardInstance): string[] {
  return (card.abilities ?? []).flatMap((ability, index) =>
    ability.kind === "activated" || ability.kind === "triggered"
      ? [`${card.name}#${index}`]
      : [],
  );
}

const REGISTRY = new Map<CardId, CardInstance>();
for (const list of DECK_LISTS) {
  for (const seat of ["p1", "p2", "p3", "p4"] as const) {
    for (const card of instantiate(list, seat).cards) REGISTRY.set(card.id, card);
  }
}

const AUTHORED = new Set<string>();
for (const list of DECK_LISTS) {
  for (const card of instantiate(list, "p1").cards) {
    for (const key of detectable(card)) AUTHORED.add(key);
  }
}

function soak(plans: number[][], seeds: number): Set<string> {
  const fired = new Set<string>();
  const note = (sourceId: CardId, kind: "activated" | "triggered"): void => {
    const card = REGISTRY.get(sourceId);
    if (card === undefined) return;
    (card.abilities ?? []).forEach((ability, index) => {
      if (ability.kind === kind) fired.add(`${card.name}#${index}`);
    });
  };

  // What the search has already touched, by *name* rather than by id: three
  // copies of Gust are one card to a player, and a chooser that counted them
  // separately would happily play all three before looking at anything else.
  // Kept across every game in the soak, so later games attack what the earlier
  // ones left alone.
  const played = new Set<string>();
  const novel = (cardId: CardId): boolean => {
    const name = REGISTRY.get(cardId)?.name;
    return name !== undefined && !played.has(name);
  };

  for (const decks of plans) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const started = startGame(matchup({ decks, seed }));
      if (!started.ok) continue;
      let state: GameState = started.state;
      const rand = lcg(seed);
      for (let step = 0; step < 6000 && state.winner === null; step += 1) {
        const owed = state.pending !== null ? state.pending.player : null;
        const movers = state.turnOrder.filter((id) =>
          legalActions(state, id).some((a) => a.type !== "concede"),
        );
        const actor = owed ?? movers[Math.floor(rand() * movers.length)];
        if (actor === undefined) break;
        const action = chooseAction(
          state,
          legalActions(state, actor),
          rand,
          novel,
        );
        if (action === undefined) break;
        const source = sourceOf(action);
        if (source !== undefined) {
          const name = REGISTRY.get(source)?.name;
          if (name !== undefined) played.add(name);
        }
        if (action.type === "activateAbility") note(action.sourceId, "activated");
        const result = applyAction(state, action);
        if (!result.ok) break;
        for (const event of result.events) {
          if (event.type === "abilityTriggered") note(event.cardId, "triggered");
          // A spell's effect is authored as an `activated` ability, and playing
          // one is `playSpell` rather than `activateAbility` — so counting the
          // action alone missed every spell in the pool. Twenty-eight cards
          // read as never-exercised while resolving perfectly well, which is
          // the oracle being wrong about the engine rather than the other way
          // round. `spellResolved` is the honest signal: the effect ran.
          if (event.type === "spellResolved") note(event.cardId, "activated");
        }
        state = result.state;
      }
    }
  }
  return fired;
}

describe("how much of the pool random play reaches", () => {
  /**
   * The floor is set below what the soak currently manages, so an ordinary
   * shuffle cannot trip it — but a bug that stops abilities resolving takes
   * the number down sharply, which is exactly what happened and went unnoticed.
   */
  const FLOOR = 55;

  it(`fires at least ${FLOOR} distinct authored abilities`, () => {
    const fired = soak([[0, 1], [2, 0], [3, 4], [0, 1, 2]], 12);
    const missing = [...AUTHORED].filter((key) => !fired.has(key)).sort();

    // The count every run, the list only when it matters. Which cards go
    // unexercised is the list to attack when authoring tests, but it is
    // twenty-odd lines and nobody reads it on a green run.
    process.stdout.write(
      `\n  ${fired.size} of ${AUTHORED.size} authored abilities fired\n`,
    );
    if (fired.size < FLOOR) {
      process.stdout.write(
        `  never fired (${missing.length}):\n` +
          missing.map((key) => `    ${key}\n`).join(""),
      );
    }

    expect(fired.size).toBeGreaterThanOrEqual(FLOOR);
  }, 120_000);
});
