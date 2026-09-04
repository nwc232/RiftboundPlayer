import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import {
  anthemMight,
  dealDamage,
  draw,
  empower,
  empowered,
  grantKeywordFor,
  level,
  modifyMight,
  passive,
} from "../src/builders.js";
import { legalActions } from "../src/legal.js";
import { abilitiesOf, keywordsOf, mightOf } from "../src/layers.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState, PlayerState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * R828.1.b.1 — "[Empowered][>] [Text]" is "While I have the Empowered status,
 * this card gains '[Text]'." R824.1.b.1 is the same sentence with a different
 * condition, which is why both are one modification.
 */
describe("dependent keywords (R824, R828)", () => {
  /** A unit that gains "+2 Might" only while its condition holds. */
  function board(
    gate: CardInstance["abilities"][number],
    options: { empowered?: true; xp?: number } = {},
  ): GameState {
    const state = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [
        { ...unit("hero", { might: 3 }), abilities: [gate] },
        unit("a"),
        unit("b"),
      ],
      permanents: [{ cardId: "hero", controller: "p1" }],
    });
    const p1: PlayerState = { ...seatOf(state, "p1"), xp: options.xp ?? 0 };
    return {
      ...state,
      players: { ...state.players, p1 },
      permanents: {
        ...state.permanents,
        hero: {
          ...state.permanents.hero!,
          ...(options.empowered === true ? { empowered: true as const } : {}),
        },
      },
    };
  }

  const bigger = passive({ target: "self" }, {
    layer: "arithmetic",
    op: "addMight",
    amount: 2,
  });

  describe("[Empowered] (R828)", () => {
    it("is inactive while the status is absent", () => {
      expect(mightOf(board(empowered(bigger)), "hero")).toBe(3);
    });

    /** R828.1.c — "as long as the Game Object has the Empowered status". */
    it("is active while the status is present", () => {
      expect(mightOf(board(empowered(bigger), { empowered: true }), "hero")).toBe(5);
    });

    it("puts the granted ability into the card's rules text", () => {
      const off = abilitiesOf(board(empowered(bigger)), "hero");
      const on = abilitiesOf(
        board(empowered(bigger), { empowered: true }),
        "hero",
      );

      // R828.1.b.1's "*gains*" is additive — the printed text stays either way.
      expect(off).toHaveLength(1);
      expect(on).toHaveLength(2);
      expect(on[1]).toEqual(bigger);
    });

    /** R828.1.d — a granted *trigger* is what most Empowered abilities are. */
    it("grants a triggered ability, not just a passive", () => {
      const watcher = {
        kind: "triggered" as const,
        trigger: { on: "unitPlayed" as const, subject: "friendly" as const },
        effect: draw(1),
      };
      const on = abilitiesOf(
        board(empowered(watcher), { empowered: true }),
        "hero",
      );

      expect(on).toContainEqual(watcher);
    });
  });

  describe("[Level N] (R824)", () => {
    const gate = level(6, bigger);

    it("is inactive below the threshold", () => {
      expect(mightOf(board(gate, { xp: 5 }), "hero")).toBe(3);
    });

    it("is active at the threshold", () => {
      expect(mightOf(board(gate, { xp: 6 }), "hero")).toBe(5);
    });

    it("stays active above it", () => {
      expect(mightOf(board(gate, { xp: 20 }), "hero")).toBe(5);
    });

    /**
     * R824.1.c.1 — "If the controller of the card with Level changes, the
     * Dependent Ability will be rendered Active or Inactive based on the new
     * controller's XP." The question is asked of whoever holds it *now*.
     */
    it("reads the current controller's XP, not the owner's", () => {
      const base = board(gate, { xp: 6 });
      const theirs: GameState = {
        ...base,
        // p2 has no XP, so taking the unit switches the ability off.
        permanents: {
          ...base.permanents,
          hero: { ...base.permanents.hero!, controller: "p2" },
        },
      };

      expect(mightOf(base, "hero")).toBe(5);
      expect(mightOf(theirs, "hero")).toBe(3);
    });

    /** R824.1.d — "Inactive as soon as the controlling player has less than N." */
    it("switches off again when XP is spent back below it", () => {
      const on = board(gate, { xp: 6 });
      const spent: GameState = {
        ...on,
        players: { ...on.players, p1: { ...seatOf(on, "p1"), xp: 2 } },
      };

      expect(mightOf(spent, "hero")).toBe(3);
    });
  });

  /**
   * The point of one mechanism for two keywords: they layer. A [Level] ability
   * that grants a keyword is read by the same pipeline that reads printed ones.
   */
  it("grants keywords as readily as Might", () => {
    const gate = level(
      3,
      passive({ target: "self" }, {
        layer: "ability",
        op: "grantKeyword",
        keyword: "ganking",
      }),
    );

    expect(keywordsOf(board(gate, { xp: 1 }), "hero")).not.toContain("ganking");
    expect(keywordsOf(board(gate, { xp: 3 }), "hero")).toContain("ganking");
  });
});

