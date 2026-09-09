import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join as joinPath, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { parseClientMessage } from "./protocol.js";
import type { ClientMessage, RoomId, ServerMessage } from "./protocol.js";
import {
  act,
  emptyRoom,
  freeSeat,
  join,
  leave,
  messageFor,
  restart,
  seatsOf,
  expireAway,
  rejoin,
  seatFor,
} from "./room.js";
import type { Room } from "./room.js";
import { inOrder, memoryStore } from "./store.js";
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

/**
 * How often to ping an idle socket, and how long a socket may go without
 * answering before it is presumed gone.
 *
 * Not a nicety. Proxies in front of a deployed app close connections that go
 * quiet — commonly after about a minute — and a card game is quiet for a
 * minute all the time, because that is what thinking looks like. Without this
 * a game dies mid-turn and neither player is told why.
 */
const PING_EVERY = 30_000;

/**
 * Where the rooms are.
 *
 * Still a `Map` in this process, but behind `RoomStore` — so moving them
 * somewhere both machines can reach becomes a deployment choice rather than a
 * rewrite of this file. See `store.ts` for why that matters.
 */
const store = memoryStore();
/**
 * Reading a room now takes an `await`, and an `await` is a place another
 * message can run. Everything that touches a room goes through here so it
 * runs to completion first; `store.ts` sets out the lost update this
 * prevents, and `tests/store.test.ts` reproduces it.
 */
const onlyOneAtATime = inOrder();
/**
 * Sockets that have sent a join and are not seated yet. `sitting` is written
 * by the queued work rather than on arrival, so without this a client sending
 * two joins in one tick would pass the already-seated check twice.
 */
const claiming = new WeakSet<WebSocket>();
/** Which room and seat a socket is sitting in. */
const sitting = new Map<WebSocket, { room: RoomId; seat: PlayerId }>();
/** Sockets that have answered a ping since the last sweep. */
const alive = new WeakSet<WebSocket>();

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

/**
 * Everything one message does to one room.
 *
 * Split out of the socket handler because it is now asynchronous and has to
 * be queued: the caller decides *which* room this is about, so the work can
 * wait behind whatever else is happening to that room.
 */
