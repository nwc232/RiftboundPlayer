import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { artFor } from "../src/ui/card-art.js";
import { isHiddenCard, viewOf } from "../src/view.js";
import { renderEvent } from "../src/event-text.js";
import {
  DECKS,
  actingPlayer,
  describe as describeAction,
  groupMoves,
  movesFor,
  newGame,
  promptArity,
  subjectOf,
  whyNotPlayable,
} from "../src/ui/game.js";
import { seatOf } from "../src/state.js";
import type { GameState } from "../src/state.js";
import { pool } from "./fixtures.js";

/**
 * The UI's own logic, tested without a DOM. Everything the browser does that
 * could be wrong lives in these few functions; the components are a projection
 * of them.
 */

const ANSI = new RegExp("\\u001b");

function opened(seed = 7): GameState {
  return newGame(seed);
}

/** Answers whatever decision is outstanding, taking the first legal option. */
function settle(state: GameState, limit = 40): GameState {
  let current = state;
  for (let i = 0; i < limit && current.pending !== null; i += 1) {
    const move = movesFor(current, current.pending.player)[0];
    if (move === undefined) break;
    const result = applyAction(current, move.action);
    if (!result.ok) break;
    current = result.state;
  }
  return current;
}

describe("who the UI acts as", () => {
  it("follows the pending decision before anything else (R320.1)", () => {
    const state = opened();

    expect(state.pending?.player).toBe("p1");
    expect(actingPlayer(state)).toBe("p1");
  });

  it("hands over to the other player when the decision does", () => {
    const answered = applyAction(opened(), {
      type: "decide",
      playerId: "p1",
      targets: [],
    });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;

    // R117 — the second player's mulligan is the next thing owed.
    expect(actingPlayer(answered.state)).toBe("p2");
  });
});

/** R117.1's "up to two" is why a click cannot always answer on its own. */
describe("how many cards a prompt wants", () => {
  it("lets the mulligan take none, one, or two", () => {
    expect(promptArity(opened())).toEqual({ min: 0, max: 2 });
  });

  it("wants nothing when no decision is outstanding", () => {
    expect(promptArity(settle(opened()))).toEqual({ min: 0, max: 0 });
  });
});

describe("labelling moves", () => {
  it("names the card an action is about, so moves can be grouped by it", () => {
    const state = settle(opened());

    for (const move of movesFor(state, actingPlayer(state))) {
      expect(move.label.length).toBeGreaterThan(0);
      const subject = subjectOf(move.action);
      if (subject !== undefined) expect(state.cards[subject]).toBeDefined();
    }
  });

  /**
   * Read off the ability's own data rather than hardcoded, so a rune reads
   * "exhaust for 1 energy" instead of "ability 1".
   */
  it("words a rune's abilities from what they cost and give", () => {
    const state = settle(opened());
    const runeId = seatOf(state, state.turn.player).runes[0];
    expect(runeId).toBeDefined();

    const labels = [0, 1].map((abilityIndex) =>
      describeAction(state, {
        type: "activateAbility",
        playerId: state.turn.player,
        sourceId: runeId!,
        abilityIndex,
      }),
    );

    expect(labels[0]).toBe("exhaust for 1 energy");
    expect(labels[1]).toMatch(/^recycle for 1 \w+ power$/);
  });

  it("says where a unit is being played to", () => {
    const state = settle(opened());

    expect(
      describeAction(state, {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "tideturner-1",
        destination: { kind: "base", player: "p1" },
      }),
    ).toBe("play to base");
  });
});

/** The browser shows the same sentences the CLI does, without the colour. */
describe("event wording is shared", () => {
  it("carries no terminal escape codes", () => {
    const line = renderEvent({ type: "turnBegan", playerId: "p1", turn: 1 });

    expect(line).toBe("— turn 1: p1 —");
    expect(ANSI.test(line)).toBe(false);
  });
});

/**
 * The two questions a player actually has at the board — "what can I do?" and
 * "why can't I play this?" — which the first version of the UI answered with
 * an empty list and nothing else.
 */
