import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { draw, ifThen, playedFrom, returnToHand, seq, spell } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { legalTargets } from "../src/decisions.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/** Star-Crossed — "Return a friendly unit and an enemy unit to their owners' hands." */
const starCrossed: CardInstance = {
  ...spell(
    "star",
    "Star-Crossed",
    { ...FREE, energy: 1 },
    seq(returnToHand(0), returnToHand(1)),
    ["reaction"],
  ),
};
starCrossed.abilities = [
  {
    kind: "activated",
    timing: "reaction",
    costs: [],
    effect: seq(returnToHand(0), returnToHand(1)),
    targeting: {
      filters: [
        { type: "unit", controller: "friendly" },
        { type: "unit", controller: "enemy" },
      ],
    },
  },
];

function board(): GameState {
  return makeState({
    p1: {
      hand: ["star"],
      mainDeck: ["a"],
      runePool: pool({ energy: 9 }),
    },
    p2: { mainDeck: ["b"] },
    cards: [
      starCrossed,
      unit("mine", { might: 2 }),
      unit("theirs", { might: 2 }),
      unit("a"),
      unit("b"),
    ],
    permanents: [
      { cardId: "mine", controller: "p1", location: NORTH },
      { cardId: "theirs", controller: "p2", location: NORTH },
    ],
    battlefields: ["bf-north"],
  });
}

const CAST = (targets: string[]): Action => ({
  type: "playSpell",
  playerId: "p1",
  cardId: "star",
  targets,
});
const RESOLVE: Action[] = [
  { type: "passPriority", playerId: "p1" },
  { type: "passPriority", playerId: "p2" },
];

/** R355.5 — two filters, in the order the card names them. */
describe("two targets with different filters", () => {
  it("takes one of each and returns both", () => {
    const state = run(board(), [CAST(["mine", "theirs"]), ...RESOLVE]);

    expect(state.permanents.mine).toBeUndefined();
    expect(state.permanents.theirs).toBeUndefined();
    expect(seatOf(state, "p1").hand).toEqual(["mine"]);
    expect(seatOf(state, "p2").hand).toEqual(["theirs"]);
  });

  it("refuses two friendly units — the filters are positional", () => {
    expect(applyAction(board(), CAST(["mine", "mine"]))).toEqual({
      ok: false,
      reason: "invalidTarget",
    });
  });

  it("refuses them in the wrong order", () => {
    expect(applyAction(board(), CAST(["theirs", "mine"]))).toEqual({
      ok: false,
      reason: "invalidTarget",
    });
  });

  it("refuses the wrong number (R355.8)", () => {
    expect(applyAction(board(), CAST(["mine"]))).toEqual({
      ok: false,
      reason: "wrongTargetCount",
    });
  });
});

/** R355.6 — a counterspell chooses something that is not a permanent. */
describe("targeting the chain", () => {
  it("finds a spell that is still on it", () => {
    const bolt = spell("bolt", "Bolt", FREE, draw(1));
    const withChain = makeState({
      p1: { hand: ["bolt"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [bolt, unit("a"), unit("b")],
    });
    const played = run(withChain, [
      { type: "playSpell", playerId: "p1", cardId: "bolt", targets: [] },
    ]);

    expect(legalTargets(played, "p2", { type: "spellOnChain" })).toEqual([
      "bolt",
    ]);
    expect(
      legalTargets(played, "p2", { type: "spellOnChain", controller: "friendly" }),
    ).toEqual([]);
  });
});

/**
 * Back Off — "[Stun] a unit. If you played this from your hand, draw 1."
 * R811.3 lets a [Hidden] card be played normally instead, so the same card
 * arrives by two routes and the clause tells them apart.
 */
describe("which zone the card came from", () => {
  const backOff: CardInstance = {
    ...spell("back", "Back Off", { ...FREE, energy: 2 }, draw(1), [
      "hidden",
      "action",
    ]),
  };
  backOff.abilities = [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      effect: ifThen(playedFrom("hand"), draw(1)),
    },
  ];

  function backOffBoard(): GameState {
    return makeState({
      p1: {
        hand: ["back"],
        mainDeck: ["a", "b"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["c"] },
      cards: [backOff, unit("garrison"), unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "garrison", controller: "p1", location: NORTH }],
      battlefields: [["bf-north", "p1"]],
    });
  }

  const CAST_BACK: Action[] = [
    { type: "playSpell", playerId: "p1", cardId: "back", targets: [] },
    ...RESOLVE,
  ];

  it("draws when played from hand", () => {
    expect(seatOf(run(backOffBoard(), CAST_BACK), "p1").hand).toEqual(["a"]);
  });

  it("does not when played from facedown", () => {
    const base = backOffBoard();
    const hidden: GameState = {
      ...base,
      turn: { ...base.turn, number: 2 },
      players: { ...base.players, p1: { ...seatOf(base, "p1"), hand: [] } },
      facedown: {
        "bf-north": { cardId: "back", controller: "p1", hiddenOnTurn: 1 },
      },
    };

    expect(seatOf(run(hidden, CAST_BACK), "p1").hand).toEqual([]);
  });
});
