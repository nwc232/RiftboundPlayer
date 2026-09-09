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
  seatsOf,
  awaySeats,
  expireAway,
  rejoin,
  seatFor,
  GRACE_MS,
} from "../src/server/room.js";
import type { Room } from "../src/server/room.js";
import { HIDDEN_CARD } from "../src/view.js";
import { seatOf } from "../src/state.js";
import type { GameState, PlayerId } from "../src/state.js";

/**
 * A room, without a socket. Everything worth checking about playing over a
 * network is decided here — who may act, what each seat is shown, what an
 * illegal or dishonest message does — and none of it needs a server running.
 */

const dealt = () => {
  let room = emptyRoom("abc");
  room = join(room, "p1", 0, 1, "tok-p1");
  room = join(room, "p2", 1, 1, "tok-p2");
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

    room = join(room, "p1", 0, 1, "tok-p1");
    expect(freeSeat(room)).toBe("p2");

    room = join(room, "p2", 1, 1, "tok-p2");
    expect(freeSeat(room)).toBeUndefined();
  });

  /** Nothing to look at until both are here — and no deck chosen for anyone. */
  it("deals only once both seats are filled", () => {
    let room = join(emptyRoom("abc"), "p1", 0, 1, "tok-p1");
    expect(room.game).toBeUndefined();
    expect(messageFor(room, "p1").kind).toBe("waiting");

    room = join(room, "p2", 1, 1, "tok-p2");
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
    const room = join(emptyRoom("abc"), "p1", 0, 1, "tok-p1");

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

describe("dropping out", () => {
  const T0 = 1_000_000;

  /**
   * **A deliberate deviation from R650–652**, and the reason it is worth
   * testing rather than assuming: the rules have no notion of a lost
   * connection, so the literal reading makes a dropped socket an instant
   * concession. Over a tunnel, on somebody's home wifi, that ends a game for
   * a two-second hiccup. The seat is held instead — nothing about R652
   * changes, it just happens a minute later.
   */
  it("holds the seat rather than conceding it", () => {
    const room = leave(dealt(), "p2", T0);

    expect(awaySeats(room)).toEqual(["p2"]);
    expect(room.game?.state.winner).toBeNull();
    expect(room.game?.state.turnOrder).toEqual(["p1", "p2"]);
    // Still nobody else's chair to take.
    expect(freeSeat(room)).toBeUndefined();
  });

  it("tells the others who is away", () => {
    const room = leave(dealt(), "p2", T0);
    const message = messageFor(room, "p1");

    expect(message.kind).toBe("state");
    if (message.kind !== "state") return;
    expect(message.away).toEqual(["p2"]);
  });

  /** The seat is theirs, and the token is what says so. */
  it("gives the seat back to whoever holds its token", () => {
    let room = emptyRoom("abc");
    room = join(room, "p1", 0, 1, "tok-1");
    room = join(room, "p2", 1, 1, "tok-2");
    room = leave(room, "p2", T0);

    expect(seatFor(room, "tok-2")).toBe("p2");
    const back = rejoin(room, "p2");
    expect(awaySeats(back)).toEqual([]);
    expect(back.game?.state.winner).toBeNull();
  });

  /** A stranger's token is not a claim, and neither is a seated player's. */
  it("refuses a token that is not a waiting seat's", () => {
    let room = emptyRoom("abc");
    room = join(room, "p1", 0, 1, "tok-1");
    room = join(room, "p2", 1, 1, "tok-2");
    room = leave(room, "p2", T0);

    expect(seatFor(room, "nonsense")).toBeUndefined();
    // p1 is still sitting there, so their own token claims nothing — a second
    // tab must not be able to take over a chair someone is using.
    expect(seatFor(room, "tok-1")).toBeUndefined();
  });

  /** R651.1 — once the grace period is up it is a concession after all. */
  it("concedes a Duel seat that never comes back", () => {
    const room = leave(dealt(), "p2", T0);

    const early = expireAway(room, T0 + GRACE_MS - 1);
    expect(early.expired).toEqual([]);
    expect(early.room.game?.state.winner).toBeNull();

    const late = expireAway(room, T0 + GRACE_MS);
    expect(late.expired).toEqual(["p2"]);
    expect(late.room.game?.state.winner).toBe("p1");
  });

  /** R651.2 — and a Skirmish carries on with the two who are left. */
  it("removes a Skirmish seat that never comes back", () => {
    let room = emptyRoom("abc", 3);
    for (const [at, seat] of seatsOf(room).entries()) {
      room = join(room, seat, at, 1, `tok-${at}`);
    }
    room = leave(room, "p2", T0);

    const { room: after, expired } = expireAway(room, T0 + GRACE_MS);

    expect(expired).toEqual(["p2"]);
    expect(after.game?.state.winner).toBeNull();
    expect(after.game?.state.turnOrder).toEqual(["p1", "p3"]);
  });

  /** Before the deal there is nothing to be removed from, so it reopens. */
  it("reopens a seat vacated before the deal", () => {
    let room = emptyRoom("abc", 3);
    room = join(room, "p1", 0, 1, "tok-1");
    room = join(room, "p2", 1, 1, "tok-2");

    const after = leave(room, "p2", T0);

    expect(after.game).toBeUndefined();
    expect(freeSeat(after)).toBe("p2");
  });

  /** Re-dealing while somebody is trying to reconnect would lose their game. */
  it("will not restart while a seat is away", () => {
    const room = leave(dealt(), "p2", T0);
    const before = room.game?.state;

    expect(restart(room, 99).game?.state).toBe(before);
  });
});

/**
 * R117 — "In turn order, players perform their Mulligan."
 *
 * The engine does exactly that, one task per seat. What this adds is that
 * nobody has to *wait* their turn to answer: nothing about one player's
 * mulligan is visible to another — each sets aside from their own hand, draws
 * from their own deck, and recycles to their own deck — so the order is
 * unobservable and making three people watch each other take turns before the
 * game starts buys nothing. The answers are held and applied in R117's order.
 */
describe("R117 — mulligans answered out of order", () => {
  const table = (players: number) => {
    let room = emptyRoom("abc", players);
    seatsOf(room).forEach((seat, at) => {
      room = join(room, seat, at % 5, 1, `tok-${seat}`);
    });
    return room;
  };

  const answer = (room: Room, seat: PlayerId, targets: string[] = []) => {
    const outcome = act(room, seat, { type: "decide", playerId: seat, targets });
    if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
    return outcome.room;
  };

  it("holds an answer from a seat whose turn has not come", () => {
    const room = table(3);
    // p1 is the one being asked; p3's answer is early by two.
    expect(room.game?.state.pending?.player).toBe("p1");

    const after = answer(room, "p3");

    expect(after.earlyMulligans.p3).toEqual([]);
    // Nothing has happened to the game: R117's order is untouched.
    expect(after.game?.state.pending?.player).toBe("p1");
  });

  it("performs them all in turn order once the first is answered", () => {
    let room = table(3);
    room = answer(room, "p3");
    room = answer(room, "p2");

    // The one the game was actually waiting on. Answering it should carry
    // straight through the two already held rather than stopping between them.
    room = answer(room, "p1");

    expect(room.game?.state.pending).toBeNull();
    expect(room.earlyMulligans).toEqual({});
    const order = room
      .game!.events.filter((event) => event.type === "mulliganed")
      .map((event) => event.playerId);
    expect(order).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps each seat's own choice with that seat", () => {
    let room = table(2);
    const theirs = room.game!.state.players.p2!.hand.slice(0, 2);

    room = answer(room, "p2", theirs);
    room = answer(room, "p1", []);

    // R117.3 — the ones set aside go to the bottom of *their* deck, and
    // R117.2 draws that many back. At least four rather than exactly four:
    // the last mulligan answered lets the turn proceed, and R316's Draw Phase
    // hands the first player a fifth before this is read.
    const p2 = seatOf(room.game!.state, "p2");
    expect(p2.hand.length).toBeGreaterThanOrEqual(4);
    expect(theirs.every((id) => !p2.hand.includes(id))).toBe(true);
    expect(p2.mainDeck.slice(-2)).toEqual(theirs);
    // p1 kept theirs, so nothing of p1's went to the bottom of p1's deck.
    const p1 = seatOf(room.game!.state, "p1");
    expect(p1.hand.length).toBeGreaterThanOrEqual(4);
  });

  it("refuses anything but a mulligan answer from a seat still owing one", () => {
    const room = table(3);

    expect(act(room, "p3", { type: "endTurn", playerId: "p3" })).toEqual({
      ok: false,
      reason: "decisionPending",
    });
  });

  it("clears held answers when the room deals again", () => {
    let room = table(3);
    room = answer(room, "p3");

    expect(restart(room, 42).earlyMulligans).toEqual({});
  });
});

/**
 * The precondition for persistence.
 *
 * Rooms live in a `Map` in one server process today, and that is the whole
 * reason `fly.toml` pins the app to a single machine that is never allowed to
 * stop: a second machine would be a second set of rooms, and stopping the one
 * machine would discard every game in progress. Moving rooms into storage
 * removes both constraints — but only if a room is *data*, all the way down.
 *
 * `Room` was written to be, and nothing in it is a socket: a seat is a player,
 * a deck index, a token and possibly the moment it went away. This is the test
 * that keeps it that way, because the failure is silent. A `Map`, a `Set`, a
 * `Date` or an `undefined` inside the game state all survive being put in a
 * `Map` and none of them survive `JSON.stringify` — the room would store
 * cleanly, read back subtly wrong, and diverge mid-game rather than at save.
 *
 * Structural equality is the cheap half. The half that matters is that a room
 * read back from storage still *plays* the same, so both are checked.
 */
describe("a room is data, so it can be stored", () => {
  /** What a store would write and read back. */
  const throughStorage = (room: Room): Room =>
    JSON.parse(JSON.stringify(room)) as Room;

  it("survives a JSON round trip unchanged, mid-game", () => {
    const room = seeded();

    expect(throughStorage(room)).toEqual(room);
  });

  it("survives it while a seat is away and still holding its chair", () => {
    const room = leave(seeded(), "p2", 1_000);

    const back = throughStorage(room);
    expect(back).toEqual(room);
    // The grace period is a timestamp; a `Date` here would come back a string.
    expect(awaySeats(back)).toEqual(["p2"]);
    expect(seatFor(back, "tok-p2")).toBe("p2");
  });

  /**
   * `earlyMulligans` is empty in most fixtures, because a room that has
   * finished its mulligans has nothing held. A store that forgot the column
   * would therefore pass every other test here and lose a real answer only
   * when three people sat down and one of them was quick — which is precisely
   * the bug persistence introduces and the hardest kind to see. So the round
   * trip is checked in the one state where the field carries something.
   */
  it("keeps an answer held from a seat whose turn has not come", () => {
    let room = emptyRoom("abc", 3);
    seatsOf(room).forEach((seat, at) => {
      room = join(room, seat, at % 5, 1, `tok-${seat}`);
    });
    // p1 is the one being asked, so p3's answer is early by two and is held.
    const early = act(room, "p3", { type: "decide", playerId: "p3", targets: [] });
    if (!early.ok) throw new Error(`refused: ${early.reason}`);
    expect(early.room.earlyMulligans.p3).toEqual([]);

    const back = throughStorage(early.room);

    expect(back.earlyMulligans).toEqual(early.room.earlyMulligans);
    expect(Object.keys(back.earlyMulligans)).toEqual(["p3"]);
    // And it is still spent in R117's order rather than dropped or replayed.
    expect(back.game?.state.pending?.player).toBe("p1");
  });

  it("offers the same moves after the round trip as before it", () => {
    const room = seeded();
    const state = room.game?.state;
    if (state === undefined) throw new Error("fixture is not dealt");

    const back = throughStorage(room).game?.state;
    if (back === undefined) throw new Error("game did not survive storage");

    for (const seat of seatsOf(room)) {
      expect(legalActions(back, seat)).toEqual(legalActions(state, seat));
    }
  });

  /**
   * The one that would actually catch a lossy round trip. Two rooms, one
   * stored and one not, played the same way: if anything came back wrong the
   * boards diverge, and a board is a much finer sieve than a move list.
   */
  it("plays identically to the room it was stored from", () => {
    let live = seeded();
    let restored = throughStorage(live);

    for (let move = 0; move < 12; move++) {
      const seat = seatsOf(live).find(
        (s) => live.game !== undefined && legalActions(live.game.state, s).length > 0,
      );
      if (seat === undefined) break;

      const next = legalActions((live.game as { state: GameState }).state, seat)[0];
      if (next === undefined) break;
      const onLive = act(live, seat, next);
      const onRestored = act(restored, seat, next);

      expect(onRestored.ok).toBe(onLive.ok);
      if (!onLive.ok || !onRestored.ok) break;

      live = onLive.room;
      // Stored again each move, the way a store would after every action.
      restored = throughStorage(onRestored.room);
      expect(restored).toEqual(live);
    }

    // A fixture that never moved would pass every assertion above vacuously.
    expect(live.game?.events.length ?? 0).toBeGreaterThan(0);
  });
});
