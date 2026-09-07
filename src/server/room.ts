import { applyAction } from "../actions.js";
import { concede } from "../concede.js";
import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import { newGame } from "../ui/game.js";
import type { CardId, GameState, PlayerId } from "../state.js";
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
  /**
   * What proves this is the same person coming back. There are no accounts,
   * so the seat is held against a secret the client keeps and nothing else
   * knows — without it, a vacated chair would be handed to whoever knocked.
   */
  token: string;
  /**
   * When their socket dropped, if it has. A seat that is away is still theirs:
   * `GRACE_MS` later it becomes R650's concession, and until then they can
   * come back to it.
   */
  away?: number;
}

/**
 * How long a dropped seat is held.
 *
 * **A deliberate deviation from R650–652.** The rules have no notion of a lost
 * connection: a player is in the game or has conceded. Treating a dropped
 * socket as an instant concession is the literal reading and is what this did
 * — but over a tunnel, on someone's home wifi, a two-second hiccup would end
 * their game with no way back. So the concession is delayed rather than
 * skipped: nothing about R652 changes, it just happens a minute later.
 */
export const GRACE_MS = 60_000;

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
  /**
   * R117 mulligans answered before their turn in the order came round.
   *
   * **A deliberate deviation, and only in the waiting.** R117 says "In turn
   * order, players perform their Mulligan", and the engine does exactly that:
   * one task per seat, answered one at a time. But nothing about one player's
   * mulligan is visible to another — each sets aside from their own hand,
   * draws from their own deck and recycles to their own deck — so the order is
   * unobservable, and making three people watch each other take it in turns
   * before the game starts buys nothing.
   *
   * So the answers are collected as they arrive and applied in R117's order
   * the moment each seat's task reaches the head. The engine is untouched and
   * the sequence in the log is the one the rules describe; what goes away is
   * the queueing.
   */
  earlyMulligans: Partial<Record<PlayerId, CardId[]>>;
}

export function emptyRoom(id: RoomId, players = 2): Room {
  // An unsanctioned player count has no mode, so it cannot be played at all.
  modeFor(players);
  return { id, players, seats: {}, game: undefined, earlyMulligans: {} };
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
  token: string,
): Room {
  const filled: Room = {
    ...room,
    seats: { ...room.seats, [seat]: { player: seat, deck, token } },
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
 * Someone's socket drops.
 *
 * Before the deal there is nothing to be removed from, so the seat simply
 * opens up again. Once a game exists the seat is held rather than emptied —
 * see `GRACE_MS` — and `expireAway` turns the wait into R650's concession if
 * they do not come back.
 */
export function leave(room: Room, seat: PlayerId, now: number): Room {
  const sitting = room.seats[seat];
  if (room.game === undefined || sitting === undefined) {
    const { [seat]: _gone, ...seats } = room.seats;
    return { ...room, seats, game: undefined };
  }

  return {
    ...room,
    seats: { ...room.seats, [seat]: { ...sitting, away: now } },
  };
}

/** The seats whose players have dropped and not yet come back. */
export function awaySeats(room: Room): PlayerId[] {
  return seatsOf(room).filter((id) => room.seats[id]?.away !== undefined);
}

/**
 * The seat this token belongs to, if it is one that is waiting for its player.
 * A token for a seat that is still connected is refused: a second tab would
 * otherwise take over a chair somebody is sitting in.
 */
export function seatFor(room: Room, token: string): PlayerId | undefined {
  return seatsOf(room).find((id) => {
    const seat = room.seats[id];
    return seat?.token === token && seat.away !== undefined;
  });
}

/** They came back inside the grace period, so the seat is simply theirs again. */
export function rejoin(room: Room, seat: PlayerId): Room {
  const sitting = room.seats[seat];
  if (sitting === undefined) return room;
  const { away: _back, ...rest } = sitting;
  return { ...room, seats: { ...room.seats, [seat]: rest } };
}

/**
 * Turns waiting into leaving. A seat away longer than `GRACE_MS` concedes —
 * R651.1 hands a Duel to whoever is left, R652 takes them off the board of a
 * Skirmish and the other two carry on.
 */
export function expireAway(
  room: Room,
  now: number,
  grace = GRACE_MS,
): { room: Room; expired: PlayerId[] } {
  const expired = awaySeats(room).filter(
    (id) => now - (room.seats[id]?.away ?? now) >= grace,
  );
  if (expired.length === 0) return { room, expired: [] };

  let current = room;
  for (const seat of expired) {
    const { [seat]: _gone, ...seats } = current.seats;
    if (current.game === undefined) {
      current = { ...current, seats };
      continue;
    }
    const left = concede(current.game.state, seat);
    current = {
      ...current,
      seats,
      game: {
        state: left.state,
        events: [...current.game.events, ...left.events],
      },
    };
  }
  return { room: current, expired };
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

  // R117 — a mulligan answered before its turn in the order is held rather
  // than refused. See `Room.earlyMulligans`: the engine still performs them in
  // turn order, and this only stops everyone watching each other do it.
  if (owesMulligan(room.game.state, seat) && !beingAsked(room.game.state, seat)) {
    if (action.type !== "decide") return { ok: false, reason: "decisionPending" };
    return {
      ok: true,
      room: {
        ...room,
        earlyMulligans: {
          ...room.earlyMulligans,
          [seat]: action.targets ?? [],
        },
      },
    };
  }

  const result = applyAction(room.game.state, action);
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    room: drainMulligans({
      ...room,
      game: {
        state: result.state,
        events: [...room.game.events, ...result.events],
      },
    }),
  };
}

/** R117 — this seat's mulligan is still on the queue, answered or not. */
export function owesMulligan(state: GameState, seat: PlayerId): boolean {
  return state.tasks.some(
    (task) => task.kind === "mulligan" && task.player === seat,
  );
}

/** …and the game is waiting on *them* for it right now. */
function beingAsked(state: GameState, seat: PlayerId): boolean {
  return (
    state.pending?.prompt.kind === "mulligan" && state.pending.player === seat
  );
}

/**
 * Plays out every held mulligan whose turn has now come, in R117's order.
 *
 * A loop rather than one step: with all four answers in, the first one applied
 * hands the prompt straight to the second, and the game should not wait for a
 * socket message to notice.
 */
function drainMulligans(room: Room): Room {
  let current = room;
  for (let guard = 0; guard < 8; guard += 1) {
    const state = current.game?.state;
    if (state === undefined) break;
    const asked = state.pending;
    if (asked?.prompt.kind !== "mulligan") break;
    const held = current.earlyMulligans[asked.player];
    if (held === undefined) break;

    const result = applyAction(state, {
      type: "decide",
      playerId: asked.player,
      targets: held,
    });
    const { [asked.player]: _used, ...rest } = current.earlyMulligans;
    // A held answer that is no longer legal — a card that is somehow not in
    // the hand any more — is dropped rather than retried, and that seat is
    // asked again the ordinary way.
    current = {
      ...current,
      earlyMulligans: rest,
      ...(result.ok
        ? {
            game: {
              state: result.state,
              events: [...current.game!.events, ...result.events],
            },
          }
        : {}),
    };
  }
  return current;
}

/** Deals again, keeping every seat and their decks. */
export function restart(room: Room, seed: number): Room {
  if (awaySeats(room).length > 0) return room;
  const decks = tableDecks(room);
  if (decks === undefined) return room;
  return {
    ...room,
    earlyMulligans: {},
    game: { state: newGame(seed, decks), events: [] },
  };
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
    // Whose socket has dropped, so the others are told why nothing is
    // happening rather than being left to guess.
    away: awaySeats(room),
  };
}
