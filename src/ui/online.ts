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
  /** Null until the server has dealt — both seats have to arrive first. */
  state: GameState | null;
  events: GameEvent[];
  seat: PlayerId | null;
  room: string | null;
  status: "connecting" | "waiting" | "playing" | "closed";
  /** The engine's own refusal reason, when the server turned a move down. */
  rejected: string | null;
  send: (action: Action) => void;
  restart: () => void;
}

/** Where the socket lives. Same host as the page, so a link is a link. */
function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}`;
}

export function useOnline(room: string | null, deck: number): Online {
  const socket = useRef<WebSocket | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [status, setStatus] = useState<Online["status"]>("connecting");
  const [rejected, setRejected] = useState<string | null>(null);

  useEffect(() => {
    if (room === null) return;

    const live = new WebSocket(socketUrl());
    socket.current = live;
    setStatus("connecting");

    live.onopen = () => {
      const join: ClientMessage = { kind: "join", room, deck };
      live.send(JSON.stringify(join));
    };

    live.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      switch (message.kind) {
        case "joined":
          setSeat(message.seat);
          return;
        case "waiting":
          setSeat(message.seat);
          setStatus("waiting");
          return;
        case "state":
          setSeat(message.seat);
          setState(message.state);
          setEvents(message.events);
          setStatus("playing");
          setRejected(null);
          return;
        case "rejected":
          setRejected(message.reason);
          return;
        case "gone":
          setRejected(message.reason);
          if (message.reason !== "opponentLeft") setStatus("closed");
          return;
      }
    };

    live.onclose = () => setStatus("closed");

    return () => {
      live.onclose = null;
      live.close();
      socket.current = null;
    };
    // The deck is part of the join, so changing it reconnects and rejoins.
    // The picker is disabled once a game exists, so that only ever happens
    // while waiting for the other seat.
  }, [room, deck]);

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

  return { state, events, seat, room, status, rejected, send, restart };
}
