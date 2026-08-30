import { describe, expect, it } from "vitest";
import { HIDDEN_CARD, eventsFor, viewOf } from "../src/view.js";
import { renderEvent } from "../src/event-text.js";
import type { GameEvent } from "../src/events.js";
import { hide } from "../src/hidden.js";
import { applyAction } from "../src/actions.js";
import { startGame } from "../src/deck.js";
import { matchup } from "../src/decks/index.js";
import { legalActions } from "../src/legal.js";
import type { GameState, PlayerId } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** R107 — which zones are private, and to whom. */
describe("viewOf", () => {
  function board(): GameState {
    return makeState({
      p1: {
        hand: ["p1-hand-a", "p1-hand-b"],
        mainDeck: ["p1-deck-a", "p1-deck-b"],
        trash: ["p1-trash"],
        runePool: pool({ energy: 9 }),
      },
      p2: {
        hand: ["p2-hand-a", "p2-hand-b", "p2-hand-c"],
        mainDeck: ["p2-deck-a"],
        trash: ["p2-trash"],
      },
      cards: [
        "p1-hand-a",
        "p1-hand-b",
        "p1-deck-a",
        "p1-deck-b",
        "p1-trash",
        "p2-hand-a",
        "p2-hand-b",
        "p2-hand-c",
        "p2-deck-a",
        "p2-trash",
        "board-unit",
      ].map((id) => unit(id)),
      permanents: [{ cardId: "board-unit", controller: "p2" }],
      battlefields: ["bf-north"],
    });
  }

  /** R107.1.b — your own hand is yours to see. */
  it("leaves the viewer's own hand alone", () => {
    expect(viewOf(board(), "p1").players.p1.hand).toEqual([
      "p1-hand-a",
      "p1-hand-b",
    ]);
  });

  it("conceals the opponent's hand but not how big it is", () => {
    const view = viewOf(board(), "p1");

    expect(view.players.p2.hand).toHaveLength(3);
    expect(view.players.p2.hand.every((id) => id.startsWith(HIDDEN_CARD))).toBe(
      true,
    );
    expect(view.players.p2.hand).not.toContain("p2-hand-a");
  });

  /**
   * The point of doing it in the engine rather than the renderer: the card's
   * definition never reaches the client, so nothing downstream *can* leak it.
   */
  it("drops the definitions of cards it concealed", () => {
    const view = viewOf(board(), "p1");

    expect(view.cards["p2-hand-a"]).toBeUndefined();
    expect(view.cards["p2-deck-a"]).toBeUndefined();
    // And keeps a blank in its place, so a renderer still has something.
    for (const id of view.players.p2.hand) {
      expect(view.cards[id]?.name).toBe("hidden card");
    }
  });

  /** R107.2 — a deck's order is private to everyone, its owner included. */
  it("conceals both players' decks", () => {
    const view = viewOf(board(), "p1");

    expect(view.players.p1.mainDeck).toHaveLength(2);
    expect(view.players.p1.mainDeck).not.toContain("p1-deck-a");
    expect(view.players.p2.mainDeck).not.toContain("p2-deck-a");
  });

  /** Public zones pass through untouched. */
  it("shows both trashes, the board and the battlefields", () => {
    const view = viewOf(board(), "p1");

    expect(view.players.p1.trash).toEqual(["p1-trash"]);
    expect(view.players.p2.trash).toEqual(["p2-trash"]);
    expect(view.cards["p2-trash"]).toBeDefined();
    expect(view.cards["board-unit"]).toBeDefined();
    expect(view.permanents["board-unit"]).toBeDefined();
  });

  /**
   * R107.3.f — "Facedown Zones are Public Zones": that a card is there, and
   * where, is known. Which card it is is not.
   */
  describe("the Facedown Zone (R107.3.f)", () => {
    function hidden(): GameState {
      const base = makeState({
        p1: {
          hand: ["secret"],
          mainDeck: ["a"],
          runePool: pool({ universalPower: 3 }),
        },
        p2: { hand: [], mainDeck: ["b"] },
        cards: [
          unit("secret", { keywords: ["hidden"] }),
          unit("a"),
          unit("b"),
        ],
        battlefields: ["bf-north"],
      });
      const controlled: GameState = {
        ...base,
        battlefields: {
          "bf-north": {
            cardId: "bf-north",
            controller: "p1",
            contestedBy: null,
          },
        },
      };
      const result = hide(controlled, "p1", "secret", "bf-north");
      if (typeof result === "string") throw new Error(`hide failed: ${result}`);
      return result.state;
    }

    it("shows the owner what they hid", () => {
      const view = viewOf(hidden(), "p1");

      expect(view.facedown["bf-north"]?.cardId).toBe("secret");
      expect(view.cards["secret"]).toBeDefined();
    });

    it("shows the opponent that something is there, but not what", () => {
      const view = viewOf(hidden(), "p2");
      const entry = view.facedown["bf-north"];

      expect(entry).toBeDefined();
      expect(entry?.controller).toBe("p1");
      expect(entry?.cardId).not.toBe("secret");
      expect(entry?.cardId.startsWith(HIDDEN_CARD)).toBe(true);
      expect(view.cards["secret"]).toBeUndefined();
    });
  });

  /**
   * The property that makes a view usable as a client's whole world: a player
   * looking at their own view can find exactly the moves they really have.
   * Anything less and the client would need the full state to play; anything
   * more and it would be offering moves the server rejects.
   */
  it("offers the viewer the same moves the real state does", () => {
    const started = startGame(matchup({ seed: 7 }));
    if (!started.ok) throw new Error("setup failed");
    let state = started.state;

    // Past the mulligans, into a real turn.
    while (state.pending?.prompt.kind === "mulligan") {
      const result = applyAction(state, {
        type: "decide",
        playerId: state.pending.player,
        targets: [],
      });
      if (!result.ok) throw new Error("rejected");
      state = result.state;
    }

    for (const player of ["p1", "p2"] as PlayerId[]) {
      expect(legalActions(viewOf(state, player), player)).toEqual(
        legalActions(state, player),
      );
    }
  });

  /** A view is still a real GameState — everything that reads one still works. */
  it("keeps the rest of the state intact", () => {
    const state = board();
    const view = viewOf(state, "p1");

    expect(view.turn).toEqual(state.turn);
    expect(view.battlefieldOrder).toEqual(state.battlefieldOrder);
    expect(view.players.p1.runePool).toEqual(state.players.p1.runePool);
    expect(view.players.p2.points).toBe(state.players.p2.points);
  });
});


