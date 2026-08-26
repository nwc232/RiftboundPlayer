import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  attachSelf,
  banishThenPlay,
  drawPerBattlefield,
  lookAtTop,
  mutualDamage,
  readyRunes,
  recycleFromOpponentHand,
  restrictMovement,
  swapLocations,
  swapMight,
} from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { keywordsOf, mightOf } from "../src/layers.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { runTasks } from "../src/tasks.js";
import { makeState, pool, runeCard, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

const context = (targets: string[], sourceId = "source"): EffectContext => ({
  controller: "p1",
  sourceId,
  targets,
});

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/** R433 — Switcheroo's "Swap the Might of two units at the same battlefield". */
describe("swapping Might (R433)", () => {
  function pair(a: number, b: number): GameState {
    return makeState({
      cards: [unit("big", { might: a }), unit("small", { might: b })],
      permanents: [
        { cardId: "big", controller: "p1", location: NORTH },
        { cardId: "small", controller: "p1", location: NORTH },
      ],
      battlefields: ["bf-north"],
    });
  }

  /** R433.1.b — apply the difference as an increase to one, a decrease to the other. */
  it("reverses the two values", () => {
    const after = execute(
      pair(5, 2),
      swapMight("thisTurn"),
      context(["big", "small"]),
    ).state;

    expect(mightOf(after, "big")).toBe(2);
    expect(mightOf(after, "small")).toBe(5);
  });

  /** R433.1.c — "If both attributes are the same numeric value, Swapping has no effect." */
  it("does nothing at all when they are equal", () => {
    const after = execute(
      pair(3, 3),
      swapMight("thisTurn"),
      context(["big", "small"]),
    );

    expect(after.state.modifiers).toEqual([]);
    expect(after.events).toEqual([]);
  });
});

/** Tideturner — "Move me to its location and it to my original location." */
describe("swapping locations", () => {
  it("exchanges the two units", () => {
    const state = makeState({
      cards: [unit("source", { might: 2 }), unit("ally", { might: 2 })],
      permanents: [
        { cardId: "source", controller: "p1", location: NORTH },
        { cardId: "ally", controller: "p1", location: SOUTH },
      ],
      battlefields: ["bf-north", "bf-south"],
    });

    const after = execute(state, swapLocations(), context(["ally"])).state;

    expect(after.permanents.source?.location).toEqual(SOUTH);
    expect(after.permanents.ally?.location).toEqual(NORTH);
  });
});

/** Rampage — "They deal damage equal to their Mights to each other." */
describe("mutual damage", () => {
  it("reads both amounts before either lands", () => {
    const state = makeState({
      cards: [unit("mine", { might: 3 }), unit("theirs", { might: 4 })],
      permanents: [
        { cardId: "mine", controller: "p1", location: NORTH },
        { cardId: "theirs", controller: "p2", location: NORTH },
      ],
      battlefields: ["bf-north"],
    });

    const after = execute(
      state,
      mutualDamage(),
      context(["mine", "theirs"]),
    ).state;

    expect(after.permanents.mine?.damage).toBe(4);
    expect(after.permanents.theirs?.damage).toBe(3);
  });
});

/** Targon's Peak — "ready 2 runes at the end of this turn". */
describe("readying runes", () => {
  it("readies only exhausted ones, up to the count", () => {
    const base = makeState({
      p1: { runes: ["r1", "r2", "r3"] },
      cards: [runeCard("r1", "fury"), runeCard("r2", "fury"), runeCard("r3", "fury"), unit("source")],
    });
    const exhausted: GameState = {
      ...base,
      runes: {
        r1: { cardId: "r1", domain: "fury", exhausted: true },
        r2: { cardId: "r2", domain: "fury", exhausted: true },
        r3: { cardId: "r3", domain: "fury", exhausted: true },
      },
    };

    const after = execute(exhausted, readyRunes(2), context([])).state;

    expect(after.runes.r1?.exhausted).toBe(false);
    expect(after.runes.r2?.exhausted).toBe(false);
    expect(after.runes.r3?.exhausted).toBe(true);
  });
});

/** Seat of Power — "draw 1 for each other battlefield you control". */
describe("drawing per battlefield", () => {
  it("counts only the ones the controller holds", () => {
    const state = makeState({
      p1: { mainDeck: ["a", "b", "c"] },
      cards: [unit("a"), unit("b"), unit("c"), unit("source")],
      battlefields: [["bf-north", "p1"], ["bf-south", "p1"], ["bf-east", "p2"]],
    });

    const after = execute(state, drawPerBattlefield(), context([])).state;

    expect(after.players.p1.hand).toEqual(["a", "b"]);
  });

  it("excludes the source's own battlefield when asked", () => {
    const state = makeState({
      p1: { mainDeck: ["a", "b"] },
      cards: [unit("a"), unit("b")],
      battlefields: [["bf-north", "p1"], ["bf-south", "p1"]],
    });

    const after = execute(
      state,
      drawPerBattlefield({ excludeSource: true }),
      context([], "bf-north"),
    ).state;

    expect(after.players.p1.hand).toEqual(["a"]);
  });
});

/** Vex, Apathetic — "They can't move it this turn." */
describe("restricting movement", () => {
  it("blocks the standard move but leaves the unit ready", () => {
    const state = makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [unit("stuck", { might: 2 }), unit("a"), unit("b")],
      permanents: [{ cardId: "stuck", controller: "p1" }],
      battlefields: ["bf-north"],
    });
    const restricted = execute(
      state,
      restrictMovement("thisTurn"),
      context(["stuck"]),
    ).state;

    expect(restricted.permanents.stuck?.exhausted).toBe(false);
    expect(
      applyAction(restricted, {
        type: "standardMove",
        playerId: "p1",
        cardId: "stuck",
        destination: NORTH,
      }),
    ).toEqual({ ok: false, reason: "cannotMove" });
  });
});

