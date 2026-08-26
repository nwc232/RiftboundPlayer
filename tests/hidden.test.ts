import { describe, expect, it } from "vitest";
import { applyAction, hide, playUnitFromHand } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { draw, spell } from "../src/builders.js";
import { FREE, totals } from "../src/cost.js";
import { legalActions } from "../src/legal.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const P1_BASE: Location = { kind: "base", player: "p1" };

/** Evelynn, Entrancing — a [Hidden] unit. */
function hiddenUnit(id: string): CardInstance {
  return unit(id, { might: 3, keywords: ["hidden"] });
}

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/** p1 controls bf-north with a unit there, holds `card`, and has 1 Power. */
function board(card: CardInstance): GameState {
  return makeState({
    p1: {
      hand: [card.id],
      mainDeck: ["a", "b"],
      runePool: pool({ power: { fury: 1 } }),
    },
    p2: { mainDeck: ["c"] },
    cards: [card, unit("garrison", { might: 1 }), unit("a"), unit("b"), unit("c")],
    permanents: [{ cardId: "garrison", controller: "p1", location: NORTH }],
    battlefields: [["bf-north", "p1"], "bf-south"],
  });
}

const HIDE: Action = {
  type: "hide",
  playerId: "p1",
  cardId: "eve",
  battlefieldId: "bf-north",
};

/** R421 — "Hiding a card is the act of placing a card facedown at a Battlefield you control." */
describe("hiding a card (R421)", () => {
  it("moves it out of hand into the battlefield's facedown zone", () => {
    const state = run(board(hiddenUnit("eve")), [HIDE]);

    expect(state.players.p1.hand).toEqual([]);
    expect(state.facedown["bf-north"]).toEqual({
      cardId: "eve",
      controller: "p1",
      hiddenOnTurn: 1,
    });
  });

  /** R811.1.b — the cost is "[A]", one Power of any domain. */
  it("costs one Power of any domain", () => {
    const state = run(board(hiddenUnit("eve")), [HIDE]);

    expect(totals(state.players.p1.runePool).power).toEqual({});
  });

  it("refuses without the Power to pay", () => {
    const broke: GameState = {
      ...board(hiddenUnit("eve")),
      players: {
        ...board(hiddenUnit("eve")).players,
        p1: { ...board(hiddenUnit("eve")).players.p1, runePool: pool() },
      },
    };

    expect(applyAction(broke, HIDE)).toEqual({
      ok: false,
      reason: "cannotAffordCost",
    });
  });

  /** R811.1 — the keyword is the prerequisite for the action. */
  it("refuses a card without [Hidden]", () => {
    const plain = board(unit("eve", { might: 3 }));

    expect(applyAction(plain, HIDE)).toEqual({
      ok: false,
      reason: "notHidden",
    });
  });

  /** R107.3.c — "only be placed in… if the controller also controls the Battlefield". */
  it("refuses a battlefield the player does not control", () => {
    expect(
      applyAction(board(hiddenUnit("eve")), { ...HIDE, battlefieldId: "bf-south" }),
    ).toEqual({ ok: false, reason: "battlefieldNotControlled" });
  });

  /** R107.3.b — "maximum occupancy of one card". */
  it("refuses a zone that already holds a card", () => {
    const once = run(board(hiddenUnit("eve")), [HIDE]);
    const withSecond: GameState = {
      ...once,
      players: {
        ...once.players,
        p1: {
          ...once.players.p1,
          hand: ["eve2"],
          runePool: pool({ power: { fury: 1 } }),
        },
      },
      cards: { ...once.cards, eve2: hiddenUnit("eve2") },
    };

    expect(
      applyAction(withSecond, { ...HIDE, cardId: "eve2" }),
    ).toEqual({ ok: false, reason: "facedownZoneOccupied" });
  });

  /** R811.1.c.2 — "Hiding a card does not open a chain." */
  it("does not open a chain", () => {
    const state = run(board(hiddenUnit("eve")), [HIDE]);

    expect(state.chain).toEqual([]);
    expect(state.priority).toBeNull();
  });
});

/**
 * R811.1.b — "Beginning on the next turn, this gains [Reaction] and you may
 * play this, ignoring its base cost."
 */
