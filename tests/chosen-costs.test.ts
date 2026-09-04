import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  additionalCost,
  chosenCost,
  discardCost,
  draw,
  activated,
} from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { renderAvailableAbilities } from "../src/demo/render.js";
import { legalActions } from "../src/legal.js";
import { describe as describeAction } from "../src/ui/game.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * R355.1 — a cost that names something to choose.
 *
 * The choice is one of the Relevant Choices made at the *start* of playing a
 * card, which is the moment the action is submitted — so it rides in the
 * action beside `targets` and nothing suspends. Every test here plays the card
 * in one `applyAction` call, which is the whole claim.
 */

/** Cruel Patron — "As an additional cost to play me, kill a friendly unit." */
function patron(cost = chosenCost("kill", { type: "unit", controller: "friendly" })): CardInstance {
  return {
    ...unit("patron", { might: 4 }),
    abilities: [additionalCost([cost], false)],
  };
}

function board(card: CardInstance, hand: string[] = []): GameState {
  return makeState({
    p1: {
      hand: [card.id, ...hand],
      mainDeck: ["deck1", "deck2"],
      runePool: pool({ energy: 9 }),
    },
    p2: { mainDeck: ["deck3"] },
    cards: [
      card,
      unit("pawn", { might: 1 }),
      unit("squire", { might: 2 }),
      unit("ogre", { might: 9 }),
      unit("deck1"),
      unit("deck2"),
      unit("deck3"),
      ...hand.map((id) => unit(id)),
    ],
    permanents: [
      { cardId: "pawn", controller: "p1" },
      { cardId: "squire", controller: "p1" },
      { cardId: "ogre", controller: "p2" },
    ],
  });
}

const play = (costChoices: string[][]): Action => ({
  type: "playUnitFromHand",
  playerId: "p1",
  cardId: "patron",
  costChoices,
});

