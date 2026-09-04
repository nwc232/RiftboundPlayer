import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { applyAction } from "../src/actions.js";
import {
  activated,
  addEnergy,
  draw,
  exhaustSelf,
  onlyFor,
  onlyInShowdowns,
  spell,
} from "../src/builders.js";
import { FREE, canPay, totals } from "../src/cost.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, cost, pool, unit } from "./fixtures.js";

/**
 * Five cards add resources that are not fully general. They restrict along two
 * axes — what the resources may buy, and when they may be spent — and the
 * bucket that carries the restriction was already there; what was missing was
 * a vocabulary wide enough to say what these five say.
 *
 * Each is authored from its printed text.
 */

const context: EffectContext = {
  controller: "p1",
  sourceId: "source",
  targets: [],
};

/** Lux, Crownguard — "⟳: [Reaction] — [Add] 2. Use only to play spells." */
describe("resources that only buy one card type", () => {
  const lux: CardInstance = {
    ...unit("lux", { might: 3 }),
    abilities: [
      activated([exhaustSelf], addEnergy(2, onlyFor("spell")), "reaction"),
    ],
  };

  function board(): GameState {
    return makeState({
      p1: {
        hand: ["bolt", "recruit"],
        mainDeck: ["a"],
        runePool: pool(),
      },
      p2: { mainDeck: ["b"] },
      cards: [
        lux,
        spell("bolt", "Bolt", cost({ energy: 2 }), draw(1)),
        { ...unit("recruit", { might: 2 }), cost: cost({ energy: 2 }) },
        unit("a"),
        unit("b"),
      ],
      permanents: [{ cardId: "lux", controller: "p1" }],
    });
  }

  function withLuxEnergy(): GameState {
    const result = applyAction(board(), {
      type: "activateAbility",
      playerId: "p1",
      sourceId: "lux",
      abilityIndex: 0,
    });
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    return result.state;
  }

  it("adds the energy into its own bucket", () => {
    const state = withLuxEnergy();

    expect(totals(seatOf(state, "p1").runePool).energy).toBe(2);
    expect(seatOf(state, "p1").runePool.buckets).toHaveLength(1);
    expect(seatOf(state, "p1").runePool.buckets[0]?.restriction).toEqual({
      kind: "onlyCardType",
      cardType: "spell",
    });
  });

  it("pays for a spell", () => {
    expect(
      applyAction(withLuxEnergy(), {
        type: "playSpell",
        playerId: "p1",
        cardId: "bolt",
      }).ok,
    ).toBe(true);
  });

  it("will not pay for a unit", () => {
    expect(
      applyAction(withLuxEnergy(), {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "recruit",
      }),
    ).toEqual({ ok: false, reason: "cannotAffordCost" });
  });
});

/**
 * Fire Below the Mountain — "Use only to play gear **or use gear abilities**".
 * Butcher of the Sands says the same of units. The card type is the same
 * question; what widens is whether an ability *of* that type counts.
 */
describe("resources that also buy that type's abilities", () => {
  function board(orItsAbilities?: true): GameState {
    const forge: CardInstance = {
      ...unit("forge", { might: 0 }),
      type: "gear",
      abilities: [activated([{ kind: "pay", cost: cost({ energy: 1 }) }], draw(1))],
    };
    const state = makeState({
      p1: { mainDeck: ["a", "c"], runePool: pool() },
      p2: { mainDeck: ["b"] },
      cards: [forge, unit("hero", { might: 3 }), unit("a"), unit("b"), unit("c")],
      permanents: [
        { cardId: "forge", controller: "p1" },
        { cardId: "hero", controller: "p1" },
      ],
    });
    return execute(
      state,
      addEnergy(2, onlyFor("gear", orItsAbilities)),
      context,
    ).state;
  }

  const useForge = {
    type: "activateAbility" as const,
    playerId: "p1" as const,
    sourceId: "forge",
    abilityIndex: 0,
  };

  it("pays for a gear's own ability when the restriction says so", () => {
    expect(applyAction(board(true), useForge).ok).toBe(true);
  });

  it("will not, when the restriction names only playing gear", () => {
    expect(applyAction(board(), useForge)).toEqual({
      ok: false,
      reason: "cannotPayAbilityCost",
    });
  });

  /** "…gear abilities" — a unit's ability is not one, however wide the flag. */
  it("will not pay for another type's ability", () => {
    const state = board(true);
    const withUnitAbility: GameState = {
      ...state,
      cards: {
        ...state.cards,
        hero: {
          ...state.cards.hero!,
          abilities: [
            activated([{ kind: "pay", cost: cost({ energy: 1 }) }], draw(1)),
          ],
        },
      },
    };

    expect(
      applyAction(withUnitAbility, {
        type: "activateAbility",
        playerId: "p1",
        sourceId: "hero",
        abilityIndex: 0,
      }).ok,
    ).toBe(false);
  });
});

/** Scorn of the Moon — "Spend this Energy only during showdowns." */
describe("resources that only spend at one time", () => {
  it("is spendable in a showdown and not outside one", () => {
    const restricted = pool({ energy: 2, restriction: onlyInShowdowns });
    const purchase = cost({ energy: 2 });

    expect(
      canPay(restricted, purchase, {
        kind: "playCard",
        cardType: "spell",
        inShowdown: true,
      }),
    ).toBe(true);
    expect(
      canPay(restricted, purchase, {
        kind: "playCard",
        cardType: "spell",
        inShowdown: false,
      }),
    ).toBe(false);
  });

  /** It restricts *when*, not *what*, so any card type is fine in a showdown. */
  it("does not care what the resources buy", () => {
    const restricted = pool({ energy: 2, restriction: onlyInShowdowns });

    for (const cardType of ["unit", "spell", "gear"] as const) {
      expect(
        canPay(restricted, cost({ energy: 2 }), {
          kind: "playCard",
          cardType,
          inShowdown: true,
        }),
      ).toBe(true);
    }
  });

  /** Two restrictions are two buckets — R160 never pools them together. */
  it("keeps its own bucket beside another restriction's", () => {
    const after = execute(
      execute(
        makeState({ p1: { runePool: pool() } }),
        addEnergy(1, onlyInShowdowns),
        context,
      ).state,
      addEnergy(1, onlyFor("spell")),
      context,
    );

    expect(seatOf(after.state, "p1").runePool.buckets).toHaveLength(2);
    expect(totals(seatOf(after.state, "p1").runePool).energy).toBe(2);
  });
});

/** Unrestricted resources still pay for anything. */
describe("unrestricted resources", () => {
  it("are unaffected by the wider vocabulary", () => {
    expect(
      canPay(pool({ energy: 3 }), cost({ energy: 3 }), {
        kind: "activateAbility",
      }),
    ).toBe(true);
    expect(
      canPay(pool({ energy: 3 }), cost({ energy: 3 }), { kind: "hide" }),
    ).toBe(true);
    expect(canPay(pool(), FREE, { kind: "hide" })).toBe(true);
  });
});
