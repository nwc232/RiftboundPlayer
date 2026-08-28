import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import {
  activated,
  counterSpell,
  dealDamage,
  untargetable,
} from "../src/builders.js";
import { legalTargets } from "../src/decisions.js";
import { FREE } from "../src/cost.js";
import { movementRestricted } from "../src/layers.js";
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
          modification: { layer: "ability", op: "restrictTargeting", by: "enemy" },
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
            op: "restrictMovement",
            ...(to !== undefined ? { to } : {}),
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
