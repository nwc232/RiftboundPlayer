import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  activated,
  counterSpell,
  dealDamage,
  restrict,
  untargetable,
} from "../src/builders.js";
import { legalTargets } from "../src/decisions.js";
import { FREE } from "../src/cost.js";
import { movementRestricted } from "../src/layers.js";
import { beginTurn } from "../src/tasks.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const BASE: Location = { kind: "base", player: "p1" };

const context = (targets: string[] = []): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

/** "I can't be chosen by enemy spells and abilities." */
describe("restricted targeting", () => {
  function board(guard: CardInstance): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [guard, unit("plain", { might: 2 }), unit("a"), unit("b")],
      permanents: [
        { cardId: "guard", controller: "p2" },
        { cardId: "plain", controller: "p2" },
      ],
      battlefields: ["bf-north"],
    });
  }

  const warded = (): CardInstance => ({
    ...unit("guard", { might: 3 }),
    abilities: [untargetable()],
  });

  it("keeps an enemy from choosing it", () => {
    expect(
      legalTargets(board(warded()), "p1", { type: "unit", controller: "enemy" }),
    ).toEqual(["plain"]);
  });

  /** "…by *enemy* spells and abilities" — its own controller still may. */
  it("leaves its own controller free to choose it", () => {
    expect(
      legalTargets(board(warded()), "p2", { type: "unit" }).sort(),
    ).toEqual(["guard", "plain"]);
  });

  it("can be absolute rather than only against enemies", () => {
    const sealed: CardInstance = {
      ...unit("guard", { might: 3 }),
      abilities: [untargetable("any")],
    };

    expect(legalTargets(board(sealed), "p2", { type: "unit" })).toEqual(["plain"]);
  });

  /**
   * "…unless I'm in combat." A `PassiveCondition` gates it, which is why the
   * restriction is a characteristic rather than a keyword.
   */
  it("can be conditional", () => {
    const brave: CardInstance = {
      ...unit("guard", { might: 3 }),
      abilities: [untargetable("enemy", { when: "attacking" })],
    };
    const state = board(brave);

    // Not attacking — choosable.
    expect(
      legalTargets(state, "p1", { type: "unit", controller: "enemy" }).sort(),
    ).toEqual(["guard", "plain"]);

    const attacking: GameState = {
      ...state,
      permanents: {
        ...state.permanents,
        guard: { ...state.permanents.guard!, designation: "attacker" as const },
      },
    };
    expect(
      legalTargets(attacking, "p1", { type: "unit", controller: "enemy" }),
    ).toEqual(["plain"]);
  });

  /** A granted restriction reads the same as a printed one. */
  it("works when granted by a modifier", () => {
    const state = board(unit("guard", { might: 3 }));
    const granted: GameState = {
      ...state,
      modifiers: [
        {
          id: "m1",
          targetId: "guard",
          duration: "thisTurn",
          modification: {
            layer: "ability",
            op: "restrict",
            restriction: { what: "beChosen", by: "enemy" },
          },
        },
      ],
    };

    expect(
      legalTargets(granted, "p1", { type: "unit", controller: "enemy" }),
    ).toEqual(["plain"]);
  });
});

/** "I can't move to base" / "units can't move from here to base." */
describe("restricted movement", () => {
  function board(to?: "base"): GameState {
    const base = makeState({
      cards: [unit("u1", { might: 2 })],
      permanents: [{ cardId: "u1", controller: "p1", location: NORTH }],
      battlefields: ["bf-north", "bf-south"],
    });
    return {
      ...base,
      modifiers: [
        {
          id: "m1",
          targetId: "u1",
          duration: "thisTurn",
          modification: {
            layer: "ability",
            op: "restrict",
            restriction: { what: "move", ...(to !== undefined ? { to } : {}) },
          },
        },
      ],
    };
  }

  /** Vex, Apathetic's "they can't move it this turn" names no destination. */
  it("stops every destination when it names none", () => {
    expect(movementRestricted(board(), "u1", BASE)).toBe(true);
    expect(
      movementRestricted(board(), "u1", { kind: "battlefield", id: "bf-south" }),
    ).toBe(true);
  });

  it("stops only the base when it names the base", () => {
    expect(movementRestricted(board("base"), "u1", BASE)).toBe(true);
    expect(
      movementRestricted(board("base"), "u1", {
        kind: "battlefield",
        id: "bf-south",
      }),
    ).toBe(false);
  });

  it("refuses the move through applyAction", () => {
    const result = applyAction(board("base"), {
      type: "standardMove",
      playerId: "p1",
      cardId: "u1",
      destination: BASE,
    });

    expect(result).toEqual({ ok: false, reason: "cannotMove" });
  });

  it("still allows the moves it does not name", () => {
    const result = applyAction(board("base"), {
      type: "standardMove",
      playerId: "p1",
      cardId: "u1",
      destination: { kind: "battlefield", id: "bf-south" },
    });

    // Battlefield to battlefield needs Ganking (R810) — but not "cannotMove".
    expect(result).toEqual({ ok: false, reason: "invalidDestination" });
  });
});

