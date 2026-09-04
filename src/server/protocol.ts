import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import type { GameState, PlayerId } from "../state.js";

/**
 * What the two ends say to each other.
 *
 * Node-free on purpose, like the engine core: the browser imports this file
 * too, and the whole point of the split is that both ends agree about the
 * shape of a message by sharing the type rather than by both being careful.
 *
 * The client sends `Action`s — the same `Action` the engine already takes, so
 * there is no second vocabulary to keep in step. The server answers with a
 * `GameState`, which is the same `GameState`, filtered. That is what makes the
 * server thin: it owns the game, and it owns nothing else.
 */

/** How a room is named to a person. A code, no accounts. */
export type RoomId = string;

export type ClientMessage =
  | {
      kind: "join";
      room: RoomId;
      /** Which authored list this seat brings, by index into `DECKS`. */
      deck: number;
      /**
       * R483.1 — how many people the room is for, honoured only from whoever
       * opens it. A joiner cannot resize a room that already exists, and
       * omitting it means a Duel.
       */
      players?: number;
    }
  /**
   * R355 and everything else: the server runs this through `applyAction`
   * against the *truth*, so a client cannot play a card it was never sent.
   */
  | { kind: "act"; action: Action }
  /** Start over with the same seats, when both are still connected. */
  | { kind: "restart" };

export type ServerMessage =
  | { kind: "joined"; room: RoomId; seat: PlayerId }
  /** Seats are still empty, so there is no game to send. */
  | {
      kind: "waiting";
      room: RoomId;
      seat: PlayerId;
      /** How many have arrived, of how many the room is for. */
      seated: number;
      players: number;
    }
  /**
   * The game as this seat is entitled to see it — R107 applied at the socket
   * rather than at the renderer. A client that never receives a card's
   * identity cannot leak it, however the client is written.
   */
  | {
      kind: "state";
      seat: PlayerId;
      state: GameState;
      /** The whole log so far, filtered the same way. */
      events: GameEvent[];
    }
  | { kind: "rejected"; reason: string }
  /**
   * Something ended for this client. `seat` distinguishes the two cases that
   * matter: with it, *another* player left and — in a Skirmish or a War — the
   * game carries on, so this is news rather than a disconnection. Without it,
   * this connection is finished.
   */
  | { kind: "gone"; reason: string; seat?: PlayerId };

/** Parses a message without trusting it. Anything malformed is simply not one. */
export function parseClientMessage(text: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;

  const message = value as Partial<ClientMessage>;
  switch (message.kind) {
    case "join":
      {
        const players = (message as { players?: unknown }).players;
        const sane =
          players === undefined ||
          (typeof players === "number" && Number.isInteger(players));
        return typeof (message as { room?: unknown }).room === "string" &&
          typeof (message as { deck?: unknown }).deck === "number" &&
          sane
          ? (message as ClientMessage)
          : undefined;
      }
    case "act":
      return typeof (message as { action?: unknown }).action === "object" &&
        (message as { action?: unknown }).action !== null
        ? (message as ClientMessage)
        : undefined;
    case "restart":
      return { kind: "restart" };
    default:
      return undefined;
  }
}
