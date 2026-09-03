import { applyAction } from "../actions.js";
import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import { newGame } from "../ui/game.js";
import type { GameState, PlayerId } from "../state.js";
import { eventsFor, viewOf } from "../view.js";
import type { RoomId, ServerMessage } from "./protocol.js";

/**
 * A room: one authoritative game and the two seats watching it.
 *
 * Node-free and pure, so it is testable without a socket — which matters,
 * because the interesting rules here are not about networking. Who may act,
 * what each seat is allowed to see, and what happens when someone sends an
 * illegal move are all decided in this file, and none of them need a server
 * running to check.
 */

export interface Seat {
  player: PlayerId;
  /** Which authored list they brought, by index into `DECKS`. */
  deck: number;
}

export interface Room {
  id: RoomId;
  /** Filled in join order: the first to arrive is p1. */
  seats: Partial<Record<PlayerId, Seat>>;
  /** Absent until both seats are filled and the game has been dealt. */
  game: { state: GameState; events: GameEvent[] } | undefined;
}

export function emptyRoom(id: RoomId): Room {
  return { id, seats: {}, game: undefined };
}

/** The seat a joiner gets, or undefined when the room is full. */
export function freeSeat(room: Room): PlayerId | undefined {
  if (room.seats.p1 === undefined) return "p1";
  if (room.seats.p2 === undefined) return "p2";
  return undefined;
}

/**
 * Seats a player. The game is dealt the moment the second one arrives —
 * there is nothing to look at before that, and dealing earlier would mean
 * choosing a deck for someone who has not said which they want.
 */
export function join(
  room: Room,
  seat: PlayerId,
  deck: number,
  seed: number,
): Room {
  const seats = { ...room.seats, [seat]: { player: seat, deck } };
  const both = seats.p1 !== undefined && seats.p2 !== undefined;

  return {
    ...room,
    seats,
    game: both
      ? { state: newGame(seed, seats.p1!.deck, seats.p2!.deck), events: [] }
      : undefined,
  };
}

export function leave(room: Room, seat: PlayerId): Room {
  const { [seat]: _gone, ...seats } = room.seats;
  // The game goes with them. Resuming would mean holding a seat for someone
  // who may never come back, and there is nothing here to hold it against —
  // no accounts, no persistence, just a room code.
  return { ...room, seats, game: undefined };
}

export type ActOutcome =
  | { ok: true; room: Room }
  | { ok: false; reason: string };

/**
 * Applies one seat's action to the authoritative game.
 *
 * Two checks, and the second is the one that matters. A seat may only submit
 * actions *as itself* — otherwise a client could play out of its opponent's
 * hand simply by naming them, and R107's whole point is that it never had
 * their hand to play from. `applyAction` then decides legality, exactly as it
 * does everywhere else: `legalActions` is the only authority and the server
 * does not get a second opinion.
 */
export function act(room: Room, seat: PlayerId, action: Action): ActOutcome {
  if (room.game === undefined) return { ok: false, reason: "noGame" };
  if (action.playerId !== seat) return { ok: false, reason: "notYourSeat" };

  const result = applyAction(room.game.state, action);
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    room: {
      ...room,
      game: {
        state: result.state,
        events: [...room.game.events, ...result.events],
      },
    },
  };
}

/** Deals again, keeping both seats and their decks. */
export function restart(room: Room, seed: number): Room {
  const { p1, p2 } = room.seats;
  if (p1 === undefined || p2 === undefined) return room;
  return { ...room, game: { state: newGame(seed, p1.deck, p2.deck), events: [] } };
}

/**
 * What to send one seat right now — R107 applied at the socket.
 *
 * `viewOf` and `eventsFor` are the same two functions the single-screen UI
 * uses for its seat selector. The difference is that here the filtering is not
 * a courtesy: the unfiltered state never leaves this process, so a client
 * cannot show what it was not sent even if it tries.
 */
export function messageFor(room: Room, seat: PlayerId): ServerMessage {
  if (room.game === undefined) {
    return { kind: "waiting", room: room.id, seat };
  }
  return {
    kind: "state",
    seat,
    state: viewOf(room.game.state, seat),
    events: eventsFor(room.game.events, seat),
  };
}
