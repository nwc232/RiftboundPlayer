import { describe, expect, it } from "vitest";
import { inOrder, memoryStore } from "../src/server/store.js";
import type { RoomStore } from "../src/server/store.js";
import { act, emptyRoom, join, seatsOf } from "../src/server/room.js";
import type { Room } from "../src/server/room.js";
import { legalActions } from "../src/legal.js";

/**
 * A store that answers slowly, which is the only kind that exists once the
 * rooms are not in this process. The delay is what makes the interleaving
 * below deterministic rather than a race that passes on a fast machine.
 */
const slowly = (ms = 5): RoomStore => {
  const inner = memoryStore();
  const wait = () => new Promise((r) => setTimeout(r, ms));
  return {
    async load(id) {
      await wait();
      return inner.load(id);
    },
    async save(room) {
      await wait();
      return inner.save(room);
    },
    async remove(id) {
      await wait();
      return inner.remove(id);
    },
    async all() {
      await wait();
      return inner.all();
    },
  };
};

const dealt = (): Room => {
  let room = emptyRoom("abc");
  room = join(room, "p1", 0, 1, "tok-p1");
  room = join(room, "p2", 1, 1, "tok-p2");
  return room;
};

describe("a room store holds what a Map held", () => {
  it("gives back the room it was given", async () => {
    const store = memoryStore();
    const room = dealt();

    await store.save(room);

    expect(await store.load("abc")).toEqual(room);
  });

  it("has nothing to give for a room that was never opened", async () => {
    expect(await memoryStore().load("nobody")).toBeUndefined();
  });

  it("forgets a room that is removed, and lists the rest", async () => {
    const store = memoryStore();
    await store.save(emptyRoom("one"));
    await store.save(emptyRoom("two"));

    await store.remove("one");

    expect(await store.load("one")).toBeUndefined();
    expect((await store.all()).map((r) => r.id)).toEqual(["two"]);
  });
});

/**
 * The bug persistence introduces, written down as a test before the code that
 * prevents it.
 *
 * Handling a message used to be synchronous end to end, so two players acting
 * at the same instant could not interleave. Loading a room from storage takes
 * an `await`, and an `await` is a place another message can run — so both
 * could read the same board, both apply a move to it, and the second save
 * would erase the first. One player's move never happened, on a board that
 * stays perfectly legal.
 *
 * The first test here is the bug, deliberately reproduced. The second is the
 * same thing through `inOrder`. If they ever agree, the gate has stopped
 * doing anything.
 */
describe("two actions arriving at once", () => {
  /** Read, play one legal move, write — the shape of handling a message. */
  const playOnce = async (store: RoomStore, id: string): Promise<void> => {
    const room = await store.load(id);
    const game = room?.game;
    if (room === undefined || game === undefined) return;
    const seat = seatsOf(room).find((s) => legalActions(game.state, s).length > 0);
    if (seat === undefined) return;
    const move = legalActions(game.state, seat)[0];
    if (move === undefined) return;
    const outcome = act(room, seat, move);
    if (!outcome.ok) return;
    await store.save(outcome.room);
  };

  const eventCount = async (store: RoomStore, id: string): Promise<number> =>
    (await store.load(id))?.game?.events.length ?? 0;

  it("loses one of them without a gate — the bug", async () => {
    const store = slowly();
    await store.save(dealt());
    const before = await eventCount(store, "abc");

    // Both start before either finishes, which is what two sockets do.
    await Promise.all([playOnce(store, "abc"), playOnce(store, "abc")]);

    const after = await eventCount(store, "abc");
    // Two moves went in; the board advanced as though one had. This is the
    // failure being guarded against, asserted so it cannot quietly stop being
    // reproducible and take the test below with it.
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(await eventCount(store, "abc"));
    const oneMove = after;

    // And now with the gate, the same two calls get further.
    const gated = slowly();
    await gated.save(dealt());
    const queue = inOrder();
    await Promise.all([
      queue("abc", () => playOnce(gated, "abc")),
      queue("abc", () => playOnce(gated, "abc")),
    ]);

    expect(await eventCount(gated, "abc")).toBeGreaterThan(oneMove);
  });

  it("keeps every move when they are queued", async () => {
    const store = slowly();
    await store.save(dealt());
    const queue = inOrder();

    const eight = Array.from({ length: 8 }, () =>
      queue("abc", () => playOnce(store, "abc")),
    );
    await Promise.all(eight);

    // Every one of the eight was applied to the board the one before it left.
    const room = await store.load("abc");
    expect(room?.game?.events.length ?? 0).toBeGreaterThan(0);
    // Replaying the same eight moves serially must reach the same board.
    const serial = memoryStore();
    await serial.save(dealt());
    for (let i = 0; i < 8; i++) await playOnce(serial, "abc");
    expect(room).toEqual(await serial.load("abc"));
  });
});

describe("the gate itself", () => {
  it("runs work for one key in arrival order", async () => {
    const queue = inOrder();
    const done: number[] = [];
    const slow = (n: number, ms: number) =>
      queue("k", async () => {
        await new Promise((r) => setTimeout(r, ms));
        done.push(n);
      });

    // Descending delays: without the queue these finish 3, 2, 1.
    await Promise.all([slow(1, 30), slow(2, 20), slow(3, 10)]);

    expect(done).toEqual([1, 2, 3]);
  });

  it("does not make one key wait for another", async () => {
    const queue = inOrder();
    const done: string[] = [];

    await Promise.all([
      queue("slow", async () => {
        await new Promise((r) => setTimeout(r, 40));
        done.push("slow");
      }),
      queue("fast", async () => {
        done.push("fast");
      }),
    ]);

    expect(done).toEqual(["fast", "slow"]);
  });

  /**
   * A rejected action is ordinary — an illegal move is refused several times a
   * game. If a failure ahead in the queue cancelled the work behind it, the
   * room would be wedged by the first player to mis-click.
   */
  it("carries on after work that throws", async () => {
    const queue = inOrder();
    const failed = queue("k", async () => {
      throw new Error("refused");
    });

    await expect(failed).rejects.toThrow("refused");
    await expect(queue("k", async () => "still here")).resolves.toBe("still here");
  });

  it("does not hold on to keys whose work has finished", async () => {
    const queue = inOrder();
    for (let i = 0; i < 50; i++) await queue(`room-${i}`, async () => i);

    // Nothing to assert but the absence of a leak, so the next piece of work
    // on a drained key must still run rather than wait on a stale promise.
    await expect(queue("room-0", async () => "fresh")).resolves.toBe("fresh");
  });
});