/**
 * R827.1.c.1 — "[Empower] [Cost]" is short for "[Cost]: Empower this. Play
 * only if not Empowered." Without it nothing could ever become Empowered.
 */
describe("[Empower] (R827)", () => {
  const champion: CardInstance = {
    ...unit("hero", { might: 3 }),
    abilities: [empower({ energy: 2 }), empowered(anthemMight(2, false))],
  };

  function board(energy = 9): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy }) },
      p2: { mainDeck: ["b"] },
      cards: [champion, unit("ally", { might: 1 }), unit("a"), unit("b")],
      permanents: [
        { cardId: "hero", controller: "p1" },
        { cardId: "ally", controller: "p1" },
      ],
    });
  }

  const EMPOWER: Action = {
    type: "activateAbility",
    playerId: "p1",
    sourceId: "hero",
    abilityIndex: 2,
  };

  it("expands into an activated ability that pays its cost", () => {
    const derived = abilitiesOf(board(), "hero");

    expect(derived[2]).toEqual({
      kind: "activated",
      timing: "default",
      costs: [{ kind: "pay", cost: { energy: 2, power: {}, anyPower: 0 } }],
      effect: { op: "empowerSelf" },
      when: { kind: "notEmpowered" },
    });
  });

  it("sets the status and charges for it", () => {
    const result = applyAction(board(), EMPOWER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.permanents.hero?.empowered).toBe(true);
    expect(seatOf(result.state, "p1").runePool.buckets[0]!.energy).toBe(7);
    // R827.2.a — becoming Empowered is a referenceable event.
    expect(result.events).toContainEqual({
      type: "empowered",
      playerId: "p1",
      cardId: "hero",
    });
  });

  /** The whole point: the Empowered ability switches on the moment it lands. */
  it("turns the card's [Empowered] ability on", () => {
    expect(mightOf(board(), "ally")).toBe(1);

    const result = applyAction(board(), EMPOWER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mightOf(result.state, "ally")).toBe(3);
  });

  /** R441.1.b / R827.1.c.1 — "play only if not Empowered". */
  it("cannot be played twice", () => {
    const first = applyAction(board(), EMPOWER);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(applyAction(first.state, EMPOWER)).toEqual({
      ok: false,
      reason: "abilityNotFound",
    });
  });

  /**
   * `legalActions` is the only legality authority, so the move has to vanish
   * from the list rather than merely being refused.
   */
  it("stops being offered once it has been used", () => {
    const offered = (state: GameState) =>
      legalActions(state, "p1").some(
        (action) =>
          action.type === "activateAbility" &&
          action.sourceId === "hero" &&
          action.abilityIndex === 2,
      );

    expect(offered(board())).toBe(true);

    const result = applyAction(board(), EMPOWER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(offered(result.state)).toBe(false);
  });

  /**
   * R828.1.d — "If the Dependent Ability is a Triggered Ability whose
   * condition is 'When I become Empowered' … it will be active and trigger
   * when its source becomes Empowered." The ability is switched on by the very
   * event it is watching for, so the order matters: the status has to land
   * before the event is scanned for triggers.
   */
  it("fires a 'when I become Empowered' trigger on the event that enables it", () => {
    const selfWatcher: CardInstance = {
      ...unit("hero", { might: 3 }),
      abilities: [
        empower({ energy: 2 }),
        empowered({
          kind: "triggered",
          trigger: { on: "empowered", subject: "self" },
          effect: draw(1),
        }),
      ],
    };
    const state = makeState({
      p1: { mainDeck: ["a", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [selfWatcher, unit("a"), unit("b"), unit("c")],
      permanents: [{ cardId: "hero", controller: "p1" }],
    });

    const result = applyAction(state, EMPOWER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.chain).toHaveLength(1);
    expect(result.events).toContainEqual({
      type: "abilityTriggered",
      playerId: "p1",
      cardId: "hero",
    });
  });

  it("is not offered when the cost cannot be paid", () => {
    expect(applyAction(board(1), EMPOWER)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });
});