/** "This can't be countered." */
describe("uncounterable spells", () => {
  function onChain(keywords: CardInstance["keywords"]): GameState {
    const spell: CardInstance = {
      id: "bolt",
      name: "bolt",
      type: "spell",
      cost: FREE,
      keywords,
      abilities: [activated([], dealDamage(2))],
    };
    const base = makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [spell, unit("a"), unit("b")],
    });
    return {
      ...base,
      chain: [
        { kind: "spell", cardId: "bolt", controller: "p1", targets: [] },
      ],
    };
  }

  it("counters an ordinary spell", () => {
    const after = execute(onChain([]), counterSpell(0), {
      ...context(["bolt"]),
      controller: "p2",
    });

    expect(after.state.chain).toEqual([]);
    expect(after.state.players.p1.trash).toEqual(["bolt"]);
  });

  it("leaves an uncounterable one on the chain", () => {
    const after = execute(onChain(["uncounterable"]), counterSpell(0), {
      ...context(["bolt"]),
      controller: "p2",
    });

    expect(after.state.chain).toHaveLength(1);
    expect(after.state.players.p1.trash).toEqual([]);
    expect(after.events).toEqual([]);
  });
});


/**
 * R415 — Maduli the Gatekeeper's "I can't be readied", and Mageseeker Warden's
 * narrower "spells and abilities can't ready enemy units and gear".
 *
 * The two differ only in where they bite: R315.1's Awaken is the game readying
 * everything, not a spell or ability doing it.
 */
describe("restricted readying", () => {
  function board(gate: CardInstance): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [gate, unit("plain", { might: 2 }), unit("a"), unit("b")],
      permanents: [
        { cardId: "gate", controller: "p1", exhausted: true },
        { cardId: "plain", controller: "p1", exhausted: true },
      ],
    });
  }

  /** Maduli the Gatekeeper — "I can't be readied." */
  const maduli = (): CardInstance => ({
    ...unit("gate", { might: 4 }),
    abilities: [restrict({ what: "beReadied" })],
  });

  it("stops an effect from readying it", () => {
    const after = execute(board(maduli()), { op: "ready", targetIndex: 0 }, context(["gate"]));

    expect(after.state.permanents.gate?.exhausted).toBe(true);
    expect(after.events).toEqual([]);
  });

  it("leaves everything else readyable", () => {
    const after = execute(
      board(maduli()),
      { op: "ready", targetIndex: 0 },
      context(["plain"]),
    );

    expect(after.state.permanents.plain?.exhausted).toBe(false);
  });

  /** R315.1 — the Awaken step is the game readying, and it is bound too. */
  it("stops the Awaken step from readying it", () => {
    const after = beginTurn(board(maduli()), "p1", 2);

    expect(after.state.permanents.gate?.exhausted).toBe(true);
    expect(after.state.permanents.plain?.exhausted).toBe(false);
  });

  /**
   * Mageseeker Warden — "spells and abilities can't ready enemy units and
   * gear". R315.1's Awaken is neither, so it still readies them.
   */
  it("leaves Awaken alone when the restriction names spells and abilities", () => {
    const warden = (): CardInstance => ({
      ...unit("gate", { might: 4 }),
      abilities: [restrict({ what: "beReadied", source: "effect" })],
    });

    const byEffect = execute(
      board(warden()),
      { op: "ready", targetIndex: 0 },
      context(["gate"]),
    );
    expect(byEffect.state.permanents.gate?.exhausted).toBe(true);

    const byAwaken = beginTurn(board(warden()), "p1", 2);
    expect(byAwaken.state.permanents.gate?.exhausted).toBe(false);
  });
});

