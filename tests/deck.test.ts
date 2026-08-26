import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { basicRune } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import {
  MAIN_DECK_MINIMUM,
  RUNE_DECK_SIZE,
  copies,
  startGame,
  validateDeck,
} from "../src/deck.js";
import type { Deck } from "../src/deck.js";
import { drawCards } from "../src/draw.js";
import { VICTORY_SCORE, checkForWinner } from "../src/scoring.js";
import type { CardId, CardInstance, GameState } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const legend: CardInstance = {
  id: "legend-p1",
  name: "Chosen Legend",
  type: "legend",
  cost: FREE,
  keywords: [],
  abilities: [],
};

function battlefield(id: string, name: string): CardInstance {
  return { id, name, type: "battlefield", cost: FREE, keywords: [], abilities: [] };
}

/** 14 distinct names at 3 copies each is 42 — comfortably over R103.2's 40. */
function mainDeckCards(prefix: string): CardInstance[] {
  return Array.from({ length: 14 }, (_, i) =>
    copies({ ...unit(`${prefix}-u${i}`, { might: 2 }), name: `${prefix} Unit ${i}` }, 3),
  ).flat();
}

function runeCards(prefix: string): CardInstance[] {
  return Array.from({ length: RUNE_DECK_SIZE }, (_, i) =>
    basicRune(`${prefix}-r${i}`, "fury"),
  );
}

function buildDeck(prefix: string): {
  deck: Deck;
  cards: CardInstance[];
} {
  const legendCard: CardInstance = { ...legend, id: `${prefix}-legend` };
  const main = mainDeckCards(prefix);
  const runes = runeCards(prefix);
  const bfs = [
    battlefield(`${prefix}-bf1`, `${prefix} One`),
    battlefield(`${prefix}-bf2`, `${prefix} Two`),
    battlefield(`${prefix}-bf3`, `${prefix} Three`),
  ];

  return {
    cards: [legendCard, ...main, ...runes, ...bfs],
    deck: {
      legend: legendCard.id,
      champion: main[0]!.id,
      mainDeck: main.map((c) => c.id),
      runeDeck: runes.map((c) => c.id),
      battlefields: bfs.map((c) => c.id),
    },
  };
}

function registry(cards: CardInstance[]): Record<CardId, CardInstance> {
  const out: Record<CardId, CardInstance> = {};
  for (const card of cards) out[card.id] = card;
  return out;
}

describe("deck construction (R103)", () => {
  it("accepts a legal deck", () => {
    const { deck, cards } = buildDeck("p1");
    expect(validateDeck(deck, registry(cards))).toEqual([]);
  });

  it("requires a Main Deck of at least 40 (R103.2)", () => {
    const { deck, cards } = buildDeck("p1");
    const short = { ...deck, mainDeck: deck.mainDeck.slice(0, 39) };

    expect(deck.mainDeck.length).toBeGreaterThanOrEqual(MAIN_DECK_MINIMUM);
    expect(validateDeck(short, registry(cards))).toContain("mainDeckTooSmall");
  });

  /** R103.2.b — up to 3 copies of the same *named* card. */
  it("rejects a fourth copy of the same name", () => {
    const { deck, cards } = buildDeck("p1");
    const extra: CardInstance = {
      ...unit("p1-extra", { might: 2 }),
      name: "p1 Unit 0",
    };

    expect(
      validateDeck(
        { ...deck, mainDeck: [...deck.mainDeck, extra.id] },
        registry([...cards, extra]),
      ),
    ).toContain("tooManyCopies");
  });

  it("requires exactly 12 runes (R103.3.a)", () => {
    const { deck, cards } = buildDeck("p1");

    expect(
      validateDeck({ ...deck, runeDeck: deck.runeDeck.slice(0, 11) }, registry(cards)),
    ).toContain("wrongRuneCount");
  });

  it("requires the Chosen Champion to be in the Main Deck (R103.2)", () => {
    const { deck, cards } = buildDeck("p1");

    expect(
      validateDeck({ ...deck, champion: "p1-legend" }, registry(cards)),
    ).toContain("championNotInMainDeck");
  });

  it("requires three battlefields with distinct names (R103.4.c/R485.4.a)", () => {
    const { deck, cards } = buildDeck("p1");
    const dupe = battlefield("p1-bf4", "p1 One");

    expect(
      validateDeck({ ...deck, battlefields: deck.battlefields.slice(0, 2) }, registry(cards)),
    ).toContain("wrongBattlefieldCount");
    expect(
      validateDeck(
        { ...deck, battlefields: [deck.battlefields[0]!, deck.battlefields[1]!, dupe.id] },
        registry([...cards, dupe]),
      ),
    ).toContain("duplicateBattlefieldName");
  });
});

