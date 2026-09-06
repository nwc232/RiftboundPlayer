import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import { channel, draw } from "../src/builders.js";
import { channelRunes } from "../src/channel.js";
import { seatOf } from "../src/state.js";
import type { GameState } from "../src/state.js";
import { makeState, runeCard, unit } from "./fixtures.js";

/**
 * R430 — Channel. Twenty-two cards in the printed pool instruct it, and until
 * now only the Channel Phase could do it: R430.4.a was built and R430.4.b was
 * not.
 */
function board(runeDeck: string[]): GameState {
  return makeState({
    p1: { runeDeck, mainDeck: ["a", "b", "c"] },
    cards: [
      ...runeDeck.map((id) => runeCard(id, "chaos")),
      unit("a"),
      unit("b"),
      unit("c"),
    ],
  });
}

const context = { controller: "p1" as const, sourceId: "src", targets: [] };

describe("R430 — channelling as an effect", () => {
  it("moves runes from the top of the rune deck to the board (R430.1)", () => {
    const { state, events, channelled } = channelRunes(
      board(["r1", "r2", "r3"]),
      "p1",
      2,
    );

    expect(channelled).toBe(2);
    expect(seatOf(state, "p1").runes).toEqual(["r1", "r2"]);
    expect(seatOf(state, "p1").runeDeck).toEqual(["r3"]);
    expect(events).toHaveLength(2);
  });

  /** R430.2.a — "By default, runes are channeled readied." */
  it("channels readied by default", () => {
    const { state } = channelRunes(board(["r1"]), "p1", 1);

    expect(state.runes["r1"]?.exhausted).toBe(false);
  });

  /** R430.2 — "Channel 1 rune exhausted" is the instruction's business. */
  it("channels exhausted when told to", () => {
    const { state } = execute(board(["r1"]), channel(1, { exhausted: true }), context);

    expect(state.runes["r1"]?.exhausted).toBe(true);
  });

  /** R430.3 — "channel as many as possible", which is not an error. */
  it("takes as many as there are", () => {
    const { state, channelled } = channelRunes(board(["r1"]), "p1", 3);

    expect(channelled).toBe(1);
    expect(seatOf(state, "p1").runes).toEqual(["r1"]);
    expect(seatOf(state, "p1").runeDeck).toEqual([]);
  });

  /** An empty rune deck is not a Burn Out — R431 is about the Main Deck. */
  it("does nothing at all on an empty rune deck", () => {
    const before = board([]);
    const { state, channelled, events } = channelRunes(before, "p1", 2);

    expect(channelled).toBe(0);
    expect(events).toEqual([]);
    expect(seatOf(state, "p1").mainDeck).toEqual(["a", "b", "c"]);
  });

  /**
   * R430.5's second example — "Channel 2 runes exhausted. If you couldn't
   * channel 2 runes this way, draw 1." Catalyst of Aeons and Mobilize both
   * print it, and nothing else can see how many arrived.
   */
  describe("the printed 'if you couldn't' clause", () => {
    const spell = channel(2, { exhausted: true, ifShort: draw(1) });

    it("runs the fallback when the deck came up short", () => {
      const { state } = execute(board(["r1"]), spell, context);

      expect(seatOf(state, "p1").runes).toEqual(["r1"]);
      expect(seatOf(state, "p1").hand).toEqual(["a"]);
    });

    it("does not run it when the full number arrived", () => {
      const { state } = execute(board(["r1", "r2"]), spell, context);

      expect(seatOf(state, "p1").runes).toEqual(["r1", "r2"]);
      expect(seatOf(state, "p1").hand).toEqual([]);
    });
  });
});