describe("telling the player what is going on", () => {
  /** Past both mulligans, turn 1's Main Phase, pool empty (R316.3). */
  function opening(): GameState {
    return settle(opened());
  }

  it("groups every legal move under the card it acts on", () => {
    const state = opening();
    const groups = groupMoves(state, movesFor(state, actingPlayer(state)));

    // The runes are the only thing to do with an empty pool, and they must be
    // findable without knowing to click them first.
    const headings = groups.map((group) => group.heading);
    expect(headings).toContain("Chaos Rune");
    expect(groups.at(-1)?.cardId).toBeNull();
    // R650's concede is legal here too, but `movesFor` keeps it out of the
    // list on purpose — see `src/ui/game.ts`.
    expect(groups.at(-1)?.moves.map((m) => m.label)).toEqual(["end turn"]);
  });

  it("says what an unaffordable card costs and what you hold", () => {
    const state = opening();
    const player = seatOf(state, state.turn.player);
    const expensive = player.hand.find(
      (id) => (state.cards[id]?.cost.energy ?? 0) >= 3,
    );
    expect(expensive).toBeDefined();

    const why = whyNotPlayable(state, state.turn.player, expensive!);

    expect(why).toMatch(/^costs /);
    expect(why).toContain("your pool holds nothing");
    expect(why).toContain("rune");
  });

  /** R355.8 — "valid choices must be made for all targets." */
  it("says when there is nothing legal to target", () => {
    const state = opening();
    const rich: GameState = {
      ...state,
      players: {
        ...state.players,
        [state.turn.player]: {
          ...seatOf(state, state.turn.player),
          runePool: pool({
            energy: 20,
            power: { chaos: 5, calm: 5, body: 5, fury: 5 },
          }),
        },
      },
    };
    const player = seatOf(rich, rich.turn.player);
    const targeted = player.hand.find((id) => {
      const ability = rich.cards[id]?.abilities.find(
        (each) => each.kind === "activated",
      );
      return (ability?.targeting?.filters.length ?? 0) > 0;
    });
    expect(targeted).toBeDefined();

    // The board is empty, so nothing satisfies any unit filter.
    expect(whyNotPlayable(rich, rich.turn.player, targeted!)).toContain(
      "R355.8",
    );
  });

  it("has nothing to explain about a card that can be played", () => {
    const state = opening();
    const runeId = seatOf(state, state.turn.player).runes[0];

    // A rune is not in hand, so there is no "why not" to give.
    expect(whyNotPlayable(state, state.turn.player, runeId!)).toBeNull();
  });
});

/**
 * R107 — a seat is offered *its own* moves, not the turn player's.
 *
 * The seat selector filtered the board through `viewOf` and then asked
 * `legalActions` for whoever held the turn, so p2's screen listed p1's plays
 * over cards it had correctly been refused the identity of — "play to base"
 * against a card named "hidden card". A client on the other end of a socket
 * gets its own legal moves and nobody else's.
 */
describe("whose moves a seat is offered", () => {
  it("offers the seat nothing while it is not their turn", () => {
    const state = newGame(7);
    const asP2 = viewOf(state, "p2");

    // p1 holds the turn, so p1 has moves and p2 has none of their own.
    expect(movesFor(asP2, "p1").length).toBeGreaterThan(0);
    expect(movesFor(asP2, "p2")).toEqual([]);
  });

  /** And what p1's screen offers never names a card p2 cannot see. */
  it("never offers a seat a move over a concealed card", () => {
    const state = newGame(7);
    const asP2 = viewOf(state, "p2");

    for (const move of movesFor(asP2, "p2")) {
      expect(move.subject === undefined || !isHiddenCard(move.subject)).toBe(true);
    }
  });
});

/** Every authored card the UI can start a game with has its printed art. */
describe("card art", () => {
  it("covers every card in all three decks", () => {
    const missing = new Set<string>();
    for (const [index] of DECKS.entries()) {
      const state = newGame(1, [index, (index + 1) % DECKS.length]);
      for (const card of Object.values(state.cards)) {
        // Tokens are created during play and are not printed cards.
        if (card.isToken === true) continue;
        if (artFor(card.name) === undefined) missing.add(card.name);
      }
    }

    expect([...missing]).toEqual([]);
  });
});
