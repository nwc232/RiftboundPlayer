import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { restrictionAura } from "../src/builders.js";
import {
  playableFromFacedown,
  revealFacedown,
  sweepFacedown,
} from "../src/hidden.js";
import { playZonesFor } from "../src/zones.js";
import { checkForWinner } from "../src/scoring.js";
import { FREE } from "../src/cost.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState } from "../src/state.js";
import { viewOf } from "../src/view.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * R421.4 — "If a facedown card would change zones or if the game ends, its
 * owner reveals it to all players."
 *
 * This is the *only* thing in the game that reveals a facedown card. Scuttle
 * Crab's "you can look at their facedown cards" is not one: R424.2.b says
 * showing Private information "does not count as revealing and does not
 * trigger any effects that trigger when cards are revealed".
 */

/** Noxus Saboteur — "Your opponents' [Hidden] cards can't be revealed here." */
const noxusSaboteur: CardInstance = {
  ...unit("saboteur", { might: 3 }),
  abilities: [restrictionAura("beRevealed", "enemy", { here: true })],
};

const NORTH = { kind: "battlefield", id: "bf-north" } as const;

/** R811.1.b — a hidden card cannot be played on the turn it was hidden. */
const onLaterTurn = (state: GameState): GameState => ({
  ...state,
  turn: { ...state.turn, number: 2, player: "p2" },
});

function board(withSaboteur: boolean): GameState {
  const base = makeState({
    p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
    p2: {
      hand: [],
      mainDeck: ["b"],
      runePool: pool({ energy: 9 }),
    },
    cards: [
      noxusSaboteur,
      { ...unit("ambusher", { might: 2 }), keywords: ["hidden"] },
      unit("a"),
      unit("b"),
    ],
    permanents: withSaboteur
      ? [{ cardId: "saboteur", controller: "p1", location: NORTH }]
      : [],
    battlefields: [["bf-north", "p2"]],
  });
  // p2 has a card hidden at the battlefield they control.
  return {
    ...base,
    facedown: {
      "bf-north": { cardId: "ambusher", controller: "p2", hiddenOnTurn: 0 },
    },
  };
}

describe("a facedown card changing zones", () => {
  it("is revealed to all players", () => {
    const shown = revealFacedown(board(false), "ambusher", "bf-north", "p2");

    expect(shown.state.revealed).toContain("ambusher");
    expect(shown.events).toEqual([
      { type: "cardRevealed", playerId: "p2", cardId: "ambusher" },
    ]);
  });

  /** R323.7 — losing the battlefield sends what was hidden there to the trash. */
  it("is revealed on its way to the trash", () => {
    const state = board(false);
    // p1 now holds the battlefield, so p2's facedown card is swept.
    const lost: GameState = {
      ...state,
      battlefields: {
        ...state.battlefields,
        "bf-north": { ...state.battlefields["bf-north"]!, controller: "p1" },
      },
    };
    const swept = sweepFacedown(lost);

    expect(swept.events.map((event) => event.type)).toContain("cardRevealed");
    expect(seatOf(swept.state, "p2").trash).toContain("ambusher");
  });

  /** R421.4's second clause. */
  it("is revealed when the game ends", () => {
    const state = board(false);
    const won: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...seatOf(state, "p1"), points: 8 },
      },
    };
    const outcome = checkForWinner(won);

    expect(outcome.state.winner).toBe("p1");
    expect(outcome.state.revealed).toContain("ambusher");
  });
});

/**
 * Noxus Saboteur — "Your opponents' [Hidden] cards can't be revealed here."
 *
 * R421.4 is a prerequisite of the move, not a remark about it: "if a facedown
 * card *would* change zones … its owner reveals it to all players." The reveal
 * is the flip, so a card that cannot be revealed here cannot be played from
 * here — which shuts off the ambush the whole Hidden pattern is for.
 *
 * The reading where it forbids only the disclosure forbids nothing at all:
 * R108.1.b would make the card Public Information on the Chain a moment later
 * regardless. A restriction that restricts nothing is not a reading.
 */
