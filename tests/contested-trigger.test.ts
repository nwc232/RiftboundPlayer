import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import { legalActions } from "../src/legal.js";
import type { GameState, Location } from "../src/state.js";
import type { Action } from "../src/actions.js";
import {
  emperorsDais,
  inferna,
  irresistibleFaefolk,
  nidalee,
  pridestalker,
} from "../src/decks/rengar.js";
import { gust, sneakyDeckhand, targonsPeak } from "../src/decks/vex.js";
import { characteristicsOf } from "../src/layers.js";
import { seatOf } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

/**
 * A trigger raised by the very move that contests a battlefield.
 *
 * Found in play rather than in a test: Irresistible Faefolk moved from its
 * base onto an *empty* battlefield, which contests it (R190.3.a) and fires the
 * unit's "when I move to a battlefield" at the same moment. The ability landed
 * on the chain and was never asked about — the only thing offered was passing
 * priority, which resolved it having chosen nothing.
 *
 * Two rules had met head on. R344 opens a Showdown only "when the turn is in a
 * Neutral Open State" and R460 wants "no items on the Chain", so the staged
 * showdown could not run while the trigger was pending; R334's HOT FEPR holds
 * the chain behind outstanding tasks, so the trigger could not finalize while
 * the showdown task was queued. Neither could move.
 *
 * It only bites when the destination is *contested* by the same move, which is
 * why moving onto a battlefield you already control always worked.
 */
function board(controlled: boolean): GameState {
  return makeState({
    p1: { runePool: pool({ energy: 9, universalPower: 9 }) },
    cards: [
      { ...irresistibleFaefolk, id: "faefolk" },
      unit("enemy", { might: 2 }),
    ],
    permanents: [
      { cardId: "faefolk", controller: "p1" },
      { cardId: "enemy", controller: "p2", location: SOUTH },
    ],
    battlefields: [controlled ? ["bf-north", "p1"] : "bf-north", "bf-south"],
  });
}

function move(state: GameState): GameState {
  const result = applyAction(state, {
    type: "standardMove",
    playerId: "p1",
    cardId: "faefolk",
    destination: NORTH,
  });
  if (!result.ok) throw new Error(`move refused: ${result.reason}`);
  return result.state;
}

