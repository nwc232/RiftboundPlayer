import { describe, expect, it } from "vitest";
import { legalActions } from "../src/legal.js";
import {
  act,
  emptyRoom,
  freeSeat,
  join,
  leave,
  messageFor,
  restart,
} from "../src/server/room.js";
import { HIDDEN_CARD } from "../src/view.js";
import { seatOf } from "../src/state.js";

/**
 * A room, without a socket. Everything worth checking about playing over a
 * network is decided here — who may act, what each seat is shown, what an
 * illegal or dishonest message does — and none of it needs a server running.
 */

const dealt = () => {
  let room = emptyRoom("abc");
  room = join(room, "p1", 0, 1);
  room = join(room, "p2", 1, 1);
  return room;
};

/**
 * R117 — both players mulligan before anything else can happen, so a fixture
 * that wants a *playable* board has to answer those first. Keeping both hands
 * is the shortest way through.
 */
const seeded = () => {
  let room = dealt();
  for (const seat of ["p1", "p2"] as const) {
    const outcome = act(room, seat, { type: "decide", playerId: seat, targets: [] });
    if (!outcome.ok) throw new Error(`mulligan refused: ${outcome.reason}`);
    room = outcome.room;
  }
  return room;
};

describe("filling a room", () => {
  it("seats joiners in arrival order and then is full", () => {
    let room = emptyRoom("abc");
    expect(freeSeat(room)).toBe("p1");

    room = join(room, "p1", 0, 1);
    expect(freeSeat(room)).toBe("p2");

    room = join(room, "p2", 1, 1);
    expect(freeSeat(room)).toBeUndefined();
  });

  /** Nothing to look at until both are here — and no deck chosen for anyone. */
  it("deals only once both seats are filled", () => {
    let room = join(emptyRoom("abc"), "p1", 0, 1);
    expect(room.game).toBeUndefined();
    expect(messageFor(room, "p1").kind).toBe("waiting");

    room = join(room, "p2", 1, 1);
    expect(room.game).toBeDefined();
    expect(messageFor(room, "p1").kind).toBe("state");
  });

  it("gives each seat the deck it asked for", () => {
    const room = dealt();
    const message = messageFor(room, "p1");
    if (message.kind !== "state") throw new Error("expected a game");

    // Deck 0 is Vex, deck 1 is Rengar.
    // Ids belong to a seat, so a Legend's is stamped with the seat that
    // brought it — which is what lets two players bring the same list.
    expect(seatOf(message.state, "p1").legend).toBe("p1-gloomist");
    expect(seatOf(message.state, "p2").legend).toBe("p2-pridestalker");
  });
});

/**
 * The check that matters. A seat may only act *as itself*: without it a client
 * could play out of its opponent's hand by naming them, which is precisely
 * what R107 spent all that effort making impossible to see.
 */
describe("acting as someone else", () => {
  it("is refused", () => {
    // R117 — p1's mulligan is outstanding, so this is a move that is legal for
    // p1 and being submitted by nobody else. The seat check is what stops it.
    const room = dealt();
    const theirs = legalActions(room.game!.state, "p1")[0];
    if (theirs === undefined) throw new Error("expected p1 to have a move");

    expect(act(room, "p2", theirs)).toEqual({
      ok: false,
      reason: "notYourSeat",
    });
  });

  it("leaves the game untouched when it is refused", () => {
    const room = dealt();
    const before = room.game!.state;
    const theirs = legalActions(before, "p1")[0]!;

    act(room, "p2", theirs);
    expect(room.game!.state).toBe(before);
  });
});

describe("acting", () => {
  it("advances the authoritative game", () => {
    const room = seeded();
    const mine = legalActions(room.game!.state, "p1")[0]!;
    const outcome = act(room, "p1", mine);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.room.game!.state).not.toBe(room.game!.state);
    expect(outcome.room.game!.events.length).toBeGreaterThan(0);
  });

  /** `legalActions` stays the only authority; the server does not re-judge. */
  it("refuses an illegal move with the engine's own reason", () => {
    const room = seeded();
    const outcome = act(room, "p1", {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: "not-a-card",
    });

    expect(outcome).toEqual({ ok: false, reason: "cardNotFound" });
  });

  it("refuses anything at all before the game is dealt", () => {
    const room = join(emptyRoom("abc"), "p1", 0, 1);

    expect(
      act(room, "p1", { type: "endTurn", playerId: "p1" }),
    ).toEqual({ ok: false, reason: "noGame" });
  });
});

/**
 * R107 at the socket. The unfiltered state never leaves the process, so a
 * client cannot show what it was not sent however it is written.
 */
describe("what a seat is sent", () => {
  it("conceals the opponent's hand", () => {
    const message = messageFor(dealt(), "p1");
    if (message.kind !== "state") throw new Error("expected a game");

    for (const cardId of seatOf(message.state, "p2").hand) {
      expect(cardId.startsWith(HIDDEN_CARD)).toBe(true);
      // And the definition is not smuggled along beside it.
      expect(message.state.cards[cardId]?.name).toBe("hidden card");
    }
  });

  it("leaves the seat its own hand", () => {
    const message = messageFor(dealt(), "p1");
    if (message.kind !== "state") throw new Error("expected a game");

    for (const cardId of seatOf(message.state, "p1").hand) {
      expect(cardId.startsWith(HIDDEN_CARD)).toBe(false);
    }
  });

  it("filters the log the same way", () => {
    let room = seeded();
    // Play far enough in that somebody has drawn a card.
    for (let step = 0; step < 12; step += 1) {
      const actor = room.game!.state.turn.player;
      const move = legalActions(room.game!.state, actor)[0];
      if (move === undefined) break;
      const outcome = act(room, actor, move);
      if (!outcome.ok) break;
      room = outcome.room;
    }

    const theirs = messageFor(room, "p2");
    if (theirs.kind !== "state") throw new Error("expected a game");
    for (const event of theirs.events) {
      if (event.type !== "cardDrawn" || event.playerId === "p2") continue;
      expect(event.cardId).toBe(HIDDEN_CARD);
    }
  });
});

describe("leaving", () => {
  it("frees the seat and ends the game", () => {
    const room = leave(dealt(), "p2");

    expect(freeSeat(room)).toBe("p2");
    expect(room.game).toBeUndefined();
  });
});

describe("restarting", () => {
  it("deals again and keeps both seats", () => {
    const room = seeded();
    expect(room.game!.events.length).toBeGreaterThan(0);

    const again = restart(room, 99);
    expect(again.seats.p1).toBeDefined();
    expect(again.seats.p2).toBeDefined();
    expect(again.game!.events).toEqual([]);
  });

  it("does nothing while a seat is empty", () => {
    const room = join(emptyRoom("abc"), "p1", 0, 1);
    expect(restart(room, 5).game).toBeUndefined();
  });
});
