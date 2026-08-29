import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { chainItemCardId } from "../src/chain.js";
import { attachSelf } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { abilitiesOf, keywordsOf } from "../src/layers.js";
import { legalActions } from "../src/legal.js";
import { playedWithReactionTiming } from "../src/play.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/** Long Sword — "[Quick-Draw]", [Equip] [1], +2 Might. */
const sword: CardInstance = {
  id: "sword",
  name: "Long Sword",
  type: "gear",
  cost: { ...FREE, energy: 1 },
  keywords: ["quickDraw"],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [{ kind: "pay", cost: { ...FREE, energy: 1 } }],
      effect: attachSelf(),
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
    },
  ],
  attachment: { mightBonus: 2, keywords: [] },
};

function board(): GameState {
  return makeState({
    p1: { hand: ["sword"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
    p2: { mainDeck: ["b"] },
    cards: [sword, unit("hero", { might: 3 }), unit("a"), unit("b")],
    permanents: [{ cardId: "hero", controller: "p1" }],
    battlefields: ["bf-north"],
  });
}

const PLAY: Action = {
  type: "playUnitFromHand",
  playerId: "p1",
  cardId: "sword",
};

/** R819.1.d — "functionally short for '[Reaction]' and 'When you play this, attach it to a Unit you control.'" */
describe("[Quick-Draw] (R819)", () => {
  /** R819.1.b — "Cards with Quick-Draw have Reaction inherently." */
  it("carries [Reaction] without the card printing it", () => {
    const state = makeState({
      cards: [sword],
      permanents: [{ cardId: "sword", controller: "p1" }],
    });

    expect(keywordsOf(state, "sword")).toContain("reaction");
  });

  it("expands into an attach trigger beside its own [Equip]", () => {
    const state = makeState({
      cards: [sword],
      permanents: [{ cardId: "sword", controller: "p1" }],
    });

    expect(abilitiesOf(state, "sword")).toEqual([
      ...sword.abilities,
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        targeting: { filters: [{ type: "unit", controller: "friendly" }] },
        effect: { op: "attachSelf", targetIndex: 0 },
      },
    ]);
  });

  /**
   * R819.2 — "Multiple instances of Quick-Draw do not trigger separately."
   * Falls out of asking whether the keyword is present, the way [Ambush]'s
   * R822.2 does.
   */
  it("attaches once however many instances it has", () => {
    const state = makeState({
      cards: [{ ...sword, keywords: ["quickDraw", "quickDraw"] }],
      permanents: [{ cardId: "sword", controller: "p1" }],
    });

    expect(
      abilitiesOf(state, "sword").filter(
        (ability) =>
          ability.kind === "triggered" && ability.effect.op === "attachSelf",
      ),
    ).toHaveLength(1);
  });

  /**
   * R819.1.c — "allows cards to be played and Attached using Reaction timing".
   * The point of the keyword: equipping mid-combat, which R813 otherwise
   * forbids for a permanent while the chain is up.
   */
  it("can be played while the chain is up", () => {
    expect(playedWithReactionTiming(board(), "p1", "sword", NORTH)).toBe(true);
  });

  it("attaches on resolution to the unit chosen", () => {
    let state = board();
    const played = applyAction(state, PLAY);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    state = played.state;

    // The trigger goes on the chain and R355.5 asks for its target as it
    // finalizes — a single legal unit is still asked about, not assumed.
    expect(state.chain.map(chainItemCardId)).toEqual(["sword"]);
    expect(state.pending?.prompt).toEqual({
      kind: "chooseTargets",
      chainIndex: 0,
      index: 0,
      remaining: 1,
      legal: ["hero"],
    });

    for (const action of [
      { type: "decide", playerId: "p1", targets: ["hero"] },
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    expect(state.permanents.sword?.attachedTo).toBe("hero");
  });

  /**
   * R355.8 — the trigger needs a friendly unit to choose. With none on the
   * board it must not leave the game unable to move, which is the shape of
   * bug the CLI playthrough turned up.
   */
  it("leaves a move available with nothing to attach to", () => {
    const empty: GameState = {
      ...board(),
      permanents: {},
    };
    const played = applyAction(empty, PLAY);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    expect(legalActions(played.state, "p1").length).toBeGreaterThan(0);
  });
});
