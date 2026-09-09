/**
 * Smoke test for a *running* Riftbound server — the deployment artifact
 * rather than the source.
 *
 * `npm test` proves the engine. It cannot prove that the container starts,
 * that `--omit=dev` left behind everything the server imports, that the
 * built front-end is where the static handler looks for it, or that a
 * WebSocket survives whatever proxy sits in front of the app. Each of those
 * has exactly one honest test: run the thing and play a game against it.
 *
 * Takes a base URL so the same check covers both the image CI just built and
 * the deployed site:
 *
 *     npx tsx scripts/smoke.ts http://127.0.0.1:8787
 *     npx tsx scripts/smoke.ts https://riftbound.fly.dev
 */

import WebSocket from "ws";
import { legalActions } from "../src/legal.js";
import type { GameState, PlayerId } from "../src/state.js";
import type { Action } from "../src/actions.js";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const socketUrl = base.replace(/^http/, "ws");

/** How long the server gets to come up. A cold container is not a failure. */
const BOOT_TIMEOUT = 90_000;

const failures: string[] = [];
const check = (ok: boolean, what: string): boolean => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
  return ok;
};

async function waitForBoot(): Promise<Response | undefined> {
  const until = Date.now() + BOOT_TIMEOUT;
  let last: string = "never answered";
  while (Date.now() < until) {
    try {
      const res = await fetch(base + "/");
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`FAIL  server answers at ${base} (${last})`);
  failures.push("server answers");
  return undefined;
}

type Seat = {
  who: string;
  ws: WebSocket;
  seat: PlayerId | null;
  /** What proves this is the same person coming back to the same chair. */
  token: string | null;
  states: number;
  state: GameState | null;
};

/** Joins a room and resolves once the server has given this client a seat. */
function join(
  who: string,
  room: string,
  deck: number,
  token?: string,
): Promise<Seat> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl);
    const seat: Seat = { who, ws, seat: null, token: null, states: 0, state: null };
    const giveUp = setTimeout(() => reject(new Error(`${who} never got a seat`)), 20_000);
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          kind: "join",
          room,
          deck,
          players: 2,
          ...(token === undefined ? {} : { token }),
        }),
      ),
    );
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.kind === "joined") {
        seat.seat = message.seat;
        seat.token = message.token;
        clearTimeout(giveUp);
        resolve(seat);
      }
      if (message.kind === "state") {
        seat.states++;
        seat.state = message.state;
      }
      if (message.kind === "rejected") reject(new Error(`${who} rejected: ${message.reason}`));
    });
    ws.on("error", (e) => reject(e));
  });
}

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`smoke: ${base}\n`);

  const page = await waitForBoot();
  if (page === undefined) return;

  const html = await page.text();
  check(html.includes('<div id="root">'), "serves the front-end shell");

  // The bundle is hashed and referenced absolutely; a wrong `base` at build
  // time gives a page that loads and then renders nothing at all.
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
  if (check(asset !== undefined, "index.html references a script bundle") && asset) {
    const url = asset.startsWith("http") ? asset : base + (asset.startsWith("/") ? asset : "/" + asset);
    const res = await fetch(url);
    check(res.ok, `the bundle it references resolves (${asset})`);
  }

  const room = "SMOKE" + Math.floor(Math.random() * 100_000);
  const a = await join("A", room, 0);
  const b = await join("B", room, 1);
  await settle(1200);

  check(a.seat !== b.seat, `two clients get different seats (${a.seat} / ${b.seat})`);
  check(a.states > 0 && b.states > 0, "both seats receive a state");

  // R107 at the socket: a seat is never sent the other's hand.
  const opponentHand = (a.state as any)?.players?.[b.seat as string]?.hand;
  check(
    opponentHand === undefined ||
      !JSON.stringify(opponentHand).includes("name"),
    "a seat is not sent the opponent's hand",
  );

  // Playing is the point. One player acts; both must see it.
  let played = 0;
  for (let i = 0; i < 8; i++) {
    const actor = [a, b].find(
      (c) => c.state !== null && c.seat !== null && legalActions(c.state, c.seat).length > 0,
    );
    if (actor === undefined) break;
    const other = actor === a ? b : a;
    const seen = { actor: actor.states, other: other.states };
    const options: Action[] = legalActions(actor.state as GameState, actor.seat as PlayerId);
    actor.ws.send(JSON.stringify({ kind: "act", action: options[0] }));
    await settle(400);
    if (actor.states > seen.actor && other.states > seen.other) played++;
  }
  check(played > 0, `actions are accepted and broadcast to both seats (${played})`);

  // Dropping and coming back. A seat is held against a token for a grace
  // period, so a closed laptop or a dead tunnel is not a concession — and the
  // game that comes back has to be the same game, not a fresh deal.
  const boardBefore = JSON.stringify(b.state);
  const heldBy = a.token;
  a.ws.close();
  await settle(800);

  if (check(heldBy !== null, "a joiner is given a token for its seat")) {
    const again = await join("A again", room, 0, heldBy as string);
    await settle(1200);
    check(again.seat === a.seat, `the token returns them to their own chair (${again.seat})`);
    check(again.states > 0, "and they are sent the game again");
    check(
      JSON.stringify(b.state) === boardBefore,
      "the other seat's board was not reset by the reconnection",
    );
    again.ws.close();
  }

  b.ws.close();
}

main()
  .catch((e) => {
    console.log(`FAIL  ${e instanceof Error ? e.message : String(e)}`);
    failures.push("threw");
  })
  .then(() => {
    console.log(
      failures.length === 0
        ? "\nsmoke passed"
        : `\nsmoke FAILED: ${failures.length} check(s)\n  - ${failures.join("\n  - ")}`,
    );
    process.exit(failures.length === 0 ? 0 : 1);
  });
