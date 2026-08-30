import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  counterSpell,
  forEachPlayer,
  restrictPlayer,
  restrictionAura,
  spell,
} from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { legalActions } from "../src/legal.js";
import { expireModifiers } from "../src/layers.js";
import { cannotPlay } from "../src/restrictions.js";
import { score } from "../src/scoring.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * The "can't" rules whose subject is not a permanent — a player, a
 * battlefield, a spell on the chain.
 *
 * Swept off the board rather than layered, for R711's reason: the thing being
 * restricted has no permanent to carry a characteristic, so the board has to
 * be read when the question is asked. Every card here is authored from its
 * printed text.
 */

const NORTH = { kind: "battlefield", id: "bf-north" } as const;
const SOUTH = { kind: "battlefield", id: "bf-south" } as const;

/** Tianna Crownguard — "While I'm at a battlefield, opponents can't score points." */
describe("a restriction on scoring", () => {
  const tianna: CardInstance = {
    ...unit("tianna", { might: 5 }),
    abilities: [restrictionAura("score", "enemy")],
  };

  function board(location: typeof NORTH | { kind: "base"; player: "p1" }): GameState {
    return makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"], points: 3 },
      cards: [tianna, unit("a"), unit("b")],
      permanents: [{ cardId: "tianna", controller: "p1", location }],
      battlefields: [["bf-north", "p2"], ["bf-south", "p2"]],
    });
  }

  it("stops the opponent scoring", () => {
    const after = score(board(NORTH), "p2", "bf-north", "hold");

    expect(after.state.players.p2.points).toBe(3);
    expect(after.events).toEqual([]);
  });

  /** "*opponents*" — its own controller is untouched. */
  it("leaves its own controller scoring", () => {
    const state = board(NORTH);
    const held: GameState = {
      ...state,
      battlefields: {
        ...state.battlefields,
        "bf-north": { ...state.battlefields["bf-north"]!, controller: "p1" },
      },
    };
    const after = score(held, "p1", "bf-north", "hold");

    expect(after.state.players.p1.points).toBe(1);
  });
});

/**
 * Forgotten Monument — "Players can't score here until their third turn."
 * A battlefield's own restriction, which reaches both players and only itself.
 */
describe("a battlefield that restricts scoring at itself", () => {
  const monument: CardInstance = {
    ...unit("bf-north", { might: 0 }),
    type: "battlefield" as CardInstance["type"],
    abilities: [restrictionAura("score", "any", { here: true, untilTurn: 3 })],
  };

  function board(turnNumber: number): GameState {
    const base = makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [monument, unit("bf-south"), unit("a"), unit("b")],
      battlefields: [["bf-north", "p1"], ["bf-south", "p1"]],
    });
    return { ...base, turn: { ...base.turn, number: turnNumber } };
  }

  it("stops a score there before the third turn", () => {
    expect(score(board(2), "p1", "bf-north", "hold").state.players.p1.points).toBe(0);
  });

  it("allows it from the third turn on", () => {
    expect(score(board(3), "p1", "bf-north", "hold").state.players.p1.points).toBe(1);
  });

  /** "…*here*" — the other battlefield is not covered. */
  it("leaves the other battlefield alone", () => {
    expect(score(board(2), "p1", "bf-south", "hold").state.players.p1.points).toBe(1);
  });
});

/** Brynhir Thundersong — "opponents can't play cards this turn." */
describe("a restriction on playing", () => {
  function board(source: CardInstance): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: {
        hand: ["recruit", "bolt"],
        mainDeck: ["b"],
        runePool: pool({ energy: 9 }),
      },
      cards: [
        source,
        unit("recruit", { might: 2 }),
        spell("bolt", "Bolt", FREE, { op: "draw", count: 1 }),
        unit("a"),
        unit("b"),
      ],
      permanents: [{ cardId: source.id, controller: "p1", location: NORTH }],
      battlefields: [["bf-north", "p2"], ["bf-south", "p2"]],
    });
  }

  /** It is p2 who is restricted, so it has to be p2's turn to play anything. */
  function theirTurn(source: CardInstance): GameState {
    const state = board(source);
    return { ...state, turn: { ...state.turn, player: "p2" } };
  }

  const brynhir: CardInstance = {
    ...unit("brynhir", { might: 4 }),
    abilities: [restrictionAura("play", "enemy")],
  };

  it("stops a unit and a spell alike", () => {
    const state = theirTurn(brynhir);

    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
      }),
    ).toEqual({ ok: false, reason: "cannotPlay" });
    expect(
      applyAction(state, { type: "playSpell", playerId: "p2", cardId: "bolt" }),
    ).toEqual({ ok: false, reason: "cannotPlay" });
  });

  /** Fallen Feline — "opponents can't play spells with that name." */
  it("can name a single card", () => {
    const feline: CardInstance = {
      ...unit("feline", { might: 2 }),
      abilities: [
        restrictionAura("play", "enemy", { match: { type: "spell", name: "Bolt" } }),
      ],
    };
    const state = theirTurn(feline);

    expect(
      applyAction(state, { type: "playSpell", playerId: "p2", cardId: "bolt" }).ok,
    ).toBe(false);
    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
      }).ok,
    ).toBe(true);
  });

  /** Rockfall Path — "Units can't be played here." */
  it("can name a battlefield", () => {
    const path: CardInstance = {
      ...unit("bf-north", { might: 0 }),
      abilities: [
        restrictionAura("play", "any", { here: true, match: { type: "unit" } }),
      ],
    };
    const state = theirTurn(path);

    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
        destination: NORTH,
      }).ok,
    ).toBe(false);
    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
        destination: SOUTH,
      }).ok,
    ).toBe(true);
  });

  /** Mageseeker Warden — "opponents can only play units to their base." */
  it("can forbid everywhere but the base", () => {
    const warden: CardInstance = {
      ...unit("warden", { might: 3 }),
      abilities: [restrictionAura("play", "enemy", { exceptToBase: true })],
    };
    const state = theirTurn(warden);

    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
        destination: NORTH,
      }).ok,
    ).toBe(false);
    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
        destination: { kind: "base", player: "p2" },
      }).ok,
    ).toBe(true);
  });
});