describe("a trigger from the move that contests the battlefield", () => {
  it("asks its 'you may' rather than stranding it on the chain", () => {
    const after = move(board(false));

    expect(after.battlefields["bf-north"]?.contestedBy).toBe("p1");
    expect(after.chain).toHaveLength(1);
    // The bug: `pending` was null here and the only move was passPriority.
    expect(after.pending?.prompt.kind).toBe("confirmOptional");
    expect(legalActions(after, "p1").map((a) => a.type)).not.toContain(
      "passPriority",
    );
  });

  /** Moving onto a battlefield you already control never broke. */
  it("asks the same question on an uncontested move", () => {
    expect(move(board(true)).pending?.prompt.kind).toBe("confirmOptional");
  });

  /**
   * The whole point of the card: the enemy is dragged in from the *other*
   * battlefield, and only then does the showdown open — with them in it.
   */
  it("drags the chosen enemy in, then opens the showdown", () => {
    let state = move(board(false));

    for (const answer of [
      { type: "decide" as const, playerId: "p1" as const, perform: true },
      { type: "decide" as const, playerId: "p1" as const, targets: ["enemy"] },
    ]) {
      const result = applyAction(state, answer);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    for (const who of ["p1", "p2"] as const) {
      if (state.chain.length === 0) break;
      const passed = applyAction(state, { type: "passPriority", playerId: who });
      expect(passed.ok).toBe(true);
      if (!passed.ok) return;
      state = passed.state;
    }

    expect(state.permanents["enemy"]?.location).toEqual(NORTH);
    expect(state.permanents["faefolk"]?.location).toEqual(NORTH);
    // R344 — the showdown the move staged opens once the chain is clear.
    expect(state.showdown?.battlefieldId).toBe("bf-north");
    expect(state.tasks).toEqual([]);
  });

  /** Declining leaves the enemy where they were, and still opens the showdown. */
  it("still opens the showdown when the trigger is declined", () => {
    let state = move(board(false));
    const no = applyAction(state, {
      type: "decide",
      playerId: "p1",
      perform: false,
    });
    expect(no.ok).toBe(true);
    if (!no.ok) return;
    state = no.state;

    expect(state.permanents["enemy"]?.location).toEqual(SOUTH);
    expect(state.showdown?.battlefieldId).toBe("bf-north");
  });
});

/**
 * "That battlefield" survives the source leaving the board.
 *
 * R359.3.f.3 — "information a trigger reads off its condition is noted when
 * the condition is fulfilled, not when the ability resolves." Irresistible
 * Faefolk's "that battlefield" is the one it moved *to*, and it stays that
 * battlefield even if the Faefolk is bounced to hand before the trigger
 * resolves.
 *
 * Reported from play: Gust returned the Faefolk, and the enemy unit was then
 * moved to *its own base* — the effect fell through to a default destination
 * when it could not work out the one it names, which is a different effect
 * wearing the same name.
 */
describe("a trigger whose source leaves before it resolves", () => {
  function midChain(): GameState {
    const start = makeState({
      p1: { hand: ["gust"], runePool: pool({ energy: 9, universalPower: 9 }) },
      p2: { runePool: pool({ energy: 9, universalPower: 9 }) },
      cards: [
        { ...irresistibleFaefolk, id: "faefolk" },
        unit("deckhand", { might: 2 }),
        gust,
      ],
      permanents: [
        { cardId: "faefolk", controller: "p2" },
        { cardId: "deckhand", controller: "p1", location: SOUTH },
      ],
      battlefields: ["bf-north", "bf-south"],
    });
    let state: GameState = { ...start, turn: { ...start.turn, player: "p2" } };

    const steps: Action[] = [
      { type: "standardMove", playerId: "p2", cardId: "faefolk", destination: NORTH },
      { type: "decide", playerId: "p2", perform: true },
      { type: "decide", playerId: "p2", targets: ["deckhand"] },
      { type: "passPriority", playerId: "p2" },
      { type: "playSpell", playerId: "p1", cardId: "gust", targets: ["faefolk"] },
    ];
    for (const step of steps) {
      const result = applyAction(state, step);
      if (!result.ok) throw new Error(`${step.type} refused: ${result.reason}`);
      state = result.state;
    }
    return state;
  }

  it("still means the battlefield it moved to", () => {
    let state = midChain();
    // Everyone passes until the chain drains: Gust resolves first (LIFO), so
    // the Faefolk is in hand by the time its own trigger resolves.
    for (let i = 0; i < 12 && state.chain.length > 0; i += 1) {
      if (state.pending !== null) break;
      const who = state.priority;
      if (who === null) break;
      const passed = applyAction(state, { type: "passPriority", playerId: who });
      if (!passed.ok) break;
      state = passed.state;
    }

    expect(state.permanents["faefolk"]).toBeUndefined();
    expect(state.permanents["deckhand"]?.location).toEqual(NORTH);
  });
});

/**
 * The whole reported game, end to end.
 *
 * Rengar's Pridestalker triggering on each unit played; Irresistible Faefolk
 * moving onto an empty Emperor's Dais and dragging Sneaky Deckhand across from
 * Targon's Peak; Gust bouncing the Faefolk before its own trigger resolved.
 * Two separate bugs met in it, and the pair of them changed who won the
 * battlefield — so it is worth keeping as one sequence rather than only as the
 * two units it was taken apart into.
 */
describe("the reported game, start to finish", () => {
  const DAIS: Location = { kind: "battlefield", id: "emperors-dais" };
  const PEAK: Location = { kind: "battlefield", id: "targons-peak" };

  function opening(): GameState {
    const start = makeState({
      p1: { hand: ["gust"], runePool: pool({ energy: 9, universalPower: 9 }) },
      p2: {
        hand: ["inferna", "nidalee"],
        legend: "pridestalker",
        runePool: pool({ energy: 20, power: { body: 5 }, universalPower: 9 }),
      },
      cards: [
        pridestalker,
        { ...irresistibleFaefolk, id: "faefolk" },
        { ...inferna, id: "inferna" },
        { ...nidalee, id: "nidalee" },
        { ...sneakyDeckhand, id: "deckhand" },
        { ...gust, id: "gust" },
        { ...emperorsDais, id: "emperors-dais" },
        { ...targonsPeak, id: "targons-peak" },
      ],
      permanents: [
        { cardId: "deckhand", controller: "p1", location: PEAK },
        // Played the turn before, so the Awaken step has readied it.
        { cardId: "faefolk", controller: "p2" },
      ],
      battlefields: ["emperors-dais", ["targons-peak", "p1"]],
    });
    return { ...start, turn: { ...start.turn, player: "p2" } };
  }

  function run(state: GameState, steps: Action[]): GameState {
    let current = state;
    for (const step of steps) {
      const result = applyAction(current, step);
      if (!result.ok) throw new Error(`${step.type} refused: ${result.reason}`);
      current = result.state;
    }
    return current;
  }

  /**
   * The order it was actually played in, which is the whole difficulty:
   * [Ambush] (R822.1.b) grants Reaction timing while you control units at the
   * destination, so both units go onto the chain *on top of* Gust, while the
   * Faefolk is still standing at the Dais to grant it.
   */
  const SEQUENCE: Action[] = [
    { type: "standardMove", playerId: "p2", cardId: "faefolk", destination: DAIS },
    { type: "decide", playerId: "p2", perform: true },
    { type: "decide", playerId: "p2", targets: ["deckhand"] },
    { type: "passPriority", playerId: "p2" },
    { type: "playSpell", playerId: "p1", cardId: "gust", targets: ["faefolk"] },
    { type: "passPriority", playerId: "p1" },
    { type: "playUnitFromHand", playerId: "p2", cardId: "inferna", destination: DAIS },
    { type: "decide", playerId: "p2", targets: ["inferna"] },
    { type: "passPriority", playerId: "p2" },
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p1" },
    { type: "playUnitFromHand", playerId: "p2", cardId: "nidalee", destination: DAIS },
    { type: "decide", playerId: "p2", targets: ["nidalee"] },
    { type: "passPriority", playerId: "p2" },
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p1" },
    { type: "passPriority", playerId: "p2" },
    { type: "passPriority", playerId: "p2" },
    { type: "passPriority", playerId: "p1" },
  ];

  /**
   * R383 — a trigger added onto a chain that already has items still owes its
   * choices. Pridestalker's was never asked, because the Cleanup R319.3 raised
   * for the very play that triggered it sat in front of it and could not run.
   */
  it("asks Pridestalker for a target on a unit played as a reaction", () => {
    const state = run(opening(), SEQUENCE.slice(0, 7));

    expect(state.chain.map((item) => item.kind)).toEqual([
      "trigger",
      "spell",
      "trigger",
    ]);
    expect(state.pending?.prompt.kind).toBe("chooseTargets");
    expect(state.pending?.player).toBe("p2");
  });

  it("buffs both units played onto the chain", () => {
    const state = run(opening(), SEQUENCE);

    // Printed 1 and 4, each a point higher for the turn.
    expect(characteristicsOf(state, "inferna").might).toBe(2);
    expect(characteristicsOf(state, "nidalee").might).toBe(5);
    expect(state.permanents["inferna"]?.location).toEqual(DAIS);
    expect(state.permanents["nidalee"]?.location).toEqual(DAIS);
  });

  /**
   * And the other half: Gust removes the Faefolk before its own trigger
   * resolves, and "that battlefield" still means the one it moved to — so the
   * Deckhand is dragged into a showdown rather than sent home.
   */
  it("drags the Deckhand to the Dais the Faefolk named, not to its base", () => {
    const state = run(opening(), SEQUENCE);

    expect(state.permanents["faefolk"]).toBeUndefined();
    expect(state.permanents["deckhand"]?.location).toEqual(DAIS);
    // R190.4.c — p1 has nothing at the Peak any more, so control lapses.
    expect(state.battlefields["targons-peak"]?.controller).toBeNull();
    // A real standoff: 2 + 5 against 2, rather than p2 walking in.
    expect(state.showdown?.battlefieldId).toBe("emperors-dais");
    expect(state.showdown?.attacker).toBe("p2");
  });
});