/** Thrill of the Hunt — "Banish a friendly unit, then its owner plays it…". */
describe("banish then play", () => {
  it("brings it back to the chosen battlefield, and it counts as played", () => {
    const state = makeState({
      cards: [unit("hero", { might: 3 })],
      permanents: [{ cardId: "hero", controller: "p1", exhausted: true }],
      battlefields: ["bf-north", "bf-south"],
    });

    const after = execute(
      state,
      banishThenPlay(),
      context(["hero", "bf-south"]),
    );

    expect(after.state.permanents.hero?.location).toEqual(SOUTH);
    // R359.2.c — it was played, so it enters exhausted again.
    expect(after.state.permanents.hero?.exhausted).toBe(true);
    expect(after.events.map((e) => e.type)).toEqual(["banished", "unitPlayed"]);
  });

  /** R186.1 — a token put into a non-board zone ceases to exist. */
  it("a token banished this way does not come back", () => {
    const state = makeState({
      cards: [{ ...unit("token", { might: 3 }), isToken: true }],
      permanents: [{ cardId: "token", controller: "p1" }],
      battlefields: ["bf-south"],
    });

    const after = execute(state, banishThenPlay(), context(["token", "bf-south"]));

    expect(after.state.permanents.token).toBeUndefined();
  });
});