describe("Noxus Saboteur", () => {
  it("stops the opponent playing their hidden card", () => {
    const state = onLaterTurn(board(true));

    expect(playableFromFacedown(state, "p2", "ambusher")).toBeUndefined();
    expect(playZonesFor(state, "p2", "ambusher")).toEqual([]);
  });

  it("is what stops it — without it the play is there", () => {
    const state = onLaterTurn(board(false));

    expect(playableFromFacedown(state, "p2", "ambusher")).toBe("bf-north");
    expect(playZonesFor(state, "p2", "ambusher")).toHaveLength(1);
  });

  /**
   * "…your *opponents'*" — its controller's own hidden cards are untouched, so
   * Saboteur does not shut off its own side's ambushes.
   */
  it("leaves its own controller's hidden cards alone", () => {
    const state = onLaterTurn(board(true));
    const mine: GameState = {
      ...state,
      facedown: {
        "bf-north": { cardId: "ambusher", controller: "p1", hiddenOnTurn: 0 },
      },
    };

    expect(playableFromFacedown(mine, "p1", "ambusher")).toBe("bf-north");
  });

  /**
   * R323.7's sweep is the game removing the card, not a player acting, so
   * there is no action for "can't" to forbid. The reveal is skipped and the
   * removal proceeds — the rules do not say which of "can't be revealed" and
   * "must be removed" gives way, and leaving a card facedown at a battlefield
   * its controller does not control would contradict R107.3.c.
   */
  it("does not strand a swept card at a battlefield", () => {
    const state = board(true);
    const lost: GameState = {
      ...state,
      battlefields: {
        ...state.battlefields,
        "bf-north": { ...state.battlefields["bf-north"]!, controller: "p1" },
      },
    };
    const swept = sweepFacedown(lost);

    expect(seatOf(swept.state, "p2").trash).toContain("ambusher");
    expect(swept.events.map((event) => event.type)).not.toContain("cardRevealed");
  });
});

/**
 * R319.8 / R323.6 / R323.7 — when a hidden card is lost after its battlefield
 * empties.
 *
 * Take a battlefield, hide a card there, then retreat the unit that took it.
 * The card is gone *immediately*, not at end of turn: R319.8 makes a Cleanup
 * outstanding "after a Move is completed", and one cleanup runs both R323.6's
 * step 4 (lose control of a battlefield with none of your units on it, in an
 * Open State with no combat) and R323.7's step 5 (remove hidden cards from
 * battlefields their controller does not control) — in that order. There is
 * no window in between to move something back.
 */
describe("retreating off a battlefield you hid a card at", () => {
  function held(): GameState {
    const base = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [
        unit("holder", { might: 3 }),
        { ...unit("ambusher", { might: 2 }), keywords: ["hidden"] },
        unit("a"),
        unit("b"),
      ],
      permanents: [{ cardId: "holder", controller: "p1", location: NORTH }],
      battlefields: [["bf-north", "p1"]],
    });
    return {
      ...base,
      facedown: {
        "bf-north": { cardId: "ambusher", controller: "p1", hiddenOnTurn: 1 },
      },
    };
  }

  it("loses the card in the cleanup the move itself triggers", () => {
    const retreat = applyAction(held(), {
      type: "standardMove",
      playerId: "p1",
      cardId: "holder",
      destination: { kind: "base", player: "p1" },
    });

    expect(retreat.ok).toBe(true);
    if (!retreat.ok) return;
    // Step 4 first — no units there, Open State, no combat.
    expect(retreat.state.battlefields["bf-north"]?.controller).toBeNull();
    // Then step 5, in the same cleanup.
    expect(retreat.state.facedown["bf-north"]).toBeUndefined();
    expect(seatOf(retreat.state, "p1").trash).toContain("ambusher");
  });

  /** R421.4 — it changed zones, so its owner revealed it on the way out. */
  it("reveals it as it goes", () => {
    const retreat = applyAction(held(), {
      type: "standardMove",
      playerId: "p1",
      cardId: "holder",
      destination: { kind: "base", player: "p1" },
    });

    expect(retreat.ok).toBe(true);
    if (!retreat.ok) return;
    expect(retreat.events.map((event) => event.type)).toContain("cardRevealed");
  });

  it("keeps it while a unit of yours is still standing there", () => {
    const state = held();
    const stillThere: GameState = {
      ...state,
      cards: { ...state.cards, second: unit("second", { might: 1 }) },
      permanents: {
        ...state.permanents,
        second: {
          cardId: "second",
          controller: "p1",
          exhausted: false,
          location: NORTH,
          damage: 0,
        },
      },
    };
    const retreat = applyAction(stillThere, {
      type: "standardMove",
      playerId: "p1",
      cardId: "holder",
      destination: { kind: "base", player: "p1" },
    });

    expect(retreat.ok).toBe(true);
    if (!retreat.ok) return;
    expect(retreat.state.battlefields["bf-north"]?.controller).toBe("p1");
    expect(retreat.state.facedown["bf-north"]).toBeDefined();
  });
});
