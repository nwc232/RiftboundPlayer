import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { draw, exhaust, heal, recall, replacesDeath, seq } from "../src/builders.js";
import { deathReplacementsFor } from "../src/replacements.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

/**
 * Soraka, Wanderer — "If another unit you control here would die, if it has
 * less Might than me, instead heal it, exhaust it, and recall it."
 */
const soraka: CardInstance = {
  ...unit("soraka", { might: 5 }),
  name: "Soraka, Wanderer",
  abilities: [
    replacesDeath(
      { target: "otherFriendlyUnits", here: true },
      seq(heal(0), exhaust(0), recall(0)),
    ),
  ],
};

/** A unit that draws when it dies — for proving the death never happened. */
function deathknell(id: string, might: number): CardInstance {
  return {
    ...unit(id, { might }),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "permanentKilled", subject: "self" },
        effect: draw(1),
      },
    ],
  };
}

/** A board where `doomed` has lethal damage marked and a cleanup is due. */
function dying(extras: CardInstance[], damage = 9): GameState {
  return makeState({
    p1: { mainDeck: ["a", "b", "c"], runePool: pool({ energy: 9 }) },
    p2: { mainDeck: ["d"] },
    cards: [
      deathknell("doomed", 2),
      ...extras,
      unit("a"),
      unit("b"),
      unit("c"),
      unit("d"),
    ],
    permanents: [
      { cardId: "doomed", controller: "p1", location: NORTH, damage },
      ...extras.map((extra) => ({
        cardId: extra.id,
        controller: "p1" as const,
        location: NORTH,
      })),
    ],
    battlefields: ["bf-north"],
  });
}

const NUDGE: Action = { type: "drawCard", playerId: "p1" };

describe("replacing a death (R369)", () => {
  it("kills the unit when nothing intercedes", () => {
    const state = run(dying([]), [NUDGE]);

    expect(state.permanents.doomed).toBeUndefined();
    expect(state.players.p1.trash).toEqual(["doomed"]);
  });

  it("heals, exhausts and recalls it instead", () => {
    const state = run(dying([soraka]), [NUDGE]);

    expect(state.permanents.doomed).toBeDefined();
    expect(state.permanents.doomed?.damage).toBe(0);
    expect(state.permanents.doomed?.exhausted).toBe(true);
    expect(state.permanents.doomed?.location).toEqual({
      kind: "base",
      player: "p1",
    });
  });

  /**
   * R370.1.a.1 — "A unit's death being replaced … is the same as the kill
   * action that caused that death not occurring." So no Deathknell fires.
   */
  it("means the death never happened, so no death trigger fires", () => {
    const withSoraka = run(dying([soraka]), [NUDGE]);
    const without = run(dying([]), [NUDGE]);

    expect(without.chain).toHaveLength(1);
    expect(withSoraka.chain).toHaveLength(0);
  });

  it("says so in the events, since a death that did not happen is invisible", () => {
    const result = applyAction(dying([soraka]), NUDGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events).toContainEqual({
      type: "eventReplaced",
      playerId: "p1",
      cardId: "soraka",
      subject: "doomed",
      replaced: "death",
    });
  });

  it("does not reach a unit somewhere else — the scope says 'here'", () => {
    const elsewhere: GameState = (() => {
      const base = dying([soraka]);
      return {
        ...base,
        permanents: {
          ...base.permanents,
          soraka: { ...base.permanents.soraka!, location: { kind: "base", player: "p1" } },
        },
      };
    })();

    expect(run(elsewhere, [NUDGE]).permanents.doomed).toBeUndefined();
  });

  it("does not reach an enemy's unit", () => {
    const base = dying([soraka]);
    const theirs: GameState = {
      ...base,
      permanents: {
        ...base.permanents,
        doomed: { ...base.permanents.doomed!, controller: "p2" },
      },
    };

    expect(run(theirs, [NUDGE]).permanents.doomed).toBeUndefined();
  });

  /** R371.1 — "once they have been applied to that many events" it stops. */
  it("spends a once-each-turn allowance", () => {
    const once: CardInstance = {
      ...soraka,
      id: "hourglass",
      name: "Zhonya's Hourglass",
      abilities: [
        replacesDeath(
          { target: "otherFriendlyUnits", here: true },
          seq(heal(0), exhaust(0), recall(0)),
          { oncePerTurn: true },
        ),
      ],
    };

    const first = run(dying([once]), [NUDGE]);
    expect(first.permanents.doomed).toBeDefined();

    // Mark it lethal again in the same turn; the allowance is spent.
    const again: GameState = {
      ...first,
      permanents: {
        ...first.permanents,
        doomed: {
          ...first.permanents.doomed!,
          damage: 9,
          location: NORTH,
        },
      },
    };

    expect(run(again, [NUDGE]).permanents.doomed).toBeUndefined();
  });
});

/**
 * R372 — "If more than one Replacement Effect applies to the same event being
 * executed, then the controller of the object being acted on determines the
 * order the Replacement Effects will apply."
 */
describe("choosing which replacement applies (R372)", () => {
  function two(): GameState {
    const other: CardInstance = { ...soraka, id: "soraka2", name: "Another Soraka" };
    return dying([soraka, other]);
  }

  it("finds both before asking", () => {
    expect(deathReplacementsFor(two(), "doomed").map((r) => r.sourceId)).toEqual([
      "soraka",
      "soraka2",
    ]);
  });

  it("stops and asks the dying unit's controller", () => {
    const state = run(two(), [NUDGE]);

    expect(state.pending).toEqual({
      player: "p1",
      prompt: {
        kind: "orderReplacements",
        subject: "doomed",
        legal: ["soraka", "soraka2"],
      },
    });
    // R370.1.c — nothing has happened yet.
    expect(state.permanents.doomed?.damage).toBe(9);
  });

  it("applies the one chosen, and the unit lives", () => {
    const asked = run(two(), [NUDGE]);
    const answered = run(asked, [
      { type: "decide", playerId: "p1", targets: ["soraka2"] },
    ]);

    expect(answered.pending).toBeNull();
    expect(answered.permanents.doomed?.damage).toBe(0);
  });

  it("does not ask when only one applies", () => {
    expect(run(dying([soraka]), [NUDGE]).pending).toBeNull();
  });
});
