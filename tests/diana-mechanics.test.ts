import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import { applyAction } from "../src/actions.js";
import { legalTargets } from "../src/decisions.js";
import { mightOf } from "../src/layers.js";
import { legalActions } from "../src/legal.js";
import { playZonesFor } from "../src/zones.js";
import { choicePoolFor } from "../src/costing.js";
import { FREE } from "../src/cost.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, cost, pool, unit } from "./fixtures.js";

/** The seven things the Diana list wanted that the engine could not say. */

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const context = { controller: "p1" as const, sourceId: "src", targets: [] };

function board(): GameState {
  return makeState({
    p1: { hand: [], mainDeck: ["d1", "d2"], trash: [], runePool: pool({ energy: 9 }) },
    p2: { mainDeck: ["d3"] },
    cards: [
      unit("mine", { might: 4 }),
      unit("theirs", { might: 4 }),
      unit("far", { might: 4 }),
      unit("d1"),
      unit("d2"),
      unit("d3"),
    ],
    permanents: [
      { cardId: "mine", controller: "p1", location: NORTH },
      { cardId: "theirs", controller: "p2", location: NORTH },
      { cardId: "far", controller: "p2", location: { kind: "base", player: "p2" } },
    ],
    battlefields: ["bf-north", "bf-south"],
  });
}

/** Thousand-Tailed Watcher — "give enemy units -3 [M], to a minimum of 1". */
describe("modifying every unit that matches", () => {
  it("catches all of them and leaves your own alone", () => {
    const after = execute(
      board(),
      { op: "modifyMightEach", who: "enemy", amount: -3, duration: "thisTurn", min: 1 },
      context,
    );

    expect(mightOf(after.state, "theirs")).toBe(1);
    expect(mightOf(after.state, "far")).toBe(1);
    expect(mightOf(after.state, "mine")).toBe(4);
  });

  /** Moonfall — "give enemy units *there* -2", confined to one battlefield. */
  it("can be confined to a chosen battlefield", () => {
    const after = execute(
      board(),
      {
        op: "modifyMightEach",
        who: "enemy",
        atTargetIndex: 0,
        amount: -2,
        duration: "thisTurn",
      },
      { ...context, targets: ["bf-north"] },
    );

    expect(mightOf(after.state, "theirs")).toBe(2);
    expect(mightOf(after.state, "far")).toBe(4);
  });

  /** R355.5.a — nothing is chosen, so nothing is a target. */
  it("reaches a unit that cannot be chosen", () => {
    const state = board();
    const warded: GameState = {
      ...state,
      cards: {
        ...state.cards,
        theirs: {
          ...state.cards.theirs!,
          abilities: [
            {
              kind: "passive",
              scope: { target: "self" },
              modification: {
                layer: "ability",
                op: "restrict",
                restriction: { what: "beChosen" },
              },
            },
          ],
        },
      },
    };

    expect(legalTargets(warded, "p1", { type: "unit", controller: "enemy" })).not.toContain("theirs");
    const after = execute(
      warded,
      { op: "modifyMightEach", who: "enemy", amount: -2, duration: "thisTurn" },
      context,
    );
    expect(mightOf(after.state, "theirs")).toBe(2);
  });
});

/** Moonfall — "Choose a battlefield where you have units." */
describe("choosing a battlefield you have units at", () => {
  it("offers only the ones you are standing on", () => {
    expect(
      legalTargets(board(), "p1", { type: "battlefield", withYourUnits: true }),
    ).toEqual(["bf-north"]);
  });
});

/** Hwei — "discard 1, then act on the discarded card's type." */
describe("branching on a card's type", () => {
  function holding(card: CardInstance): GameState {
    const state = board();
    return {
      ...state,
      cards: { ...state.cards, [card.id]: card },
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [card.id] },
      },
    };
  }

  it("takes the arm the discarded card names", () => {
    const after = execute(
      holding({ ...unit("scroll"), type: "spell", cost: FREE }),
      {
        op: "branchOnCardType",
        of: "discardOne",
        arms: { spell: { op: "draw", count: 1 }, unit: { op: "gainXP", amount: 5 } },
      },
      context,
    );

    expect(after.state.players.p1.trash).toEqual(["scroll"]);
    expect(after.state.players.p1.hand).toHaveLength(1); // drew, did not gain XP
    expect(after.state.players.p1.xp).toBe(0);
  });

  it("takes a different arm for a different type", () => {
    const after = execute(
      holding(unit("soldier")),
      {
        op: "branchOnCardType",
        of: "discardOne",
        arms: { spell: { op: "draw", count: 1 }, unit: { op: "gainXP", amount: 5 } },
      },
      context,
    );

    expect(after.state.players.p1.xp).toBe(5);
  });

  /** R383.2 — a type with no arm simply does nothing more. */
  it("does nothing extra for a type with no arm", () => {
    const after = execute(
      holding({ ...unit("tool"), type: "gear" }),
      { op: "branchOnCardType", of: "discardOne", arms: { spell: { op: "draw", count: 1 } } },
      context,
    );

    expect(after.state.players.p1.trash).toEqual(["tool"]);
    expect(after.state.players.p1.hand).toEqual([]);
  });

  /** Diana, Lunari — the same question asked of the top of the deck. */
  it("can read the top of the Main Deck instead, leaving it there", () => {
    const state = board();
    const spellOnTop: GameState = {
      ...state,
      cards: { ...state.cards, d1: { ...state.cards.d1!, type: "spell" } },
    };
    const after = execute(
      spellOnTop,
      { op: "branchOnCardType", of: "revealTop", arms: { spell: { op: "draw", count: 1 } } },
      context,
    );

    // R424.1.a.2 — revealing does not move it; the arm is what drew it.
    expect(after.state.revealed).toContain("d1");
    expect(after.state.players.p1.hand).toEqual(["d1"]);
  });
});

