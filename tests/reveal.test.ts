import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { activated, draw, ifThen, reveal, seq } from "../src/builders.js";
import { holds } from "../src/conditions.js";
import { FREE } from "../src/cost.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const context = (targets: string[] = []): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
});

/** R424 — presenting a card to all players, from a zone they cannot see. */
describe("revealing (R424)", () => {
  function board(): GameState {
    return makeState({
      p1: {
        hand: ["h1", "h2"],
        mainDeck: ["top", "next", "third"],
      },
      p2: { hand: ["x"], mainDeck: ["y"] },
      cards: [
        unit("top", { might: 2, tags: ["Poro"] }),
        { ...unit("next"), type: "spell" as const },
        unit("third"),
        unit("h1"),
        unit("h2"),
        unit("x"),
        unit("y"),
      ],
    });
  }

  /** R424.1.a.2 — "cards remain in the zone they are being Revealed from." */
  it("does not move the cards", () => {
    const after = execute(board(), reveal("mainDeck", 1), context());

    expect(seatOf(after.state, "p1").mainDeck).toEqual(["top", "next", "third"]);
    expect(after.state.revealed).toEqual(["top"]);
    expect(after.events).toEqual([
      { type: "cardRevealed", playerId: "p1", cardId: "top" },
    ]);
  });

  it("reveals from the top, in order", () => {
    const after = execute(board(), reveal("mainDeck", 2), context());

    expect(after.state.revealed).toEqual(["top", "next"]);
  });

  /** R424.3.a — no number means "all cards currently in the zone". */
  it("reveals a whole hand when given no count", () => {
    const after = execute(board(), reveal("hand"), context());

    expect(after.state.revealed).toEqual(["h1", "h2"]);
  });

  it("reveals a chosen player's zone", () => {
    const after = execute(board(), reveal("hand", undefined, 0), context(["p2"]));

    expect(after.state.revealed).toEqual(["x"]);
    expect(after.events).toEqual([
      { type: "cardRevealed", playerId: "p2", cardId: "x" },
    ]);
  });

  it("does nothing on an empty zone", () => {
    const empty = makeState({ p1: { hand: [], mainDeck: [] }, cards: [] });

    expect(execute(empty, reveal("hand"), context()).events).toEqual([]);
  });

  /**
   * R424.1.a.1 — "other cards … can reference the act of being Revealed."
   * "Then if you revealed a Poro, do this: …"
   */
  describe("asking what was revealed", () => {
    const seen = (state: GameState) =>
      holds(state, { kind: "revealed", type: "unit" }, context());

    it("is false before anything is revealed", () => {
      expect(seen(board())).toBe(false);
    });

    it("is true once a matching card has been", () => {
      const after = execute(board(), reveal("mainDeck", 1), context());
      expect(seen(after.state)).toBe(true);
    });

    it("distinguishes by type", () => {
      // "next" is a spell, so a unit was not revealed.
      const state = makeState({
        p1: { hand: [], mainDeck: ["next"] },
        cards: [{ ...unit("next"), type: "spell" as const }],
      });
      const after = execute(state, reveal("mainDeck", 1), context());

      expect(holds(after.state, { kind: "revealed", type: "unit" }, context())).toBe(
        false,
      );
      expect(holds(after.state, { kind: "revealed", type: "spell" }, context())).toBe(
        true,
      );
    });

    it("distinguishes by tag", () => {
      const after = execute(board(), reveal("mainDeck", 1), context());

      expect(holds(after.state, { kind: "revealed", tag: "Poro" }, context())).toBe(
        true,
      );
      expect(holds(after.state, { kind: "revealed", tag: "Mech" }, context())).toBe(
        false,
      );
    });
  });
});

/**
 * R424.1.a.3 — the Revealed state "lasts until the resolution of that spell or
 * ability finishes". Two spells in a row must not see each other's reveals.
 */
describe("how long a reveal lasts", () => {
  const scry: CardInstance = {
    id: "scry",
    name: "Scry",
    type: "spell",
    cost: FREE,
    keywords: [],
    abilities: [
      activated(
        [],
        seq(
          reveal("mainDeck", 1),
          // R424.1.a.1 — the same spell can act on what it just revealed.
          ifThen({ kind: "revealed", type: "unit" }, draw(1)),
        ),
      ),
    ],
  };

  function cast(top: string, topCard: CardInstance): GameState {
    const state = makeState({
      p1: {
        hand: ["scry"],
        mainDeck: [top, "spare"],
        runePool: pool({ energy: 9 }),
      },
      p2: { mainDeck: ["e"] },
      cards: [scry, topCard, unit("spare"), unit("e")],
    });

    let current = state;
    for (const action of [
      { type: "playSpell", playerId: "p1", cardId: "scry" },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(current, action);
      if (!result.ok) throw new Error(`rejected: ${result.reason}`);
      current = result.state;
    }
    return current;
  }

  it("lets the spell act on what it revealed", () => {
    const after = cast("aUnit", unit("aUnit", { might: 2 }));

    expect(seatOf(after, "p1").hand).toEqual(["aUnit"]);
  });

  it("does not fire when what it revealed does not match", () => {
    const after = cast("aSpell", {
      ...unit("aSpell"),
      type: "spell" as const,
    });

    expect(seatOf(after, "p1").hand).toEqual([]);
  });

  it("clears the state when the spell finishes resolving", () => {
    const after = cast("aUnit", unit("aUnit", { might: 2 }));

    expect(after.revealed).toEqual([]);
  });
});