async function handle(
  socket: WebSocket,
  id: RoomId,
  message: ClientMessage,
): Promise<void> {
  if (message.kind === "join") {
    try {
      await seat(socket, id, message);
    } finally {
      claiming.delete(socket);
    }
    return;
  }

  const seated = sitting.get(socket);
  if (seated === undefined) {
    tell(socket, { kind: "rejected", reason: "notSeated" });
    return;
  }
  const room = await store.load(seated.room);
  if (room === undefined) {
    tell(socket, { kind: "gone", reason: "roomGone" });
    return;
  }

  if (message.kind === "restart") {
    const again = restart(room, Date.now() % 100000);
    await store.save(again);
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
  await store.save(outcome.room);
  broadcast(outcome.room);
}

/** Puts a joiner in a chair, opening the room if they are the first. */
async function seat(
  socket: WebSocket,
  id: RoomId,
  message: ClientMessage & { kind: "join" },
): Promise<void> {
  if (sitting.has(socket)) {
    tell(socket, { kind: "rejected", reason: "alreadySeated" });
    return;
  }
  // R483.1 — the room's size is whatever the person who opened it asked
  // for, and a later joiner cannot change it. An unsanctioned count has
  // no mode, so `emptyRoom` refuses it rather than seating anyone.
  let room = await store.load(id);
  if (room === undefined) {
    try {
      room = emptyRoom(id, message.players ?? 2);
    } catch {
      tell(socket, { kind: "rejected", reason: "noSuchMode" });
      return;
    }
  }
  // A token for a seat that is waiting for its player takes them back to
  // it — the same chair, the same cards, the same game. Anything else is
  // a new arrival and gets whatever seat is free.
  const returning =
    message.token === undefined ? undefined : seatFor(room, message.token);
  const chair = returning ?? freeSeat(room);
  if (chair === undefined) {
    tell(socket, { kind: "gone", reason: "roomFull" });
    return;
  }

  // A seed per room rather than per game, so both seats are dealt the same
  // shuffle — the engine takes deck order as given and does its own
  // shuffling at setup.
  const token = returning === undefined ? randomUUID() : message.token!;
  const filled =
    returning === undefined
      ? join(room, chair, message.deck, Date.now() % 100000, token)
      : rejoin(room, chair);
  await store.save(filled);
  sitting.set(socket, { room: id, seat: chair });

  tell(socket, { kind: "joined", room: id, seat: chair, token });
  broadcast(filled);
}

/** A socket has gone. Their seat is held rather than emptied. */
async function departed(id: RoomId, seat: PlayerId): Promise<void> {
  const room = await store.load(id);
  if (room === undefined) return;

  const left = leave(room, seat, Date.now());
  // An empty room is forgotten rather than kept: there are no accounts to
  // hold it for, and a room code is cheap to agree on again. Asked of every
  // seat the mode uses — checking p1 and p2 dropped a Skirmish the moment
  // those two left, with p3 still sitting in it.
  if (seatsOf(left).every((chair) => left.seats[chair] === undefined)) {
    await store.remove(id);
    return;
  }
  await store.save(left);
  for (const [other, sat] of sitting) {
    if (sat.room !== id) continue;
    // Their seat is being held, not emptied — `GRACE_MS` later it becomes
    // R650's concession. The state that follows carries `away`, so the
    // others can be told someone is reconnecting rather than gone.
    tell(other, { kind: "gone", reason: "playerAway", seat });
    tell(other, messageFor(left, sat.seat));
  }
}

/**
 * A held seat becomes R650's concession once the grace period is up. Run on
 * one timer rather than a timeout per seat: there is nothing to cancel when
 * somebody comes back, and a room nobody is watching cleans itself up.
 */
async function expireHeldSeats(now: number): Promise<void> {
  // A snapshot: a room may be gone by the time its turn in the queue comes
  // round, which is why the work below loads it again rather than using this.
  for (const stale of await store.all()) {
    await onlyOneAtATime(stale.id, async () => {
      const room = await store.load(stale.id);
      if (room === undefined) return;

      const { room: after, expired } = expireAway(room, now);
      if (expired.length === 0) return;
      if (seatsOf(after).every((chair) => after.seats[chair] === undefined)) {
        await store.remove(stale.id);
        return;
      }
      await store.save(after);
      for (const [socket, sat] of sitting) {
        if (sat.room !== stale.id) continue;
        for (const gone of expired) {
          tell(socket, { kind: "gone", reason: "playerLeft", seat: gone });
        }
        tell(socket, messageFor(after, sat.seat));
      }
    });
  }
}

sockets.on("connection", (socket) => {
  alive.add(socket);
  // Browsers answer a ping frame at the protocol level, so this needs nothing
  // from the client.
  socket.on("pong", () => alive.add(socket));

  socket.on("message", (raw) => {
    const message = parseClientMessage(String(raw));
    if (message === undefined) {
      tell(socket, { kind: "rejected", reason: "malformed" });
      return;
    }

    // Which room this is about has to be known here rather than inside the
    // work, because it is what the work queues behind: for a join it is the
    // message, for anything else it is wherever this socket is sitting.
    const id =
      message.kind === "join" ? message.room : sitting.get(socket)?.room;
    if (id === undefined) {
      tell(socket, { kind: "rejected", reason: "notSeated" });
      return;
    }
    if (message.kind === "join") {
      if (sitting.has(socket) || claiming.has(socket)) {
        tell(socket, { kind: "rejected", reason: "alreadySeated" });
        return;
      }
      claiming.add(socket);
    }

    void onlyOneAtATime(id, () => handle(socket, id, message));
  });

  socket.on("close", () => {
    const seated = sitting.get(socket);
    // Dropped from `sitting` now rather than when the queued work runs: this
    // socket must stop being broadcast to immediately, not when its turn
    // comes round.
    sitting.delete(socket);
    if (seated === undefined) return;
    void onlyOneAtATime(seated.room, () => departed(seated.room, seated.seat));
  });
});

/**
 * Keeps live sockets from being closed for being quiet, and notices the ones
 * that have gone without saying so — a laptop lid closing sends nothing, and
 * the seat would otherwise stay filled against a player who is never coming
 * back.
 */
const heartbeat = setInterval(() => {
  void expireHeldSeats(Date.now());

  for (const socket of sockets.clients) {
    if (!alive.has(socket)) {
      // `terminate` rather than `close`: it has already stopped answering, so
      // waiting for a closing handshake would just delay freeing the seat.
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, PING_EVERY);

sockets.on("close", () => clearInterval(heartbeat));

http.listen(PORT, () => {
  process.stdout.write(
    `riftbound server on http://localhost:${PORT}\n` +
      `  open it, pick a deck, share the room code\n`,
  );
});