/** Mel, Newly Awakened — "your spells and abilities can't be countered." */
describe("a restriction on countering", () => {
  const mel: CardInstance = {
    ...unit("mel", { might: 3 }),
    abilities: [restrictionAura("beCountered", "friendly")],
  };

  function onChain(withMel: boolean): GameState {
    const base = makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [
        mel,
        spell("bolt", "Bolt", FREE, { op: "draw", count: 1 }),
        unit("a"),
        unit("b"),
      ],
      ...(withMel
        ? { permanents: [{ cardId: "mel", controller: "p1" }] }
        : {}),
    });
    return {
      ...base,
      chain: [{ kind: "spell", cardId: "bolt", controller: "p1", targets: [] }],
    };
  }

  const context: EffectContext = {
    controller: "p2",
    sourceId: "source",
    targets: ["bolt"],
  };

  it("keeps the spell on the chain", () => {
    const after = execute(onChain(true), counterSpell(), context);

    expect(after.state.chain).toHaveLength(1);
  });

  it("counters it with nothing protecting it", () => {
    const after = execute(onChain(false), counterSpell(), context);

    expect(after.state.chain).toHaveLength(0);
  });
});


/**
 * The durational half: Brynhir Thundersong — "When you play me, opponents
 * can't play cards this turn" — and Lilting Lullaby — "Counter a spell. Its
 * controller can't play spells this turn."
 *
 * The same restriction the printed ones express, installed by an effect with a
 * lifetime. R133 makes a player a Game Object, so `forEachPlayer` supplies one
 * per opponent and the modifier list carries it until R317.2.c ends the turn.
 */
describe("a restriction that lasts the turn", () => {
  function table(): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: {
        hand: ["recruit", "bolt"],
        mainDeck: ["b"],
        runePool: pool({ energy: 9 }),
      },
      cards: [
        unit("recruit", { might: 2 }),
        spell("bolt", "Bolt", FREE, { op: "draw", count: 1 }),
        unit("a"),
        unit("b"),
      ],
    });
  }

  const theirTurn = (state: GameState): GameState => ({
    ...state,
    turn: { ...state.turn, player: "p2" },
  });

  /** Brynhir — "opponents can't play cards this turn." */
  it("stops every opponent from playing anything", () => {
    const after = execute(
      table(),
      forEachPlayer(restrictPlayer({ what: "play" }), "eachOpponent"),
      { controller: "p1", sourceId: "brynhir", targets: [] },
    );
    const state = theirTurn(after.state);

    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
      }),
    ).toEqual({ ok: false, reason: "cannotPlay" });
  });

  /** Lilting Lullaby — one named player, and spells only. */
  it("can name one player and one card type", () => {
    const after = execute(
      table(),
      restrictPlayer({ what: "play", match: { type: "spell" } }),
      { controller: "p1", sourceId: "lullaby", targets: ["p2"] },
    );
    const state = theirTurn(after.state);

    expect(
      applyAction(state, { type: "playSpell", playerId: "p2", cardId: "bolt" }).ok,
    ).toBe(false);
    expect(
      applyAction(state, {
        type: "playUnitFromHand",
        playerId: "p2",
        cardId: "recruit",
      }).ok,
    ).toBe(true);
  });

  it("leaves the other player alone", () => {
    const after = execute(
      table(),
      restrictPlayer({ what: "play" }),
      { controller: "p1", sourceId: "lullaby", targets: ["p2"] },
    );

    expect(cannotPlay(after.state, "p1", "recruit")).toBe(false);
    expect(cannotPlay(after.state, "p2", "recruit")).toBe(true);
  });

  /** R317.2.c — "this turn" ends when the turn does. */
  it("expires with the turn", () => {
    const after = execute(
      table(),
      restrictPlayer({ what: "play" }),
      { controller: "p1", sourceId: "lullaby", targets: ["p2"] },
    );

    expect(cannotPlay(expireModifiers(after.state, "thisTurn"), "p2", "recruit")).toBe(
      false,
    );
  });
});


/**
 * `legalActions` is the only legality authority, so a restricted play has to
 * stop being *offered*, not merely stop being accepted.
 */
describe("finding what a restriction forbids", () => {
  it("offers no play at all while one forbids them", () => {
    const brynhir: CardInstance = {
      ...unit("brynhir", { might: 4 }),
      abilities: [restrictionAura("play", "enemy")],
    };
    const state = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: {
        hand: ["recruit", "bolt"],
        mainDeck: ["b"],
        runePool: pool({ energy: 9 }),
      },
      cards: [
        brynhir,
        unit("recruit", { might: 2 }),
        spell("bolt", "Bolt", FREE, { op: "draw", count: 1 }),
        unit("a"),
        unit("b"),
      ],
      permanents: [{ cardId: "brynhir", controller: "p1" }],
    });
    const theirs: GameState = { ...state, turn: { ...state.turn, player: "p2" } };

    const plays = legalActions(theirs, "p2").filter(
      (action) =>
        action.type === "playUnitFromHand" || action.type === "playSpell",
    );

    expect(plays).toEqual([]);
  });
});
