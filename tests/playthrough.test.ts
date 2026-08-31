import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { legalActions } from "../src/legal.js";
import type { CardId, CardInstance, GameState, Location } from "../src/state.js";
import {
  ALL_CARDS,
  LEBLANC_DECK,
  RENGAR_DECK,
  VEX_DECK,
  matchup,
} from "../src/decks/index.js";
import type { Deck } from "../src/deck.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/** A deterministic PRNG, so a failing seed can be replayed exactly. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function whoActs(state: GameState): "p1" | "p2" {
  if (state.pending !== null) return state.pending.player;
  if (state.chain.length > 0 && state.priority !== null) return state.priority;
  if (state.showdown !== null) return state.showdown.focus;
  return state.turn.player;
}

interface Outcome {
  state: GameState;
  steps: number;
  stuck: boolean;
}

/**
 * Plays a whole game by picking uniformly from `legalActions`. Anything it
 * offers must be accepted by `applyAction` — that is the invariant the two
 * share, and the only way to check it is to exercise every branch a real game
 * reaches.
 */
function play(seed: number, maxSteps = 4000, decks?: [Deck, Deck]): Outcome {
  const started = startGame(
    matchup(decks === undefined ? {} : { decks }),
  );
  if (!started.ok) throw new Error(`setup failed: ${JSON.stringify(started.errors)}`);

  let state = started.state;
  const rand = lcg(seed);
  let steps = 0;

  const take = (action: Action): void => {
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `legalActions offered an illegal action: ` +
          `${JSON.stringify(action)} → ${result.reason}`,
      );
    }
    state = result.state;
    steps += 1;
  };

  while (state.winner === null && steps < maxSteps) {
    const actor = whoActs(state);
    let options = legalActions(state, actor);
    if (options.length === 0) {
      options = legalActions(state, actor === "p1" ? "p2" : "p1");
      if (options.length === 0) return { state, steps, stuck: true };
    }
    // Bias away from ending the turn, or the games never develop.
    const busy = options.filter((action) => action.type !== "endTurn");
    const pool = busy.length > 0 && rand() < 0.85 ? busy : options;
    take(pool[Math.floor(rand() * pool.length)]!);
  }

  return { state, steps, stuck: false };
}

/**
 * The two real decks, played start to finish. This is the test the roadmap
 * called for: real decks combine things no unit test thought to.
 */
describe("full games with the two real decks", () => {
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  it.each(seeds)("plays seed %i to a finish", (seed) => {
    const { state, stuck } = play(seed);

    // R320.1 / R355.8 — the engine must always leave *someone* able to act.
    expect(stuck).toBe(false);
    expect(state.winner).not.toBeNull();
    // R472 — you win by reaching the Victory Score, so the winner must have it.
    expect(state.players[state.winner!].points).toBeGreaterThanOrEqual(8);
  });

  it("never leaves a decision nobody can answer", () => {
    for (const seed of seeds) {
      const { state } = play(seed);
      expect(state.pending).toBeNull();
    }
  });
});

/**
 * Every authored card, played once on a board built to afford it. Catches an
 * authoring slip — a cost in the wrong shape, a filter nothing can satisfy —
 * across all 38 at once, which random play would only find by luck.
 */
describe("every card in both decks can be played", () => {
  const byId: Record<CardId, CardInstance> = {};
  for (const card of ALL_CARDS) byId[card.id] = card;

  /** One of each distinct name from a deck's main deck. */
  function distinct(deck: typeof VEX_DECK): CardInstance[] {
    const seen = new Set<string>();
    const out: CardInstance[] = [];
    for (const id of deck.mainDeck) {
      const card = byId[id]!;
      if (seen.has(card.name)) continue;
      seen.add(card.name);
      out.push(card);
    }
    return out;
  }

  /**
   * A board with plenty of everything, a friendly and an enemy unit at a
   * battlefield the player controls, and the card in hand.
   */
  function afford(card: CardInstance): GameState {
    const base = makeState({
      p1: {
        hand: [card.id],
        mainDeck: ["d1", "d2", "d3", "d4"],
        runePool: pool({
          energy: 20,
          power: { chaos: 5, calm: 5, body: 5, fury: 5 },
          universalPower: 5,
        }),
      },
      p2: { mainDeck: ["e1", "e2"] },
      cards: [
        card,
        unit("ally", { might: 3 }),
        unit("enemy", { might: 3 }),
        ...["d1", "d2", "d3", "d4", "e1", "e2"].map((id) => unit(id)),
      ],
      permanents: [
        { cardId: "ally", controller: "p1", location: NORTH },
        { cardId: "enemy", controller: "p2", location: NORTH },
      ],
      battlefields: [["bf-north", "p1"], "bf-south"],
    });

    // R813 — a chain up is a Closed State, so only a card that needs something
    // there gets one: Defy counters "a spell", which R355.9.a.2 puts on the
    // chain, and nothing else in either deck looks there.
    const wantsChain = card.abilities.some(
      (ability) =>
        (ability.kind === "activated" || ability.kind === "triggered") &&
        ability.targeting?.filters.some(
          (filter) => filter.type === "spellOnChain",
        ),
    );
    if (!wantsChain) return base;

    return {
      ...base,
      cards: {
        ...base.cards,
        decoy: {
          id: "decoy",
          name: "Decoy",
          type: "spell",
          cost: { energy: 1, power: {}, anyPower: 0 },
          keywords: [],
          abilities: [],
        },
      },
      chain: [
        { kind: "spell", cardId: "decoy", controller: "p2", targets: [] },
      ],
      priority: "p1",
    };
  }

  const cards = [...distinct(VEX_DECK), ...distinct(RENGAR_DECK)];

  it.each(cards.map((card) => [card.name, card] as const))(
    "%s",
    (_name, card) => {
      const state = afford(card);
      const plays = legalActions(state, "p1").filter(
        (action) =>
          (action.type === "playUnitFromHand" || action.type === "playSpell") &&
          action.cardId === card.id,
      );

      expect(plays.length).toBeGreaterThan(0);
    },
  );
});

/**
 * Deck 3 against both of the others. The point of a third list is not that it
 * plays well — it is that it prints nine keywords the first two never did, so
 * a random game through it reaches branches no unit test thought to build.
 */
describe("full games with the LeBlanc deck", () => {
  const seeds = Array.from({ length: 15 }, (_, i) => i + 1);

  it.each(seeds)("plays against Vex, seed %i", (seed) => {
    const { state, stuck } = play(seed, 4000, [LEBLANC_DECK, VEX_DECK]);

    expect(stuck).toBe(false);
    expect(state.winner).not.toBeNull();
    expect(state.pending).toBeNull();
  });

  it.each(seeds)("plays against Rengar, seed %i", (seed) => {
    const { state, stuck } = play(seed, 4000, [LEBLANC_DECK, RENGAR_DECK]);

    expect(stuck).toBe(false);
    expect(state.winner).not.toBeNull();
    expect(state.pending).toBeNull();
  });
});