describe("setup (R103/R485)", () => {
  function game() {
    const one = buildDeck("p1");
    const two = buildDeck("p2");
    return startGame({
      cards: [...one.cards, ...two.cards],
      p1: one.deck,
      p2: two.deck,
      choices: {
        p1: { battlefield: one.deck.battlefields[0]! },
        p2: { battlefield: two.deck.battlefields[2]! },
      },
    });
  }

  it("refuses to start on an illegal deck", () => {
    const one = buildDeck("p1");
    const two = buildDeck("p2");
    const result = startGame({
      cards: [...one.cards, ...two.cards],
      p1: { ...one.deck, runeDeck: [] },
      p2: two.deck,
      choices: {
        p1: { battlefield: one.deck.battlefields[0]! },
        p2: { battlefield: two.deck.battlefields[0]! },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.errors.p1).toContain("wrongRuneCount");
    expect(result.errors.p2).toEqual([]);
  });

  it("puts the Legend and Chosen Champion in their zones (R107.4/R108.3)", () => {
    const result = game();
    if (!result.ok) throw new Error("setup failed");

    expect(result.state.players.p1.legend).toBe("p1-legend");
    expect(result.state.players.p1.champion).toBe("p1-u0-1");
    // R103.2.a.1 — it counted toward the 40 but is not among the drawable cards.
    expect(result.state.players.p1.mainDeck).not.toContain("p1-u0-1");
    expect(result.state.players.p1.hand).not.toContain("p1-u0-1");
  });

  /** R485.4 — two battlefields in play, one contributed by each player. */
  it("puts exactly one battlefield from each player into play", () => {
    const result = game();
    if (!result.ok) throw new Error("setup failed");

    expect(result.state.battlefieldOrder).toEqual(["p1-bf1", "p2-bf3"]);
  });

  /** R485.7 — the player going second channels an extra rune on their first. */
  it("gives the player going second three runes on their first Channel Phase", () => {
    const result = game();
    if (!result.ok) throw new Error("setup failed");

    // p1 went first, so channelled two on turn 1.
    expect(result.state.players.p1.runes).toHaveLength(2);

    const turnTwo = applyAction(result.state, {
      type: "endTurn",
      playerId: "p1",
    });
    if (!turnTwo.ok) throw new Error(`rejected: ${turnTwo.reason}`);

    expect(turnTwo.state.turn.player).toBe("p2");
    expect(turnTwo.state.players.p2.runes).toHaveLength(3);
    // And only on their first — p1 still has two.
    expect(turnTwo.state.players.p1.runes).toHaveLength(2);
  });
});

/** R108.3.d — "The Chosen Champion can be played from here as normal." */
describe("playing the Chosen Champion (R108.3.d)", () => {
  it("plays from the Champion Zone and empties it", () => {
    const one = buildDeck("p1");
    const two = buildDeck("p2");
    const started = startGame({
      cards: [...one.cards, ...two.cards],
      p1: one.deck,
      p2: two.deck,
      choices: {
        p1: { battlefield: one.deck.battlefields[0]! },
        p2: { battlefield: two.deck.battlefields[0]! },
      },
    });
    if (!started.ok) throw new Error("setup failed");

    const championId = started.state.players.p1.champion!;
    // The test units are free, so no rune payment is needed.
    const played = applyAction(started.state, {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: championId,
    });
    if (!played.ok) throw new Error(`rejected: ${played.reason}`);

    expect(played.state.permanents[championId]).toBeDefined();
    // R108.3.c — it cannot come back here, so the zone stays empty.
    expect(played.state.players.p1.champion).toBeNull();
  });
});

/**
 * R431 — Burn Out is not a loss. A player who must draw from an empty Main
 * Deck recycles their trash into it (R431.2.b), an opponent gains a point
 * (R431.2.c), and the draw then completes (R431.2.d).
 */
describe("Burn Out (R431)", () => {
  it("recycles the trash, gives the opponent a point, then draws", () => {
    const state = makeState({
      p1: { mainDeck: [], trash: ["t1", "t2"] },
      cards: [unit("t1"), unit("t2")],
    });

    const after = drawCards(state, "p1", 1);

    expect(after.state.players.p2.points).toBe(1);
    expect(after.state.players.p1.trash).toEqual([]);
    // R431.2.d — the draw still happens, out of the recycled deck.
    expect(after.state.players.p1.hand).toEqual(["t1"]);
    expect(after.state.players.p1.mainDeck).toEqual(["t2"]);
    expect(after.events.map((e) => e.type)).toContain("burnedOut");
  });

  it("does not loop forever when the trash is empty too", () => {
    const state = makeState({ p1: { mainDeck: [], trash: [] } });

    const after = drawCards(state, "p1", 2);

    expect(after.state.players.p1.hand).toEqual([]);
    // One burn out per attempted draw that found nothing.
    expect(after.state.players.p2.points).toBe(1);
  });

  it("can win the game for the opponent (R194.3)", () => {
    const base = makeState({ p1: { mainDeck: [], trash: [] } });
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        p2: { ...base.players.p2, points: VICTORY_SCORE - 1 },
      },
    };

    const burned = drawCards(state, "p1", 1);
    const checked = checkForWinner(burned.state);

    expect(checked.state.winner).toBe("p2");
  });
});