/** Ambessa — "I have +3 Might and can't be dealt damage unless I'm in combat." */
describe("restricted damage", () => {
  const ambessa = (): CardInstance => ({
    ...unit("ambessa", { might: 5 }),
    abilities: [
      { ...restrict({ what: "beDealtDamage" }), unless: { when: "inCombat" } },
    ],
  });

  function board(designation?: "attacker" | "defender"): GameState {
    return makeState({
      p1: { mainDeck: ["a"] },
      p2: { mainDeck: ["b"] },
      cards: [ambessa(), unit("a"), unit("b")],
      permanents: [
        {
          cardId: "ambessa",
          controller: "p1",
          ...(designation === undefined ? {} : { designation }),
        },
      ],
    });
  }

  it("takes nothing outside combat", () => {
    const after = execute(
      board(),
      { op: "dealDamage", amount: 4, targetIndex: 0 },
      context(["ambessa"]),
    );

    expect(after.state.permanents.ambessa?.damage).toBe(0);
  });

  /** "unless I'm in combat" is either designation, not just attacking. */
  it("takes damage while attacking and while defending", () => {
    for (const designation of ["attacker", "defender"] as const) {
      const after = execute(
        board(designation),
        { op: "dealDamage", amount: 4, targetIndex: 0 },
        context(["ambessa"]),
      );

      expect(after.state.permanents.ambessa?.damage).toBe(4);
    }
  });
});

/**
 * Minotaur Reckoner — "Units can't move to base" — and Determined Sentry —
 * "I can't move to base."
 *
 * Both are *passives*, which is what the old flat modifier scan could not see:
 * it read `state.modifiers` directly, so only a durational restriction like
 * Vex's reached it. Going through `characteristicsOf` is what unblocked them.
 */
describe("a passive that restricts movement", () => {
  function board(source: CardInstance): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [source, unit("mine", { might: 2 }), unit("theirs", { might: 2 }), unit("a"), unit("b")],
      permanents: [
        { cardId: source.id, controller: "p1", location: NORTH },
        { cardId: "mine", controller: "p1", location: NORTH },
        { cardId: "theirs", controller: "p2", location: NORTH },
      ],
      battlefields: ["bf-north", "bf-south"],
    });
  }

  /** Determined Sentry — the restriction is on itself and nothing else. */
  it("binds only itself when the scope is self", () => {
    const sentry: CardInstance = {
      ...unit("sentry", { might: 3 }),
      abilities: [restrict({ what: "move", to: "base" })],
    };
    const state = board(sentry);

    expect(movementRestricted(state, "sentry", BASE)).toBe(true);
    expect(movementRestricted(state, "mine", BASE)).toBe(false);
  });

  /** Minotaur Reckoner — "*Units*", with no side named, so both players'. */
  it("binds every unit when the scope is all of them", () => {
    const reckoner: CardInstance = {
      ...unit("reckoner", { might: 3 }),
      abilities: [
        restrict({ what: "move", to: "base" }, { target: "allUnits" }),
      ],
    };
    const state = board(reckoner);

    expect(movementRestricted(state, "mine", BASE)).toBe(true);
    expect(movementRestricted(state, "theirs", BASE)).toBe(true);
    // It names the base, so a battlefield is still reachable.
    expect(
      movementRestricted(state, "mine", { kind: "battlefield", id: "bf-south" }),
    ).toBe(false);
  });

  /** Vilemaw's Lair — "Units can't move *from here* to base." */
  it("binds only the units at the source when the scope says here", () => {
    const lair: CardInstance = {
      ...unit("lair", { might: 0 }),
      abilities: [
        restrict(
          { what: "move", to: "base" },
          { target: "allUnits", here: true },
        ),
      ],
    };
    const state = board(lair);
    const elsewhere: GameState = {
      ...state,
      permanents: {
        ...state.permanents,
        theirs: {
          ...state.permanents.theirs!,
          location: { kind: "battlefield", id: "bf-south" },
        },
      },
    };

    expect(movementRestricted(elsewhere, "mine", BASE)).toBe(true);
    expect(movementRestricted(elsewhere, "theirs", BASE)).toBe(false);
  });
});