/**
 * R107's other half. `viewOf` filters the state; the event stream is the
 * second place a card's identity travels, and it used to carry `cardHidden`'s
 * `cardId` to both players.
 */
describe("the event stream through one player's eyes", () => {
  const drew: GameEvent = { type: "cardDrawn", playerId: "p1", cardId: "secret" };
  const hid: GameEvent = {
    type: "cardHidden",
    playerId: "p1",
    cardId: "secret",
    battlefieldId: "bf-north",
  };
  const recycled: GameEvent = {
    type: "cardRecycled",
    playerId: "p1",
    cardId: "secret",
  };

  it("leaves the owner's own log intact", () => {
    expect(eventsFor([drew, hid, recycled], "p1")).toEqual([drew, hid, recycled]);
  });

  /** R107.2 / R107.3.f — the opponent learns that it happened, not what. */
  it("withholds the card from everyone else", () => {
    const seen = eventsFor([drew, hid, recycled], "p2");

    for (const event of seen) {
      expect("cardId" in event && event.cardId).toBe(HIDDEN_CARD);
    }
    // What happened, and where, is public.
    expect(seen[1]).toMatchObject({ type: "cardHidden", battlefieldId: "bf-north" });
  });

  /** A discard and a burn both land in a public trash, so neither is withheld. */
  it("leaves the events that make a card public alone", () => {
    const public_: GameEvent[] = [
      { type: "cardDiscarded", playerId: "p1", cardId: "secret" },
      { type: "cardBurned", playerId: "p1", cardId: "secret" },
      { type: "cardRevealed", playerId: "p1", cardId: "secret" },
    ];

    expect(eventsFor(public_, "p2")).toEqual(public_);
  });

  it("reads as a card rather than as an id", () => {
    expect(renderEvent(eventsFor([drew], "p2")[0]!)).toBe("p1 drew a card");
  });
});

/**
 * R320.1 — a decision belongs to one player. That it is outstanding is public;
 * a Mulligan's or a Predict's options come out of a private zone and are not.
 */
describe("an outstanding decision through one player's eyes", () => {
  function waiting(): GameState {
    const state = makeState({
      p1: { hand: ["h1", "h2"], mainDeck: ["d1"] },
      p2: { mainDeck: ["d2"] },
      cards: [unit("h1"), unit("h2"), unit("d1"), unit("d2")],
    });
    return {
      ...state,
      pending: {
        player: "p1",
        prompt: { kind: "mulligan", max: 2, legal: ["h1", "h2"] },
      },
    };
  }

  it("leaves the holder their own options", () => {
    const mine = viewOf(waiting(), "p1").pending;

    expect(mine?.prompt).toEqual({ kind: "mulligan", max: 2, legal: ["h1", "h2"] });
  });

  it("withholds them from everyone else, keeping the count", () => {
    const theirs = viewOf(waiting(), "p2").pending;

    expect(theirs?.player).toBe("p1");
    expect(theirs?.prompt.kind).toBe("mulligan");
    const legal = theirs?.prompt && "legal" in theirs.prompt ? theirs.prompt.legal : [];
    expect(legal).toHaveLength(2);
    expect(legal).not.toContain("h1");
    expect(legal).not.toContain("h2");
  });

  /** Every stand-in it hands out is a card the client can render. */
  it("supplies a blank for each stand-in", () => {
    const view = viewOf(waiting(), "p2");
    const legal =
      view.pending?.prompt && "legal" in view.pending.prompt
        ? view.pending.prompt.legal
        : [];

    for (const stand of legal) {
      expect(view.cards[stand as string]).toBeDefined();
    }
  });
});