describe("playing from facedown (R811.1.b)", () => {
  function hiddenSince(turn: number, card: CardInstance): GameState {
    const base = board(card);
    return {
      ...base,
      turn: { ...base.turn, number: turn },
      players: {
        ...base.players,
        p1: { ...base.players.p1, hand: [], runePool: pool() },
      },
      facedown: {
        "bf-north": { cardId: card.id, controller: "p1", hiddenOnTurn: 1 },
      },
    };
  }

  const PLAY: Action = {
    type: "playUnitFromHand",
    playerId: "p1",
    cardId: "eve",
    destination: NORTH,
  };

  it("cannot be played on the turn it was hidden", () => {
    // Not yet playable from facedown, and not in hand either — R811.1.b's
    // "beginning on the next turn" is a whole turn of being untouchable.
    expect(applyAction(hiddenSince(1, hiddenUnit("eve")), PLAY)).toEqual({
      ok: false,
      reason: "notInHand",
    });
  });

  it("plays for nothing on a later turn", () => {
    const state = run(hiddenSince(2, hiddenUnit("eve")), [PLAY]);

    // A costed card, played with an empty pool.
    expect(state.permanents.eve?.location).toEqual(NORTH);
    expect(state.facedown["bf-north"]).toBeUndefined();
  });

  /** R811.1.d.1 — "A hidden permanent must be played to that battlefield." */
  it("cannot be played anywhere else", () => {
    const result = playUnitFromHand(
      hiddenSince(2, hiddenUnit("eve")),
      "p1",
      "eve",
      P1_BASE,
    );

    expect(result).toEqual({ ok: false, reason: "invalidDestination" });
  });

  /** R811.6 — "gains Reaction while facedown or played from facedown". */
  it("plays during the opponent's showdown", () => {
    const base = hiddenSince(2, hiddenUnit("eve"));
    const theirTurn: GameState = {
      ...base,
      turn: { player: "p2", phase: "main", number: 2 },
      showdown: {
        battlefieldId: "bf-north",
        attacker: "p2",
        focus: "p1",
        consecutivePasses: 0,
      },
    };

    const state = run(theirTurn, [PLAY]);

    expect(state.permanents.eve?.location).toEqual(NORTH);
  });

  /** Back Off is a [Hidden] spell, so the same permissions reach the chain. */
  it("puts a hidden spell on the chain for free", () => {
    const backOff: CardInstance = {
      ...spell("eve", "Back Off", { ...FREE, energy: 3 }, draw(1)),
      keywords: ["hidden", "action"],
    };

    const state = run(hiddenSince(2, backOff), [
      { type: "playSpell", playerId: "p1", cardId: "eve", targets: [] },
    ]);

    expect(state.chain).toHaveLength(1);
    expect(state.facedown["bf-north"]).toBeUndefined();
  });
});

/**
 * R323.7 — "Remove all Hidden cards from all Battlefields that are not
 * controlled by the same player and place them in their owner's Trash."
 */
describe("losing the battlefield (R323.7)", () => {
  it("trashes what was hidden there", () => {
    const hidden = run(board(hiddenUnit("eve")), [HIDE]);
    // R190.4.c takes control away in the cleanup once no units are left there.
    const abandoned: GameState = {
      ...hidden,
      permanents: {},
    };

    const state = run(abandoned, [{ type: "drawCard", playerId: "p1" }]);

    expect(state.facedown["bf-north"]).toBeUndefined();
    expect(state.players.p1.trash).toEqual(["eve"]);
  });

  it("leaves it alone while control holds", () => {
    const hidden = run(board(hiddenUnit("eve")), [HIDE]);

    const state = run(hidden, [{ type: "drawCard", playerId: "p1" }]);

    expect(state.facedown["bf-north"]?.cardId).toBe("eve");
  });
});

describe("legal actions cover both halves", () => {
  it("offers the hide, and only at a controlled empty zone", () => {
    const hides = legalActions(board(hiddenUnit("eve")), "p1").filter(
      (action) => action.type === "hide",
    );

    expect(hides).toEqual([HIDE]);
  });

  it("offers the facedown play once the turn has rolled over", () => {
    const hidden = run(board(hiddenUnit("eve")), [HIDE]);
    const nextTurn: GameState = {
      ...hidden,
      turn: { ...hidden.turn, number: 2 },
    };

    const plays = legalActions(nextTurn, "p1").flatMap((action) =>
      action.type === "playUnitFromHand" && action.cardId === "eve"
        ? [action.destination]
        : [],
    );

    expect(plays).toEqual([NORTH]);
  });
});
