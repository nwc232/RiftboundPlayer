import { applyAction } from "../actions.js";
import { concede } from "../concede.js";
import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import { newGame } from "../ui/game.js";
import type { GameState, PlayerId } from "../state.js";
import { eventsFor, viewOf } from "../view.js";
import { modeFor, seatsFor } from "../modes-of-play.js";
import type { RoomId, ServerMessage } from "./protocol.js";

/**
 * A room: one authoritative game and the seats watching it.
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
  /**
   * R483.1 — how many people this room is for, fixed by whoever opened it.
   * The mode follows from the count: R485 seats two, R487 three, R488 four.
   */
  players: number;
  /** Filled in join order: the first to arrive is p1. */
  seats: Partial<Record<PlayerId, Seat>>;
  /** Absent until every seat is filled and the game has been dealt. */
  game: { state: GameState; events: GameEvent[] } | undefined;
}

export function emptyRoom(id: RoomId, players = 2): Room {
  // An unsanctioned player count has no mode, so it cannot be played at all.
  modeFor(players);
  return { id, players, seats: {}, game: undefined };
}

/** Every seat this room's mode uses, in turn order. */
export function seatsOf(room: Room): PlayerId[] {
  return seatsFor(modeFor(room.players));
}

/**
 * The seat a joiner gets, or undefined when there is none to give.
 *
 * A seat vacated *during* a game is not one: R652 removes a player from the
 * game in progress, and there is no rule for putting one back. Letting a
 * newcomer take the chair would either re-deal over a game two other people
 * are in the middle of, or seat them with no cards.
 */
export function freeSeat(room: Room): PlayerId | undefined {
  if (room.game !== undefined) return undefined;
  return seatsOf(room).find((id) => room.seats[id] === undefined);
}

/** The decks at the table in turn order, or undefined while a seat is empty. */
function tableDecks(room: Room): number[] | undefined {
  const seats = seatsOf(room).map((id) => room.seats[id]);
  if (seats.some((seat) => seat === undefined)) return undefined;
  return seats.map((seat) => seat!.deck);
}

/**
 * Seats a player. The game is dealt the moment the last one arrives — there
 * is nothing to look at before that, and dealing earlier would mean choosing
 * a deck for someone who has not said which they want.
 */
export function join(
  room: Room,
  seat: PlayerId,
  deck: number,
  seed: number,
): Room {
  const filled: Room = {
    ...room,
    seats: { ...room.seats, [seat]: { player: seat, deck } },
  };
  // A game already dealt is never re-dealt by an arrival. `freeSeat` should
  // have refused the joiner already; this is the same rule said where it
  // would do the damage.
  if (room.game !== undefined) return filled;

  const decks = tableDecks(filled);
  return {
    ...filled,
    game:
      decks === undefined
        ? undefined
        : { state: newGame(seed, decks), events: [] },
  };
}

/**
 * Someone disconnects.
 *
 * The rules have no word for a dropped socket, so this treats it as R650's
 * concession, which is the closest thing they describe: with two seats R651.1
 * hands the game to whoever is left, and with three R652 takes the leaver off
 * the board and the other two carry on. Anything else would end a Skirmish
 * for two people because a third lost their wifi.
 *
 * Before the deal there is no game to concede from, so the seat simply opens
 * up again — which is also the only case where someone can come back.
 */
export function leave(room: Room, seat: PlayerId): Room {
  const { [seat]: _gone, ...seats } = room.seats;
  if (room.game === undefined) return { ...room, seats, game: undefined };

  const left = concede(room.game.state, seat);
  return {
    ...room,
    seats,
    game: {
      state: left.state,
      events: [...room.game.events, ...left.events],
    },
  };
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

/** Deals again, keeping every seat and their decks. */
export function restart(room: Room, seed: number): Room {
  const decks = tableDecks(room);
  if (decks === undefined) return room;
  return { ...room, game: { state: newGame(seed, decks), events: [] } };
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
    const taken = seatsOf(room).filter(
      (id) => room.seats[id] !== undefined,
    ).length;
    return {
      kind: "waiting",
      room: room.id,
      seat,
      seated: taken,
      players: room.players,
    };
  }
  return {
    kind: "state",
    seat,
    state: viewOf(room.game.state, seat),
    events: eventsFor(room.game.events, seat),
  };
}
