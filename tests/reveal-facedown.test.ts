import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { restrictionAura } from "../src/builders.js";
import { revealFacedown, sweepFacedown } from "../src/hidden.js";
import { checkForWinner } from "../src/scoring.js";
import { FREE } from "../src/cost.js";
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
    expect(swept.state.players.p2.trash).toContain("ambusher");
  });

  /** R421.4's second clause. */
  it("is revealed when the game ends", () => {
    const state = board(false);
    const won: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, points: 8 },
      },
    };
    const outcome = checkForWinner(won);

    expect(outcome.state.winner).toBe("p1");
    expect(outcome.state.revealed).toContain("ambusher");
  });
});

/**
 * Noxus Saboteur. R421.4 makes the reveal a *consequence* of the zone change,
 * not a permission for it — so the card still moves and only the reveal is
 * stopped.
 *
 * The restriction fires constantly: playing a hidden card as a Reaction is a
 * zone change, and that is the whole Hidden pattern. What is unobservable is
 * its effect, because R108.1.b makes the Chain Public Information — a played
 * hidden card is known on arrival whether or not it was revealed — and
 * nothing in the pool yet reads the Revealed status.
 */
describe("Noxus Saboteur", () => {
  it("stops the reveal", () => {
    const shown = revealFacedown(board(true), "ambusher", "bf-north", "p2");

    expect(shown.state.revealed).not.toContain("ambusher");
    expect(shown.events).toEqual([]);
  });

  it("does not stop the card changing zones", () => {
    const state = board(true);
    const lost: GameState = {
      ...state,
      battlefields: {
        ...state.battlefields,
        "bf-north": { ...state.battlefields["bf-north"]!, controller: "p1" },
      },
    };
    const swept = sweepFacedown(lost);

    // R323.7 still sends it to the trash; only the disclosure was forbidden.
    expect(swept.state.players.p2.trash).toContain("ambusher");
    expect(swept.events.map((event) => event.type)).not.toContain("cardRevealed");
  });

  /** "…your *opponents'*" — its controller's own hidden cards are untouched. */
  it("leaves its own controller's hidden cards alone", () => {
    const state = board(true);
    const mine: GameState = {
      ...state,
      facedown: { "bf-north": { cardId: "ambusher", controller: "p1", hiddenOnTurn: 0 } },
    };
    const shown = revealFacedown(mine, "ambusher", "bf-north", "p1");

    expect(shown.state.revealed).toContain("ambusher");
  });
});

/**
 * The claim that makes "it forbids the disclosure, not the move" coherent:
 * blocking R421.4's reveal does not keep the card secret, because it is on
 * its way to the Chain and R108.1.b makes the Chain Public Information.
 *
 * If that were not true, Saboteur would let a player resolve a spell their
 * opponent is not allowed to read, and the reading would be nonsense.
 */
describe("a hidden card played while Saboteur is there", () => {
  it("is still public to the opponent, because the chain is", () => {
    const state = board(true);
    const played: GameState = {
      ...state,
      facedown: {},
      chain: [
        { kind: "spell", cardId: "ambusher", controller: "p2", targets: [] },
      ],
    };

    // R108.1.b — p1 receives the card's identity from the chain, not from a
    // reveal that never happened.
    expect(viewOf(played, "p1").cards.ambusher).toBeDefined();
    expect(played.revealed).not.toContain("ambusher");
  });
});