describe("a cost that kills something you choose", () => {
  it("kills the unit that was named, and only that one", () => {
    const result = applyAction(board(patron()), play([["pawn"]]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn).toBeUndefined();
    expect(result.state.permanents.squire).toBeDefined();
    // R428 — a killed permanent goes to the trash.
    expect(seatOf(result.state, "p1").trash).toContain("pawn");
    expect(result.state.permanents.patron).toBeDefined();
  });

  /** The filter is what may be named, so an enemy unit is not an answer. */
  it("refuses a unit the filter does not admit", () => {
    expect(applyAction(board(patron()), play([["ogre"]]))).toEqual({
      ok: false,
      reason: "cannotAffordCost",
    });
  });

  /** R356.2.a.1 — a mandatory additional cost is not optional. */
  it("refuses the play when nothing was named", () => {
    expect(applyAction(board(patron()), play([[]]))).toEqual({
      ok: false,
      reason: "cannotAffordCost",
    });
  });

  it("refuses the play when there is nothing to kill", () => {
    const empty = makeState({
      p1: { hand: ["patron"], mainDeck: ["d"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["e"] },
      cards: [patron(), unit("d"), unit("e")],
    });

    expect(applyAction(empty, play([[]])).ok).toBe(false);
  });

  /** R355.5.a — one object cannot answer the same choice twice. */
  it("refuses the same unit named twice", () => {
    const ledros = {
      ...patron(chosenCost("kill", { type: "unit", controller: "friendly" }, "any")),
    };
    expect(applyAction(board(ledros), play([["pawn", "pawn"]])).ok).toBe(false);
  });
});

/** Commander Ledros — "kill *any number of* friendly units". */
describe("a cost that takes any number", () => {
  const ledros = () =>
    patron(chosenCost("kill", { type: "unit", controller: "friendly" }, "any"));

  it("accepts several at once", () => {
    const result = applyAction(board(ledros()), play([["pawn", "squire"]]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn).toBeUndefined();
    expect(result.state.permanents.squire).toBeUndefined();
  });

  /** R355.8 — "any number" includes none, so an empty answer still pays it. */
  it("accepts none", () => {
    const result = applyAction(board(ledros()), play([[]]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn).toBeDefined();
    expect(result.state.permanents.patron).toBeDefined();
  });
});

/** Meditation — "you may exhaust a friendly unit". */
describe("a cost that exhausts something you choose", () => {
  const exhauster = (): CardInstance => ({
    ...unit("patron", { might: 4 }),
    abilities: [
      additionalCost(
        [chosenCost("exhaust", { type: "unit", controller: "friendly" })],
        false,
      ),
    ],
  });

  it("exhausts the named unit", () => {
    const result = applyAction(board(exhauster()), play([["squire"]]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.squire?.exhausted).toBe(true);
    expect(result.state.permanents.pawn?.exhausted).toBe(false);
  });

  /** R414.1.b — an already-exhausted object cannot be exhausted again. */
  it("will not take an already-exhausted unit", () => {
    const state = board(exhauster());
    const exhausted: GameState = {
      ...state,
      permanents: {
        ...state.permanents,
        squire: { ...state.permanents.squire!, exhausted: true },
      },
    };

    expect(applyAction(exhausted, play([["squire"]])).ok).toBe(false);
    expect(applyAction(exhausted, play([["pawn"]])).ok).toBe(true);
  });
});

/** Call to Glory, Wallop — "you may spend a buff as an additional cost". */
describe("a cost that spends a buff", () => {
  const spender = (count: number | "any" = 1): CardInstance => ({
    ...unit("patron", { might: 4 }),
    abilities: [
      additionalCost(
        [chosenCost("spendBuff", { type: "unit", controller: "friendly" }, count)],
        false,
      ),
    ],
  });

  function buffed(state: GameState, ...ids: string[]): GameState {
    const permanents = { ...state.permanents };
    for (const id of ids) {
      permanents[id] = { ...permanents[id]!, buffed: true as const };
    }
    return { ...state, permanents };
  }

  it("removes the buff from the named unit", () => {
    const result = applyAction(
      buffed(board(spender()), "pawn"),
      play([["pawn"]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn?.buffed).toBeUndefined();
  });

  /** R701–705 — the buff *is* the cost, so an unbuffed unit cannot pay it. */
  it("will not take an unbuffed unit", () => {
    expect(
      applyAction(buffed(board(spender()), "pawn"), play([["squire"]])).ok,
    ).toBe(false);
  });

  /** Kraken Hunter — "spend any number of buffs". */
  it("spends several, one from each of several units", () => {
    const result = applyAction(
      buffed(board(spender("any")), "pawn", "squire"),
      play([["pawn", "squire"]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn?.buffed).toBeUndefined();
    expect(result.state.permanents.squire?.buffed).toBeUndefined();
  });
});

/** Legion Quartermaster — "return a friendly gear to its owner's hand". */
describe("a cost that returns something to hand", () => {
  it("returns it to its owner's hand, not its controller's (R56)", () => {
    const quartermaster: CardInstance = {
      ...unit("patron", { might: 4 }),
      abilities: [
        additionalCost(
          [chosenCost("returnToHand", { type: "gear", controller: "friendly" })],
          false,
        ),
      ],
    };
    const state = makeState({
      p1: {
        hand: ["patron"],
        mainDeck: ["d1"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["d2"] },
      cards: [
        quartermaster,
        { ...unit("blade"), type: "gear" as const },
        unit("d1"),
        unit("d2"),
      ],
      // Owned by p2 (the id's owner is where it came from) but controlled by p1.
      permanents: [{ cardId: "blade", controller: "p1" }],
    });

    const result = applyAction(state, play([["blade"]]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.blade).toBeUndefined();
    expect(seatOf(result.state, "p1").hand).toContain("blade");
  });
});

/** R422.1.a — the discarding player chooses which cards go. */
describe("a discard that chooses", () => {
  const discarder = (): CardInstance => ({
    ...unit("patron", { might: 4 }),
    abilities: [additionalCost([discardCost()], false)],
  });

  it("takes the card that was named, not the front of the hand", () => {
    const result = applyAction(
      board(discarder(), ["first", "second"]),
      play([["second"]]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seatOf(result.state, "p1").trash).toEqual(["second"]);
    expect(seatOf(result.state, "p1").hand).toEqual(["first"]);
  });

  /** R354 step 1 — the card being played has already left the hand. */
  it("cannot be paid with the card being played", () => {
    expect(
      applyAction(board(discarder(), ["spare"]), play([["patron"]])),
    ).toEqual({ ok: false, reason: "cannotAffordCost" });
  });
});

/**
 * Sacrifice, Heedless Resurrection — a *spell* whose additional cost kills.
 * The unit path is the one that had the bug (it rebuilt `permanents` from the
 * pre-cost state, so the unit killed to pay for a card came back to life as
 * that card landed); this covers the other path, which spreads the post-cost
 * state and so never had it.
 */
describe("a spell whose cost kills something you choose", () => {
  it("leaves the killed unit dead once the spell is on the chain", () => {
    const sacrifice: CardInstance = {
      id: "sacrifice",
      name: "Sacrifice",
      type: "spell",
      cost: FREE,
      keywords: [],
      abilities: [
        activated([], draw(1)),
        additionalCost(
          [chosenCost("kill", { type: "unit", controller: "friendly" })],
          false,
        ),
      ],
    };
    const state = makeState({
      p1: {
        hand: ["sacrifice"],
        mainDeck: ["d1", "d2"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["d3"] },
      cards: [sacrifice, unit("pawn"), unit("d1"), unit("d2"), unit("d3")],
      permanents: [{ cardId: "pawn", controller: "p1" }],
    });

    const result = applyAction(state, {
      type: "playSpell",
      playerId: "p1",
      cardId: "sacrifice",
      costChoices: [["pawn"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn).toBeUndefined();
    expect(seatOf(result.state, "p1").trash).toContain("pawn");
    expect(result.state.chain).toHaveLength(1);
  });
});

/** An activated ability's costs are answered the same way (R355.1). */
describe("an ability whose cost chooses", () => {
  it("kills what the activation named", () => {
    const altar: CardInstance = {
      ...unit("altar", { might: 0 }),
      abilities: [
        activated(
          [chosenCost("kill", { type: "unit", controller: "friendly", excludeSource: true })],
          draw(1),
        ),
      ],
    };
    const state = makeState({
      p1: { mainDeck: ["d1", "d2"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["d3"] },
      cards: [altar, unit("pawn"), unit("d1"), unit("d2"), unit("d3")],
      permanents: [
        { cardId: "altar", controller: "p1" },
        { cardId: "pawn", controller: "p1" },
      ],
    });

    const result = applyAction(state, {
      type: "activateAbility",
      playerId: "p1",
      sourceId: "altar",
      abilityIndex: 0,
      costChoices: [["pawn"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.permanents.pawn).toBeUndefined();
    expect(result.state.permanents.altar).toBeDefined();
  });
});

/**
 * `legalActions` is the only legality authority, so a choice nobody can be
 * offered is a choice nobody can make.
 */
describe("finding a choosing cost", () => {
  it("offers one play per unit that could be killed", () => {
    const moves = legalActions(board(patron()), "p1").filter(
      (action) => action.type === "playUnitFromHand" && action.cardId === "patron",
    );
    const named = new Set(
      moves.flatMap((action) =>
        action.type === "playUnitFromHand"
          ? (action.costChoices ?? []).flat()
          : [],
      ),
    );

    expect(named).toEqual(new Set(["pawn", "squire"]));
  });

  it("offers nothing applyAction would refuse", () => {
    const state = board(patron(), ["spare"]);
    for (const action of legalActions(state, "p1")) {
      expect(applyAction(state, action).ok).toBe(true);
    }
  });
});

/**
 * The two drivers have to be able to *express* what `legalActions` offers.
 * Two plays that differ only in which unit they kill are two different moves,
 * and a driver that renders them identically can only ever reach one of them —
 * the same shape of gap as the whole-order prompt the CLI could not answer.
 */
describe("naming the choice in the two drivers", () => {
  it("gives each choice its own typeable command", () => {
    const lines = renderAvailableAbilities(board(patron()), "p1").filter((line) =>
      line.includes("play patron"),
    );

    expect(lines.some((line) => line.includes("pay:pawn"))).toBe(true);
    expect(lines.some((line) => line.includes("pay:squire"))).toBe(true);
  });

  it("gives each choice its own words in the UI", () => {
    const state = board(patron());
    const words = legalActions(state, "p1")
      .filter(
        (action) =>
          action.type === "playUnitFromHand" && action.cardId === "patron",
      )
      .map((action) => describeAction(state, action));

    expect(words.some((each) => each.includes("with pawn"))).toBe(true);
    expect(words.some((each) => each.includes("with squire"))).toBe(true);
  });
});

/** A malformed action, rather than a spare answer that is quietly ignored. */
describe("more answers than costs", () => {
  it("is refused", () => {
    const plain: CardInstance = { ...unit("patron", { might: 4 }) };
    expect(applyAction(board(plain), play([["pawn"]]))).toEqual({
      ok: false,
      reason: "wrongCostChoiceCount",
    });
  });
});
