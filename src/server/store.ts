import type { Room } from "./room.js";
import type { RoomId } from "./protocol.js";

/**
 * Where rooms live.
 *
 * They live in a `Map` in one process today, and that single fact is what
 * pins the deployment to one machine that is never allowed to stop: a second
 * machine would be a second set of rooms, and stopping the one machine would
 * discard every game in progress. Naming the storage is what lets that change
 * without the server knowing where its rooms went.
 *
 * Node-free, like the rest of this directory. `memoryStore` is the whole
 * implementation the tests and local development need; a durable one is a
 * different file implementing the same four methods.
 *
 * **Asynchronous even though the memory store answers instantly.** A store
 * across a network cannot be anything else, and an interface that is
 * synchronous now is one that has to be rewritten — along with every caller —
 * the first time the rooms are somewhere else. The cost is paid here instead,
 * where it is four `async` keywords and a queue.
 */
export interface RoomStore {
  load(id: RoomId): Promise<Room | undefined>;
  save(room: Room): Promise<void>;
  remove(id: RoomId): Promise<void>;
  /** Every room, for the sweep that expires seats nobody is watching. */
  all(): Promise<Room[]>;
}

/** Rooms in memory: what the server did before there was an interface. */
export function memoryStore(): RoomStore {
  const rooms = new Map<RoomId, Room>();
  return {
    async load(id) {
      return rooms.get(id);
    },
    async save(room) {
      rooms.set(room.id, room);
    },
    async remove(id) {
      rooms.delete(id);
    },
    async all() {
      return [...rooms.values()];
    },
  };
}

/**
 * A gate that runs work for one key at a time, in arrival order.
 *
 * This is the bug that persistence introduces, and it is worth being precise
 * about it. Handling a message used to be synchronous from end to end: read
 * the room out of a `Map`, apply the action, put it back. Node ran each
 * message to completion before starting the next, so two players acting at
 * the same instant could not interleave.
 *
 * Reading a room from storage takes an `await`, and an `await` is a place
 * another message can run. Two actions arriving together would then both read
 * the room *before* it was played, both apply their move to that same board,
 * and both save — and whichever saved second would erase the other. Not a
 * crash and not an error: one player's move simply never happened, on a board
 * that stays perfectly legal. It would be blamed on the network for months.
 *
 * So work on a room is queued behind whatever is already running for that
 * room. Per room rather than one queue for the server, because two rooms have
 * nothing to say to each other and a slow store in one game should not stall
 * another.
 */
export function inOrder(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  /** The tail of each key's queue: what a newcomer has to wait behind. */
  const waiting = new Map<string, Promise<unknown>>();

  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const before = waiting.get(key) ?? Promise.resolve();
    // `then(work, work)` rather than `then(work)`: a failure ahead in the
    // queue is that caller's to handle, and must not cancel the work behind
    // it. A rejected action would otherwise wedge the room for good.
    const mine = before.then(work, work);
    // The queue holds a settled-either-way promise so one thrown error does
    // not leave an unhandled rejection behind, and does not reject the next.
    const settled = mine.then(
      () => undefined,
      () => undefined,
    );
    waiting.set(key, settled);
    // Forget the key once its queue has drained, so a server that has seen a
    // lot of rooms is not still holding a promise for every one of them.
    void settled.then(() => {
      if (waiting.get(key) === settled) waiting.delete(key);
    });
    return mine;
  };
}
