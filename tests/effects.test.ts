import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { Effect, EffectContext } from "../src/abilities.js";
import { combatSides } from "../src/combat.js";
import { mightOf } from "../src/layers.js";
import { endTurn } from "../src/tasks.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function board(
  cards: CardInstance[],
  permanents: {
    cardId: string;
    controller?: "p1" | "p2";
    location?: Location;
    exhausted?: boolean;
  }[],
): GameState {
  return makeState({
    p1: { mainDeck: ["spare"] },
    cards: [...cards, unit("spare")],
    permanents: permanents.map((entry) => ({
      cardId: entry.cardId,
      controller: entry.controller ?? "p1",
      ...(entry.location !== undefined ? { location: entry.location } : {}),
      ...(entry.exhausted !== undefined ? { exhausted: entry.exhausted } : {}),
    })),
    battlefields: ["bf-north"],
  });
}

const CONTEXT = (targets: string[], sourceLocation?: Location): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
  ...(sourceLocation !== undefined ? { sourceLocation } : {}),
});

const run = (state: GameState, effect: Effect, targets: string[]) =>
  execute(state, effect, CONTEXT(targets));

/** Gust, Rebuke, Star-Crossed — "Return a unit … to its owner's hand." */
describe("returning to hand", () => {
  it("goes to the owner's hand, not the controller's (R56)", () => {
    const start = board([unit("thrall", { might: 3 })], [
      { cardId: "thrall", controller: "p2", location: NORTH },
    ]);
    const stolen: GameState = {
      ...start,
      permanents: {
        thrall: { ...start.permanents.thrall!, controller: "p1", owner: "p2" },
      },
    };

    const after = run(stolen, { op: "returnToHand", targetIndex: 0 }, ["thrall"]).state;

    expect(after.permanents.thrall).toBeUndefined();
    expect(seatOf(after, "p2").hand).toEqual(["thrall"]);
    expect(seatOf(after, "p1").hand).toEqual([]);
  });
});

/** R427 — Banish is neither a kill nor a discard (R427.2.a/b). */
describe("banishing", () => {
  it("goes to Banishment rather than the trash", () => {
    const start = board([unit("doomed", { might: 2 })], [
      { cardId: "doomed", location: NORTH },
    ]);

    const after = run(start, { op: "banish", targetIndex: 0 }, ["doomed"]).state;

    expect(seatOf(after, "p1").banished).toEqual(["doomed"]);
    expect(seatOf(after, "p1").trash).toEqual([]);
  });
});

/** R415 / R426 / R423 — each is a no-op on a unit already in that state. */
describe("ready, buff and stun", () => {
  it("readies an exhausted unit", () => {
    const start = board([unit("u", { might: 2 })], [
      { cardId: "u", exhausted: true },
    ]);

    const after = run(start, { op: "ready", targetIndex: 0 }, ["u"]).state;

    expect(after.permanents.u?.exhausted).toBe(false);
  });

  it("does nothing to an already-ready unit (R415.1.c)", () => {
    const start = board([unit("u", { might: 2 })], [
      { cardId: "u", exhausted: false },
    ]);

    const after = run(start, { op: "ready", targetIndex: 0 }, ["u"]);

    expect(after.events).toEqual([]);
  });

  /** R703 — "Each Buff individually contributes +1 Might to a Unit." */
  it("buffs for +1 Might", () => {
    const start = board([unit("u", { might: 2 })], [{ cardId: "u" }]);

    const after = run(start, { op: "buff", targetIndex: 0 }, ["u"]).state;

    expect(after.permanents.u?.buffed).toBe(true);
    expect(mightOf(after, "u")).toBe(3);
  });

  /**
   * R426.1.b.1 — a second buff is not placed, and R426.1.c makes that
   * observable: "if it was buffed this way" is false, so nothing linked fires.
   */
  it("does not stack a second buff", () => {
    const start = board([unit("u", { might: 2 })], [{ cardId: "u" }]);
    const once = run(start, { op: "buff", targetIndex: 0 }, ["u"]).state;

    const twice = run(once, { op: "buff", targetIndex: 0 }, ["u"]);

    expect(mightOf(twice.state, "u")).toBe(3);
    expect(twice.events).toEqual([]);
  });

  /**
   * R423.1.b vs R423.1.c — a stunned unit contributes *no* Might to combat
   * damage, but still needs its full Might in damage to die.
   */
  it("stops a stunned unit contributing Might, without lowering its Might", () => {
    const start = board(
      [unit("mine", { might: 4 }), unit("theirs", { might: 3 })],
      [
        { cardId: "mine", location: NORTH },
        { cardId: "theirs", controller: "p2", location: NORTH },
      ],
    );

    const after = run(start, { op: "stun", targetIndex: 0 }, ["mine"]).state;
    const sides = combatSides(after, "bf-north", "p1");

    expect(sides.attackerMight).toBe(0);
    // R423.1.c — its own Might is untouched, so lethal is still 4.
    expect(mightOf(after, "mine")).toBe(4);
  });

  /** R423.1.a.2 — Stunned is lost during step 3d of the end-of-turn cleanup. */
  it("clears the stun at end of turn", () => {
    const start = board([unit("u", { might: 2 })], [{ cardId: "u" }]);
    const stunned = run(start, { op: "stun", targetIndex: 0 }, ["u"]).state;
    expect(stunned.permanents.u?.stunned).toBe(true);

    const next = endTurn(stunned).state;

    expect(next.permanents.u?.stunned).toBeUndefined();
  });
});

/** R420 — moving as an effect is a Limited Action, not the Standard Move. */
describe("moving as an effect", () => {
  it("moves a unit to the source's location without exhausting it", () => {
    const start = board([unit("u", { might: 2 })], [
      { cardId: "u", exhausted: false },
    ]);

    const after = execute(
      start,
      { op: "moveUnit", targetIndex: 0, to: "sourceLocation" },
      CONTEXT(["u"], NORTH),
    ).state;

    expect(after.permanents.u?.location).toEqual(NORTH);
    // R144.2's exhaust cost belongs to the Standard Move, not to this.
    expect(after.permanents.u?.exhausted).toBe(false);
  });
});