/** R718 / R818 — Boots of Swiftness: [Equip] [Chaos], +2 Might, [Ganking]. */
describe("attachments (R718)", () => {
  const boots: CardInstance = {
    id: "boots",
    name: "Boots of Swiftness",
    type: "gear",
    cost: { ...FREE, energy: 3 },
    keywords: [],
    abilities: [
      {
        kind: "activated",
        timing: "default",
        costs: [{ kind: "pay", cost: { ...FREE, power: { chaos: 1 } } }],
        effect: attachSelf(),
        targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      },
    ],
    attachment: { mightBonus: 2, keywords: ["ganking"] },
  };

  function board(): GameState {
    return makeState({
      p1: {
        hand: ["boots"],
        mainDeck: ["a"],
        runePool: pool({ energy: 9, power: { chaos: 1 } }),
      },
      cards: [boots, unit("hero", { might: 3 }), unit("a")],
      permanents: [{ cardId: "hero", controller: "p1" }],
      battlefields: ["bf-north"],
    });
  }

  const PLAY: Action = {
    type: "playUnitFromHand",
    playerId: "p1",
    cardId: "boots",
  };
  const EQUIP: Action = {
    type: "activateAbility",
    playerId: "p1",
    sourceId: "boots",
    abilityIndex: 0,
    targets: ["hero"],
  };

  /** R359.2.d — non-unit gear "enters the Board Ready at the player's Base". */
  it("enters ready at base", () => {
    const state = run(board(), [PLAY]);

    expect(state.permanents.boots?.exhausted).toBe(false);
    expect(state.permanents.boots?.location).toEqual({
      kind: "base",
      player: "p1",
    });
  });

  /** R434.1.c/d — the Top-Most Card gains the Effect Text and the Might Bonus. */
  it("lends its Might Bonus and Effect Text to the unit", () => {
    const state = run(board(), [PLAY, EQUIP]);

    expect(state.permanents.boots?.attachedTo).toBe("hero");
    expect(mightOf(state, "hero")).toBe(5);
    expect(keywordsOf(state, "hero")).toContain("ganking");
  });

  /** R718.2 — "the card's printed Rules Text is Inactive" while attached. */
  it("silences its own rules text once attached", () => {
    const state = run(board(), [PLAY, EQUIP]);

    expect(
      applyAction(state, EQUIP),
    ).toEqual({ ok: false, reason: "abilityNotFound" });
  });

  it("refuses to equip without the Power", () => {
    const broke = run(board(), [PLAY]);
    const empty: GameState = {
      ...broke,
      players: {
        ...broke.players,
        p1: { ...broke.players.p1, runePool: pool() },
      },
    };

    expect(applyAction(empty, EQUIP)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });
});

/** Stacked Deck — "Look at the top 3 … Put 1 into your hand, recycle the rest." */
describe("looking at the top of the deck", () => {
  function deckBoard(): GameState {
    return makeState({
      p1: { mainDeck: ["a", "b", "c", "d"] },
      cards: ["a", "b", "c", "d"].map((id) => unit(id)),
    });
  }

  it("asks which to keep", () => {
    const after = execute(deckBoard(), lookAtTop(3, 1), context([]));

    expect(after.state.tasks).toEqual([
      {
        kind: "chooseFromRevealed",
        player: "p1",
        legal: ["a", "b", "c"],
        keep: 1,
        source: "mainDeck",
      },
    ]);
  });

  it("puts the choice in hand and recycles the rest (R416.1)", () => {
    const queued = execute(deckBoard(), lookAtTop(3, 1), context([])).state;
    // The queue is what asks — R334.1 works it through once resolution ends.
    const asked = runTasks(queued).state;
    expect(asked.pending?.prompt).toEqual({
      kind: "chooseFromRevealed",
      legal: ["a", "b", "c"],
      keep: 1,
    });

    const answered = run(asked, [
      { type: "decide", playerId: "p1", targets: ["b"] },
    ]);

    expect(answered.players.p1.hand).toEqual(["b"]);
    // "d" was under the looked-at three; "a" and "c" went to the bottom.
    expect(answered.players.p1.mainDeck).toEqual(["d", "a", "c"]);
  });
});

/** Sabotage — "Choose a non-unit card from it, and recycle that card." */
describe("recycling from an opponent's hand", () => {
  it("offers only the non-unit cards", () => {
    const state = makeState({
      p2: { hand: ["theirUnit", "theirSpell"], mainDeck: [] },
      cards: [
        unit("theirUnit"),
        { ...unit("theirSpell"), type: "spell" as const },
        unit("source"),
      ],
    });

    const after = execute(state, recycleFromOpponentHand("unit"), context([]));

    expect(after.state.tasks).toEqual([
      {
        kind: "chooseFromRevealed",
        player: "p1",
        legal: ["theirSpell"],
        keep: 0,
        source: "opponentHand",
      },
    ]);
  });

  it("recycles it with no choice to make when only one qualifies", () => {
    const state = makeState({
      p2: { hand: ["theirUnit", "theirSpell"], mainDeck: [] },
      cards: [
        unit("theirUnit"),
        { ...unit("theirSpell"), type: "spell" as const },
        unit("source"),
      ],
    });
    const queued = execute(state, recycleFromOpponentHand("unit"), context([])).state;

    // Only one legal card, so there is nothing to ask and the queue just does it.
    const after = runTasks(queued).state;

    expect(after.players.p2.hand).toEqual(["theirUnit"]);
    expect(after.players.p2.mainDeck).toEqual(["theirSpell"]);
  });
});
