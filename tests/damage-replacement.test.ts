import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  dealDamage,
  mutualDamage,
  preventDamage,
  scaleDamage,
} from "../src/builders.js";
import { dealAssigned } from "../src/combat.js";
import { expireModifiers } from "../src/layers.js";
import type { GameState, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

const context = (targets: string[]): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

function board(): GameState {
  return makeState({
    cards: [
      unit("mine", { might: 3 }),
      unit("theirs", { might: 4 }),
      unit("source"),
    ],
    permanents: [
      { cardId: "mine", controller: "p1", location: NORTH },
      { cardId: "theirs", controller: "p2", location: NORTH },
    ],
    battlefields: ["bf-north"],
  });
}

/** Lotus Trap — "Choose a unit. Double all damage that would be dealt to it." */
describe("doubling damage (R369.2)", () => {
  it("doubles what a spell deals to the chosen unit", () => {
    const trapped = execute(
      board(),
      scaleDamage(2, "thisTurn"),
      context(["theirs"]),
    ).state;

    const after = execute(trapped, dealDamage(2), context(["theirs"])).state;

    expect(after.permanents.theirs?.damage).toBe(4);
  });

  it("leaves a unit it did not choose alone", () => {
    const trapped = execute(
      board(),
      scaleDamage(2, "thisTurn"),
      context(["theirs"]),
    ).state;

    const after = execute(trapped, dealDamage(2), context(["mine"])).state;

    expect(after.permanents.mine?.damage).toBe(2);
  });

  it("doubles combat damage too", () => {
    const trapped = execute(
      board(),
      scaleDamage(2, "thisTurn"),
      context(["theirs"]),
    ).state;

    const after = dealAssigned(trapped, [{ cardId: "theirs", amount: 1 }]);

    expect(after.state.permanents.theirs?.damage).toBe(2);
  });

  /** R317.2.c — "this turn" ends with the turn. */
  it("stops applying once the turn ends", () => {
    const trapped = execute(
      board(),
      scaleDamage(2, "thisTurn"),
      context(["theirs"]),
    ).state;
    const later = expireModifiers(trapped, "thisTurn");

    const after = execute(later, dealDamage(2), context(["theirs"])).state;

    expect(after.permanents.theirs?.damage).toBe(2);
  });
});

/** R437 — Prevent. Unyielding Spirit: "Prevent all spell and ability damage." */
describe("preventing damage (R437)", () => {
  it("reduces the damage by the Prevent Value", () => {
    const shielded = execute(
      board(),
      preventDamage(2, "thisTurn", { targetIndex: 0 }),
      context(["mine"]),
    ).state;

    const after = execute(shielded, dealDamage(3), context(["mine"])).state;

    expect(after.permanents.mine?.damage).toBe(1);
  });

  /** R437.2.a — "can never be less than 0, but can be 0." */
  it("can take it all the way to nothing", () => {
    const shielded = execute(
      board(),
      preventDamage(5, "thisTurn", { targetIndex: 0 }),
      context(["mine"]),
    ).state;

    const after = execute(shielded, dealDamage(3), context(["mine"]));

    expect(after.state.permanents.mine?.damage).toBe(0);
    expect(after.events).toContainEqual({
      type: "damageReplaced",
      cardId: "mine",
      from: 3,
      to: 0,
    });
  });

  /** R437.3 — "reduce the Prevent Value ... by the prevented amount." */
  it("is used up as it prevents", () => {
    const shielded = execute(
      board(),
      preventDamage(3, "thisTurn", { targetIndex: 0 }),
      context(["mine"]),
    ).state;

    const once = execute(shielded, dealDamage(2), context(["mine"])).state;
    expect(once.permanents.mine?.damage).toBe(0);

    // 1 of the Prevent Value is left, so 2 more damage lands as 1.
    const twice = execute(once, dealDamage(2), context(["mine"])).state;
    expect(twice.permanents.mine?.damage).toBe(1);
  });

  /** R437.3.a — at zero it "is no longer being tracked ... the effect expires". */
  it("stops being tracked once spent", () => {
    const shielded = execute(
      board(),
      preventDamage(1, "thisTurn", { targetIndex: 0 }),
      context(["mine"]),
    ).state;

    const after = execute(shielded, dealDamage(1), context(["mine"])).state;

    expect(after.damageReplacements).toEqual([]);
  });

  /** R437.1.b.1.b — "All" is an infinite amount, so it never runs down. */
  it("an 'all' prevention keeps going", () => {
    const shielded = execute(
      board(),
      preventDamage("all", "thisTurn", {
        from: "spellOrAbility",
        targetIndex: 0,
      }),
      context(["mine"]),
    ).state;

    const once = execute(shielded, dealDamage(9), context(["mine"])).state;
    const twice = execute(once, dealDamage(9), context(["mine"])).state;

    expect(twice.permanents.mine?.damage).toBe(0);
    expect(twice.damageReplacements).toHaveLength(1);
  });

  /** R437.1.b names the *source* of the damage it affects. */
  it("does not touch combat damage when it names spells and abilities", () => {
    const shielded = execute(
      board(),
      preventDamage("all", "thisTurn", {
        from: "spellOrAbility",
        targetIndex: 0,
      }),
      context(["mine"]),
    ).state;

    const after = dealAssigned(shielded, [{ cardId: "mine", amount: 2 }]);

    expect(after.state.permanents.mine?.damage).toBe(2);
  });

  /** Unyielding Spirit names no unit — it covers everyone. */
  it("with no unit named, covers every unit", () => {
    const global = execute(
      board(),
      preventDamage("all", "thisTurn", { from: "spellOrAbility" }),
      context([]),
    ).state;

    const a = execute(global, dealDamage(3), context(["mine"])).state;
    const b = execute(a, dealDamage(3), context(["theirs"])).state;

    expect(b.permanents.mine?.damage).toBe(0);
    expect(b.permanents.theirs?.damage).toBe(0);
  });
});

/** Rampage's mutual damage goes through the same chokepoint. */
describe("both directions of mutual damage", () => {
  it("replaces each way independently", () => {
    const shielded = execute(
      board(),
      preventDamage("all", "thisTurn", { targetIndex: 0 }),
      context(["mine"]),
    ).state;

    const after = execute(
      shielded,
      mutualDamage(0, 1),
      context(["mine", "theirs"]),
    ).state;

    // mine takes nothing; theirs still takes mine's 3 Might.
    expect(after.permanents.mine?.damage).toBe(0);
    expect(after.permanents.theirs?.damage).toBe(3);
  });
});

/**
 * R372 — "the controller of the object being acted on determines the order the
 * Replacement Effects will apply." The order changes the number, so the engine
 * has to ask rather than pick.
 */
describe("ordering two replacements on one damage event (R372)", () => {
  /** A 3-Might unit with both a Prevent 2 and Lotus Trap's doubling on it. */
  function bothWatching(): GameState {
    let state = board();
    state = execute(
      state,
      preventDamage(2, "thisTurn", { targetIndex: 0 }),
      { controller: "p2", sourceId: "shield", targets: ["mine"] },
    ).state;
    state = execute(state, scaleDamage(2, "thisTurn"), {
      controller: "p2",
      sourceId: "trap",
      targets: ["mine"],
    }).state;
    return state;
  }

  it("stops and asks the damaged unit's controller", () => {
    const paused = execute(
      bothWatching(),
      dealDamage(3),
      { controller: "p2", sourceId: "bolt", targets: ["mine"] },
    );

    expect(paused.pause?.decision).toEqual({
      // "mine" is p1's, and R372 asks the controller of the object acted on —
      // not the controller of the replacements or of the damage.
      player: "p1",
      prompt: {
        kind: "orderDamage",
        subject: "mine",
        amount: 3,
        legal: ["shield", "trap"],
      },
    });
    // R370.1.c — nothing has landed yet.
    expect(paused.state.permanents.mine?.damage).toBe(0);
  });

  function answer(order: string[]): number {
    const paused = execute(bothWatching(), dealDamage(3), {
      controller: "p2",
      sourceId: "bolt",
      targets: ["mine"],
    });
    const done = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: order,
    });
    return done.state.permanents.mine?.damage ?? -1;
  }

  /**
   * The rules' own example, and why this cannot be picked for the player: at
   * 3 Might the unit lives one way and dies the other.
   */
  it("prevent first: 3 - 2 = 1, doubled to 2 — it survives", () => {
    expect(answer(["shield", "trap"])).toBe(2);
  });

  it("doubling first: 3 x 2 = 6, less 2 = 4 — it dies", () => {
    expect(answer(["trap", "shield"])).toBe(4);
  });

  it("does not ask when only one applies", () => {
    let state = board();
    state = execute(state, scaleDamage(2, "thisTurn"), {
      controller: "p2",
      sourceId: "trap",
      targets: ["mine"],
    }).state;

    const outcome = execute(state, dealDamage(3), {
      controller: "p2",
      sourceId: "bolt",
      targets: ["mine"],
    });

    expect(outcome.pause).toBeUndefined();
    expect(outcome.state.permanents.mine?.damage).toBe(6);
  });
});
