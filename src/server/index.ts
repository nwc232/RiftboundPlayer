import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join as joinPath, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { parseClientMessage } from "./protocol.js";
import type { RoomId, ServerMessage } from "./protocol.js";
import {
  act,
  emptyRoom,
  freeSeat,
  join,
  leave,
  messageFor,
  restart,
} from "./room.js";
import type { Room } from "./room.js";
import type { PlayerId } from "../state.js";

/**
 * The one Node file in the project outside `src/demo/`.
 *
 * It is deliberately thin. The engine decides legality, `room.ts` decides who
 * may act and what each seat may see, and both are pure and tested without a
 * socket. What is left here is genuinely only plumbing: sockets in, messages
 * out, and static files so a friend has one link to open.
 */

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = resolve("dist");

const rooms = new Map<RoomId, Room>();
/** Which room and seat a socket is sitting in. */
const sitting = new Map<WebSocket, { room: RoomId; seat: PlayerId }>();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Serves the built front-end. Anything that is not a file falls through to
 * `index.html`, so a room link is just a URL rather than a route to register.
 */
const http = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  // `normalize` plus the prefix check is what keeps `..` inside `dist`.
  const wanted = normalize(joinPath(ROOT, decodeURIComponent(url.pathname)));
  const path = wanted.startsWith(ROOT) ? wanted : ROOT;

  const send = async (file: string): Promise<void> => {
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  };

  void (extname(path) === ""
    ? send(joinPath(ROOT, "index.html"))
    : send(path));
});

const sockets = new WebSocketServer({ server: http });

function tell(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/** Sends every seat in a room its own view. */
function broadcast(room: Room): void {
  for (const [socket, seated] of sitting) {
    if (seated.room !== room.id) continue;
    tell(socket, messageFor(room, seated.seat));
  }
}

sockets.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const message = parseClientMessage(String(raw));
    if (message === undefined) {
      tell(socket, { kind: "rejected", reason: "malformed" });
      return;
    }

    if (message.kind === "join") {
      if (sitting.has(socket)) {
        tell(socket, { kind: "rejected", reason: "alreadySeated" });
        return;
      }
      const room = rooms.get(message.room) ?? emptyRoom(message.room);
      const seat = freeSeat(room);
      if (seat === undefined) {
        tell(socket, { kind: "gone", reason: "roomFull" });
        return;
      }

      // A seed per room rather than per game, so both seats are dealt the same
      // shuffle — the engine takes deck order as given and does its own
      // shuffling at setup.
      const filled = join(room, seat, message.deck, Date.now() % 100000);
      rooms.set(room.id, filled);
      sitting.set(socket, { room: room.id, seat });

      tell(socket, { kind: "joined", room: room.id, seat });
      broadcast(filled);
      return;
    }

    const seated = sitting.get(socket);
    if (seated === undefined) {
      tell(socket, { kind: "rejected", reason: "notSeated" });
      return;
    }
    const room = rooms.get(seated.room);
    if (room === undefined) {
      tell(socket, { kind: "gone", reason: "roomGone" });
      return;
    }

    if (message.kind === "restart") {
      const again = restart(room, Date.now() % 100000);
      rooms.set(room.id, again);
      broadcast(again);
      return;
    }

    const outcome = act(room, seated.seat, message.action);
    if (!outcome.ok) {
      // The engine's own refusal reason, handed straight back — the client
      // shows it the same way the single-screen UI shows a rejection.
      tell(socket, { kind: "rejected", reason: outcome.reason });
      return;
    }
    rooms.set(room.id, outcome.room);
    broadcast(outcome.room);
  });

  socket.on("close", () => {
    const seated = sitting.get(socket);
    sitting.delete(socket);
    if (seated === undefined) return;

    const room = rooms.get(seated.room);
    if (room === undefined) return;

    const left = leave(room, seated.seat);
    // An empty room is forgotten rather than kept: there are no accounts to
    // hold it for, and a room code is cheap to agree on again.
    if (left.seats.p1 === undefined && left.seats.p2 === undefined) {
      rooms.delete(room.id);
      return;
    }
    rooms.set(room.id, left);
    for (const [other, seat] of sitting) {
      if (seat.room !== room.id) continue;
      tell(other, { kind: "gone", reason: "opponentLeft" });
      tell(other, messageFor(left, seat.seat));
    }
  });
});

http.listen(PORT, () => {
  process.stdout.write(
    `riftbound server on http://localhost:${PORT}\n` +
      `  open it, pick a deck, share the room code\n`,
  );
});
