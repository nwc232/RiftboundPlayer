import { useCallback, useEffect, useRef, useState } from "react";
import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import type { GameState, PlayerId } from "../state.js";
import type { ClientMessage, ServerMessage } from "../server/protocol.js";

/**
 * The other end of the socket.
 *
 * Deliberately dumb. It holds no game and decides nothing: the server owns the
 * `GameState` and sends this client the one it is entitled to see, so there is
 * no local copy to drift and nothing to reconcile. What arrives is already
 * filtered by `viewOf` and `eventsFor`, which is why the hotseat screen and
 * this one can render from the same components without knowing which they are.
 */

export interface Online {
  /** Null until the server has dealt — every seat has to arrive first. */
  state: GameState | null;
  events: GameEvent[];
  seat: PlayerId | null;
  room: string | null;
  status: "connecting" | "waiting" | "playing" | "closed";
  /** The engine's own refusal reason, when the server turned a move down. */
  rejected: string | null;
  send: (action: Action) => void;
  restart: () => void;
  /** How many have arrived, of how many the room is for, while waiting. */
  seated: { seated: number; of: number } | null;
  /** Seats whose player has dropped and is inside the grace period. */
  away: PlayerId[];
}

/**
 * Where a seat's claim on itself lives. `sessionStorage` rather than
 * `localStorage`: it survives a reload and a dropped socket, which is the
 * whole point, but not a closed tab — a chair should not be held by a browser
 * nobody is looking at.
 */
function tokenKey(room: string): string {
  return `riftbound:seat:${room}`;
}

function rememberedToken(room: string): string | undefined {
  try {
    return window.sessionStorage.getItem(tokenKey(room)) ?? undefined;
  } catch {
    // Private windows and blocked storage throw rather than return null.
    return undefined;
  }
}

function rememberToken(room: string, token: string): void {
  try {
    window.sessionStorage.setItem(tokenKey(room), token);
  } catch {
    // Not being able to remember costs a reconnection, not a game.
  }
}

/** Where the socket lives. Same host as the page, so a link is a link. */
function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}`;
}

/**
 * `players` is R483.1's seat count, and the server honours it only from
 * whoever opens the room — a joiner's is ignored, which is why a stale value
 * here cannot resize a game somebody is already in.
 */
export function useOnline(
  room: string | null,
  deck: number,
  players = 2,
): Online {
  const socket = useRef<WebSocket | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [status, setStatus] = useState<Online["status"]>("connecting");
  const [rejected, setRejected] = useState<string | null>(null);
  /** How full the room is, for the lobby to say so. */
  const [seated, setSeated] = useState<{ seated: number; of: number } | null>(
    null,
  );
  const [away, setAway] = useState<PlayerId[]>([]);
  /** Bumped to reconnect after a drop, which re-runs the effect below. */
  const [attempt, setAttempt] = useState(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (room === null) return;

    const live = new WebSocket(socketUrl());
    socket.current = live;
    setStatus("connecting");

    live.onopen = () => {
      const join: ClientMessage = {
        kind: "join",
        room,
        deck,
        players,
        // Present the seat's own claim, if this browser has one. The server
        // honours it only for a seat that is waiting for its player.
        ...(rememberedToken(room) === undefined
          ? {}
          : { token: rememberedToken(room)! }),
      };
      live.send(JSON.stringify(join));
    };

    live.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      switch (message.kind) {
        case "joined":
          setSeat(message.seat);
          rememberToken(room, message.token);
          setRejected(null);
          return;
        case "waiting":
          setSeat(message.seat);
          setSeated({ seated: message.seated, of: message.players });
          setStatus("waiting");
          return;
        case "state":
          setSeat(message.seat);
          setState(message.state);
          setEvents(message.events);
          setAway(message.away);
          setStatus("playing");
          setRejected(null);
          return;
        case "rejected":
          setRejected(message.reason);
          return;
        case "gone":
          // A `seat` means somebody *else* left. R651.2 has the game carry on
          // when two players remain, so this connection is fine and the state
          // that follows says what happened to the game.
          setRejected(
            message.seat === undefined
              ? message.reason
              : `${message.seat} left the game`,
          );
          if (message.seat === undefined) setStatus("closed");
          return;
      }
    };

    live.onclose = () => {
      setStatus("closed");
      // The server holds the seat for a minute; keep trying to take it back
      // for as long as that lasts, so a brief hiccup costs nothing.
      retry.current = setTimeout(() => setAttempt((n) => n + 1), 1500);
    };

    return () => {
      live.onclose = null;
      live.close();
      socket.current = null;
      if (retry.current !== null) clearTimeout(retry.current);
    };
    // The deck is part of the join, so changing it reconnects and rejoins.
    // The picker is disabled once a game exists, so that only ever happens
    // while waiting for the other seat.
  }, [room, deck, players, attempt]);

  const send = useCallback((action: Action) => {
    const live = socket.current;
    if (live === null || live.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { kind: "act", action };
    live.send(JSON.stringify(message));
  }, []);

  const restart = useCallback(() => {
    const live = socket.current;
    if (live === null || live.readyState !== WebSocket.OPEN) return;
    const message: ClientMessage = { kind: "restart" };
    live.send(JSON.stringify(message));
  }, []);

  return { state, events, seat, room, status, rejected, send, restart, seated, away };
}