/** Last Rites — "Recycle 2 cards from your trash" as a cost. */
describe("a cost paid out of the trash", () => {
  it("chooses from the trash, not the hand", () => {
    const state = board();
    const stocked: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: ["d2"], trash: ["a", "b"] },
      },
    };

    expect(
      choicePoolFor(
        stocked,
        "p1",
        { kind: "chosen", does: "recycle", fromTrash: true, count: 2 },
        "src",
      ),
    ).toEqual(["a", "b"]);
  });
});

/** Fizz — "play a spell from your trash… ignoring its Energy cost." */
describe("a granted play from the trash", () => {
  function withTrash(): GameState {
    const state = board();
    return {
      ...state,
      cards: {
        ...state.cards,
        bolt: {
          id: "bolt",
          name: "Bolt",
          type: "spell",
          cost: cost({ energy: 3, power: { chaos: 1 } }),
          keywords: [],
          abilities: [],
        },
        big: {
          id: "big",
          name: "Big",
          type: "spell",
          cost: cost({ energy: 9 }),
          keywords: [],
          abilities: [],
        },
      },
      players: {
        ...state.players,
        p1: { ...state.players.p1, trash: ["bolt", "big"] },
      },
    };
  }

  it("opens no trash play on its own", () => {
    expect(playZonesFor(withTrash(), "p1", "bolt")).toEqual([]);
  });

  it("opens one once granted, waiving only the Energy", () => {
    const granted = execute(
      withTrash(),
      {
        op: "grantPlayFromTrash",
        cardType: "spell",
        maxEnergy: 3,
        waiveEnergy: true,
        recycleOnLeave: true,
        duration: "thisTurn",
      },
      context,
    ).state;

    const zones = playZonesFor(granted, "p1", "bolt");
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      source: "trash",
      waiveEnergy: true,
      recycleOnLeave: true,
    });
  });

  /** "…with Energy cost no more than [3]", read as printed (R711). */
  it("does not reach a spell that costs too much", () => {
    const granted = execute(
      withTrash(),
      { op: "grantPlayFromTrash", cardType: "spell", maxEnergy: 3, duration: "thisTurn" },
      context,
    ).state;

    expect(playZonesFor(granted, "p1", "big")).toEqual([]);
  });
});

/** Hard Bargain — "Counter a spell unless its controller pays [2]." */
describe("asking the opponent to pay", () => {
  function onChain(): GameState {
    const state = board();
    return {
      ...state,
      cards: {
        ...state.cards,
        theirSpell: {
          id: "theirSpell",
          name: "Their Spell",
          type: "spell",
          cost: FREE,
          keywords: [],
          abilities: [],
        },
      },
      players: {
        ...state.players,
        p2: { ...state.players.p2, runePool: pool({ energy: 5 }) },
      },
      chain: [
        { kind: "spell", cardId: "theirSpell", controller: "p2", targets: [] },
      ],
    };
  }

  const counter = {
    op: "counterUnlessPaid" as const,
    targetIndex: 0,
    cost: cost({ energy: 2 }),
  };

  it("asks the spell's controller, not the caster", () => {
    const after = execute(onChain(), counter, {
      ...context,
      targets: ["theirSpell"],
    });

    expect(after.pause?.decision.player).toBe("p2");
    expect(after.pause?.decision.prompt.kind).toBe("payOrDecline");
  });

  it("counters it when they decline", () => {
    const after = execute(
      onChain(),
      { op: "resolveUnlessPaid", targetId: "theirSpell", cost: cost({ energy: 2 }) },
      { ...context, answer: [] },
    );

    expect(after.state.chain).toHaveLength(0);
    expect(after.state.players.p2.trash).toContain("theirSpell");
  });

  it("takes the payment and leaves it alone when they pay", () => {
    const after = execute(
      onChain(),
      { op: "resolveUnlessPaid", targetId: "theirSpell", cost: cost({ energy: 2 }) },
      { ...context, answer: ["theirSpell"] },
    );

    expect(after.state.chain).toHaveLength(1);
    expect(after.state.players.p2.runePool.buckets[0]?.energy).toBe(3);
  });

  /** Saying yes with an empty pool does not save it. */
  it("counters it anyway when they cannot actually pay", () => {
    const broke: GameState = (() => {
      const state = onChain();
      return {
        ...state,
        players: { ...state.players, p2: { ...state.players.p2, runePool: pool() } },
      };
    })();
    const after = execute(
      broke,
      { op: "resolveUnlessPaid", targetId: "theirSpell", cost: cost({ energy: 2 }) },
      { ...context, answer: ["theirSpell"] },
    );

    expect(after.state.chain).toHaveLength(0);
  });
});

/** Abandon — "Counter a spell. Return it to its owner's hand instead." */
describe("countering to hand", () => {
  it("sends it to its owner's hand rather than their trash", () => {
    const state = board();
    const withSpell: GameState = {
      ...state,
      cards: {
        ...state.cards,
        theirSpell: {
          id: "theirSpell",
          name: "Their Spell",
          type: "spell",
          cost: FREE,
          keywords: [],
          abilities: [],
        },
      },
      chain: [
        { kind: "spell", cardId: "theirSpell", controller: "p2", targets: [] },
      ],
    };

    const after = execute(
      withSpell,
      { op: "counterSpell", targetIndex: 0, to: "hand" },
      { ...context, targets: ["theirSpell"] },
    );

    expect(after.state.chain).toHaveLength(0);
    expect(after.state.players.p2.hand).toContain("theirSpell");
    expect(after.state.players.p2.trash).not.toContain("theirSpell");
  });
});
