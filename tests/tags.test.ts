import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { createToken, grantKeywordFor, passive } from "../src/builders.js";
import { validateDeck } from "../src/deck.js";
import type { Deck } from "../src/deck.js";
import { legalTargets } from "../src/decisions.js";
import { keywordsOf, tagsOf } from "../src/layers.js";
import { TOKEN_DEFINITIONS, tokenCard } from "../src/tokens.js";
import { FREE } from "../src/cost.js";
import type { CardId, CardInstance, GameState, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

const context = (targets: CardId[] = []): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

/** R133.8 — "Tags are Categories that may apply to game objects of multiple types." */
describe("tags (R133.8)", () => {
  it("are read off the card", () => {
    const state = makeState({
      cards: [unit("mech", { tags: ["Mech", "Yordle"] })],
      permanents: [{ cardId: "mech", controller: "p1" }],
    });

    expect(tagsOf(state, "mech")).toEqual(["Mech", "Yordle"]);
  });

  it("are empty on a card that carries none", () => {
    const state = makeState({
      cards: [unit("plain")],
      permanents: [{ cardId: "plain", controller: "p1" }],
    });

    expect(tagsOf(state, "plain")).toEqual([]);
  });

  /**
   * R477.1.b.1.a — tags come across with the rest of the copyable traits, so a
   * Reflection copying a Mech is a Mech and anything watching the tag sees it.
   */
  it("come across with a copy (R477.1.b)", () => {
    const source: CardInstance = unit("original", {
      might: 4,
      tags: ["Mech", "Bandle City"],
    });
    const start = makeState({
      cards: [source],
      permanents: [{ cardId: "original", controller: "p1", location: NORTH }],
      battlefields: ["bf-north"],
    });

    const after = execute(
      start,
      createToken("reflection", 1, { copyOfTarget: 0 }),
      context(["original"]),
    ).state;
    const tokenId = Object.keys(after.permanents).find(
      (id) => id !== "original",
    )!;

    expect(tagsOf(after, tokenId)).toEqual(["Mech", "Bandle City"]);
    // A Reflection prints no tags of its own.
    expect(TOKEN_DEFINITIONS.reflection.tags).toEqual([]);
  });
});

/** R150 — "Gear can have the Equipment tag", and cards choose by it. */
describe("choosing by tag", () => {
  function board(): GameState {
    return makeState({
      cards: [
        { ...unit("sword"), type: "gear" as const, tags: ["Equipment"] },
        { ...unit("banner"), type: "gear" as const },
        unit("mech", { tags: ["Mech"] }),
        unit("hero"),
      ],
      permanents: [
        { cardId: "sword", controller: "p1" },
        { cardId: "banner", controller: "p1" },
        { cardId: "mech", controller: "p1" },
        { cardId: "hero", controller: "p1" },
      ],
    });
  }

  it("narrows a filter to cards carrying the tag", () => {
    expect(
      legalTargets(board(), "p1", {
        type: "gear",
        controller: "friendly",
        tag: "Equipment",
      }),
    ).toEqual(["sword"]);
  });

  it("leaves the filter alone when no tag is named", () => {
    expect(
      legalTargets(board(), "p1", { type: "gear", controller: "friendly" }),
    ).toEqual(["sword", "banner"]);
  });

  it("finds nothing for a tag nobody carries", () => {
    expect(
      legalTargets(board(), "p1", { type: "unit", tag: "Poro" }),
    ).toEqual([]);
  });
});

/**
 * Forecaster — "Your Mechs have [Vision]." R187.4 gives the Mech token the
 * Mech tag, so a passive scoped by tag is what the card actually says.
 */
describe("a passive scoped by tag", () => {
  function board(): GameState {
    const forecaster: CardInstance = {
      ...unit("forecaster", { might: 2, tags: ["Mech", "Yordle"] }),
      abilities: [
        passive(
          { target: "friendlyUnits", tag: "Mech" },
          { layer: "ability", op: "grantKeyword", keyword: "vision" },
        ),
      ],
    };
    return makeState({
      cards: [
        forecaster,
        unit("otherMech", { might: 3, tags: ["Mech"] }),
        unit("yordle", { might: 1, tags: ["Yordle"] }),
        { ...unit("theirMech", { might: 3, tags: ["Mech"] }) },
      ],
      permanents: [
        { cardId: "forecaster", controller: "p1" },
        { cardId: "otherMech", controller: "p1" },
        { cardId: "yordle", controller: "p1" },
        { cardId: "theirMech", controller: "p2" },
      ],
    });
  }

  it("grants to every friendly unit with the tag", () => {
    expect(keywordsOf(board(), "otherMech")).toContain("vision");
  });

  /**
   * "*Your* Mechs" includes the source when the source is one. This is the
   * whole reason `friendlyUnits` exists beside `otherFriendlyUnits`:
   * Forecaster is a Mech, and does have [Vision].
   */
  it("grants to the source itself", () => {
    expect(keywordsOf(board(), "forecaster")).toContain("vision");
  });

  it("does not reach a friendly unit without the tag", () => {
    expect(keywordsOf(board(), "yordle")).not.toContain("vision");
  });

  it("does not reach an enemy Mech", () => {
    expect(keywordsOf(board(), "theirMech")).not.toContain("vision");
  });
});

/**
 * R103.2.a.2 — the Chosen Champion "must be a champion unit with a champion
 * tag that matches the tag on your Champion Legend". R133.8.b: the Legend's
 * own tags are the champion tags.
 */
describe("the Champion/Legend tag link (R103.2.a.2)", () => {
  function decked(championTags: string[]): {
    deck: Deck;
    cards: Record<CardId, CardInstance>;
  } {
    const legend: CardInstance = {
      id: "gloomist",
      name: "Gloomist",
      type: "legend",
      cost: FREE,
      keywords: [],
      tags: ["Vex"],
      abilities: [],
    };
    const champion: CardInstance = {
      ...unit("vex", {
        might: 4,
        tags: championTags,
        supertypes: ["champion"],
      }),
      name: "Vex, Apathetic",
    };
    const filler = Array.from({ length: 39 }, (_, i) => ({
      ...unit(`f${i}`, { might: 1 }),
      name: `Filler ${i}`,
    }));
    const runes = Array.from({ length: 12 }, (_, i) => ({
      ...unit(`r${i}`),
      type: "rune" as const,
      domain: "chaos" as const,
      name: `Rune ${i}`,
    }));
    const bfs = ["one", "two", "three"].map((n) => ({
      ...unit(`bf-${n}`),
      type: "battlefield" as const,
      name: n,
    }));

    const cards: Record<CardId, CardInstance> = {};
    for (const card of [legend, champion, ...filler, ...runes, ...bfs]) {
      cards[card.id] = card;
    }
    return {
      cards,
      deck: {
        legend: legend.id,
        champion: champion.id,
        mainDeck: [champion.id, ...filler.map((c) => c.id)],
        runeDeck: runes.map((c) => c.id),
        battlefields: bfs.map((c) => c.id),
      },
    };
  }

  it("accepts a champion sharing the Legend's tag", () => {
    const { deck, cards } = decked(["Yordle", "Vex", "Shadow Isles"]);
    expect(validateDeck(deck, cards)).toEqual([]);
  });

  it("rejects one that shares none of them", () => {
    const { deck, cards } = decked(["Cat", "Rengar", "Ixtal"]);
    expect(validateDeck(deck, cards)).toContain("championTagMismatch");
  });

  it("rejects a champion with no tags at all", () => {
    const { deck, cards } = decked([]);
    expect(validateDeck(deck, cards)).toContain("championTagMismatch");
  });

  /**
   * R103.2.a.2's other half, and the rule's own counter-example: "Tibbers has
   * the tag Annie, but it is a signature unit, not a champion unit. It cannot
   * be your Chosen Champion, even if your Champion Legend has the tag Annie."
   */
  it("rejects a signature unit even when the tag matches", () => {
    const { deck, cards } = decked(["Vex"]);
    const tibbers = { ...cards[deck.champion]!, supertypes: ["signature" as const] };

    const errors = validateDeck(deck, { ...cards, [tibbers.id]: tibbers });

    expect(errors).toContain("championNotAChampionUnit");
    // The tag half is satisfied — it is the supertype that disqualifies it.
    expect(errors).not.toContain("championTagMismatch");
  });

  it("rejects a unit carrying no supertype at all", () => {
    const { deck, cards } = decked(["Vex"]);
    // `exactOptionalPropertyTypes` is on, so the key is dropped rather than
    // set to undefined — which is also what an untagged card really looks like.
    const { supertypes: _none, ...plain } = cards[deck.champion]!;

    expect(validateDeck(deck, { ...cards, [plain.id]: plain })).toContain(
      "championNotAChampionUnit",
    );
  });
});

/** R103.2.d — "your deck may only contain 3 total Signature cards". */
describe("Signature cards (R103.2.d)", () => {
  function withSignatures(
    count: number,
    tags: string[] = ["Vex"],
  ): { deck: Deck; cards: Record<CardId, CardInstance> } {
    const legend: CardInstance = {
      id: "gloomist",
      name: "Gloomist",
      type: "legend",
      cost: FREE,
      keywords: [],
      tags: ["Vex"],
      abilities: [],
    };
    const champion: CardInstance = {
      ...unit("vex", { might: 4, tags: ["Vex"], supertypes: ["champion"] }),
      name: "Vex, Apathetic",
    };
    const signatures = Array.from({ length: count }, (_, i) => ({
      ...unit(`sig${i}`, { might: 2, tags, supertypes: ["signature" as const] }),
      name: `Signature ${i}`,
    }));
    const filler = Array.from({ length: 39 - count }, (_, i) => ({
      ...unit(`f${i}`, { might: 1 }),
      name: `Filler ${i}`,
    }));
    const runes = Array.from({ length: 12 }, (_, i) => ({
      ...unit(`r${i}`),
      type: "rune" as const,
      domain: "chaos" as const,
      name: `Rune ${i}`,
    }));
    const bfs = ["one", "two", "three"].map((n) => ({
      ...unit(`bf-${n}`),
      type: "battlefield" as const,
      name: n,
    }));

    const cards: Record<CardId, CardInstance> = {};
    for (const card of [legend, champion, ...signatures, ...filler, ...runes, ...bfs]) {
      cards[card.id] = card;
    }
    return {
      cards,
      deck: {
        legend: legend.id,
        champion: champion.id,
        mainDeck: [
          champion.id,
          ...signatures.map((c) => c.id),
          ...filler.map((c) => c.id),
        ],
        runeDeck: runes.map((c) => c.id),
        battlefields: bfs.map((c) => c.id),
      },
    };
  }

  it("accepts three", () => {
    const { deck, cards } = withSignatures(3);
    expect(validateDeck(deck, cards)).toEqual([]);
  });

  /** R103.2.d.1 — "Regardless of name, a sum total of 3." */
  it("rejects a fourth, even under four different names", () => {
    const { deck, cards } = withSignatures(4);
    expect(validateDeck(deck, cards)).toContain("tooManySignatureCards");
    // Not R103.2.b's per-name limit — every one of them is a different name.
    expect(validateDeck(deck, cards)).not.toContain("tooManyCopies");
  });

  /** R103.2.d.2 — they must carry the Legend's Champion tag. */
  it("rejects one belonging to another champion", () => {
    const { deck, cards } = withSignatures(1, ["Annie"]);
    expect(validateDeck(deck, cards)).toContain("signatureTagMismatch");
  });
});

/** R187 names each standard token's tags outright. */
describe("token tags (R187)", () => {
  it("gives each token the tag the rules name", () => {
    expect(TOKEN_DEFINITIONS.recruit.tags).toEqual(["Recruit"]);
    expect(TOKEN_DEFINITIONS.sprite.tags).toEqual(["Fae"]);
    expect(TOKEN_DEFINITIONS.sandSoldier.tags).toEqual(["Shurima"]);
    expect(TOKEN_DEFINITIONS.mech.tags).toEqual(["Mech"]);
    expect(TOKEN_DEFINITIONS.bird.tags).toEqual(["Bird"]);
    expect(TOKEN_DEFINITIONS.tentacle.tags).toEqual(["Bilgewater"]);
  });

  it("carries them onto the minted card", () => {
    expect(tokenCard("mech", "mech-1").tags).toEqual(["Mech"]);
  });

  /**
   * R187.2 and R187.7 name a keyword each, and both were noted as unmodelled
   * when the tokens were transcribed. Both exist now.
   */
  it("gives the Sprite [Temporary] and the Bird [Deflect]", () => {
    expect(TOKEN_DEFINITIONS.sprite.keywords).toEqual(["temporary"]);
    expect(TOKEN_DEFINITIONS.bird.keywords).toEqual(["deflect"]);
  });
});
