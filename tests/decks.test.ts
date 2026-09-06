import { describe, expect, it } from "vitest";
import { startGame, validateDeck } from "../src/deck.js";
import type { CardId, CardInstance } from "../src/state.js";
import { DECK_LISTS, instantiate, matchup } from "../src/decks/index.js";

/**
 * Every card in the default matchup, plus every list instantiated into a seat
 * so the checks below cover all five rather than the two that happen to be
 * playing. Ids belong to a seat, so a list has to be given one to have any.
 */
const SEATED = DECK_LISTS.map((list) => instantiate(list, "p1"));
const ALL_CARDS: CardInstance[] = SEATED.flatMap((each) => each.cards);

const registry: Record<CardId, CardInstance> = {};
for (const card of ALL_CARDS) registry[card.id] = card;

const VEX_DECK = SEATED[0]!.deck;
const RENGAR_DECK = SEATED[1]!.deck;

/** R103 — what a player must bring. Both lists are real, so both must pass. */
describe("the two real decks", () => {
  it("are legal (R103)", () => {
    expect(validateDeck(VEX_DECK, registry)).toEqual([]);
    expect(validateDeck(RENGAR_DECK, registry)).toEqual([]);
  });

  it("hold 40 main-deck cards each, champion included (R103.2)", () => {
    expect(VEX_DECK.mainDeck).toHaveLength(40);
    expect(RENGAR_DECK.mainDeck).toHaveLength(40);
  });

  it("never exceed three copies of a name (R103.2.b)", () => {
    for (const deck of [VEX_DECK, RENGAR_DECK]) {
      const byName = new Map<string, number>();
      for (const id of deck.mainDeck) {
        const name = registry[id]!.name;
        byName.set(name, (byName.get(name) ?? 0) + 1);
      }
      expect(Math.max(...byName.values())).toBeLessThanOrEqual(3);
    }
  });

  /**
   * Ids belong to a seat, so this is asked of a *game* rather than of a list:
   * within one seated deck, and across the two seats facing each other. Two
   * lists both seated at p1 would collide by construction and never meet.
   */
  it("give every copy in a game its own id", () => {
    const ids = matchup().cards.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The point of stamping ids per seat: two players can bring the same list,
   * and R103 has nothing to say against it. What cannot happen is one card
   * being in both their decks at once.
   */
  it("keep a mirror match's two copies apart", () => {
    const mirror = matchup({ decks: [0, 0] });
    const ids = mirror.cards.map((card) => card.id);

    expect(new Set(ids).size).toBe(ids.length);
    const mine = new Set(mirror.seats.p1!.deck.mainDeck);
    expect(
      mirror.seats.p2!.deck.mainDeck.filter((id) => mine.has(id)),
    ).toEqual([]);
  });

  it("start a game", () => {
    const result = startGame(matchup());

    expect(result.ok).toBe(true);
  });
});

/**
 * Printed text is carried alongside the authored abilities so a player can see
 * what a card claims to do. The engine never reads it — which is exactly why
 * it has to be checked here rather than trusted.
 */
describe("every card carries its printed text", () => {
  const authored = ALL_CARDS.filter((card) => card.type !== "rune");

  it.each(authored.map((card) => [card.name, card] as const))(
    "%s",
    (_name, card) => {
      expect(card.text).toBeDefined();
      expect(card.text!.length).toBeGreaterThan(0);
    },
  );

  /** A vanilla card would have no text; none of these are vanilla. */
  it("gives runes their two abilities in words (R164.2)", () => {
    const rune = ALL_CARDS.find((card) => card.type === "rune");

    expect(rune?.text).toMatch(/Exhaust: Add \[1\]/);
    expect(rune?.text).toMatch(/Recycle: Add \[\w+\]/);
  });
});

/**
 * Every ability is data, so nothing in a deck should contain a function. The
 * roadmap's serialization item turns on this staying true.
 */
describe("cards are plain data", () => {
  it("survive a JSON round trip unchanged", () => {
    const copy = JSON.parse(JSON.stringify(ALL_CARDS)) as CardInstance[];

    expect(copy).toEqual(ALL_CARDS);
  });
});

/**
 * R114 — "Each player shuffles their Main and Rune Decks, separately, then
 * places them into their respective Zones."
 *
 * The rune deck is the half that is easy to forget, because nothing rejects an
 * unshuffled one: it is still twelve legal runes and the game still starts. It
 * just channels them in the order the deck list names them, which is by domain
 * (`[["chaos", 7], ["calm", 5]]`) — seven Chaos and then five Calm, in that
 * order, in every game ever played. Which power a player can spend on which
 * turn is then fixed before anyone draws a card.
 */
describe("R114 — setup shuffles both decks, per seat", () => {
  /** The domain of each rune in a seat's rune deck, top first. */
  function domains(setup: ReturnType<typeof matchup>, seat: "p1" | "p2"): string[] {
    const byId = new Map(setup.cards.map((card) => [card.id, card]));
    return setup.seats[seat]!.deck.runeDeck.map(
      (id) => byId.get(id)?.domain ?? "?",
    );
  }

  /** How many times the domain changes going down the deck, plus one. */
  function blocks(sequence: string[]): number {
    return sequence.filter((domain, at) => at === 0 || domain !== sequence[at - 1])
      .length;
  }

  it("leaves an unseeded rune deck in list order, which is by domain", () => {
    // Not the bug — this is the documented "same game every time" the tests
    // rely on. It is here to show what the seeded case is being measured
    // against: two domains, two blocks, nothing interleaved.
    expect(blocks(domains(matchup(), "p1"))).toBe(2);
  });

  it("interleaves the domains of a seeded rune deck", () => {
    // A shuffled 7/5 split lands on two blocks with probability 2/C(12,5) —
    // about 0.25% — so a seed that produced one would be news. Every seed
    // here has to beat it.
    for (const seed of [1, 2, 3, 7, 99, 12345]) {
      expect(blocks(domains(matchup({ seed }), "p1"))).toBeGreaterThan(2);
    }
  });

  it("deals the two seats of a mirror match different orders", () => {
    // One seed applied to every seat is one permutation applied to every seat:
    // the same list at both chairs would draw the same cards in the same order
    // all game. The salt is what makes it a shuffle rather than a rotation.
    const mirror = matchup({ seed: 4, decks: [0, 0] });

    const strip = (id: string) => id.slice("p1-".length);
    expect(mirror.seats.p2!.deck.mainDeck.map(strip)).not.toEqual(
      mirror.seats.p1!.deck.mainDeck.map(strip),
    );
    expect(domains(mirror, "p2")).not.toEqual(domains(mirror, "p1"));
  });

  it("stays reproducible from the seed", () => {
    // The whole reason the shuffle lives at setup rather than in the engine:
    // a reported game can be replayed from the seed that was printed.
    expect(matchup({ seed: 808 }).seats).toEqual(matchup({ seed: 808 }).seats);
  });
});
