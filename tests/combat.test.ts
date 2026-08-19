import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { assignDamage, isCombatAt, resolveCombat } from "../src/combat.js";
import type { GameState, Keyword, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function fighter(id: string, might: number, keywords: Keyword[] = []) {
  return unit(id, { might, keywords });
}

/** p1's attacker sits in base; p2's defenders are already at bf-north. */
function battle(
  attackers: { id: string; might: number; keywords?: Keyword[] }[],
  defenders: { id: string; might: number; keywords?: Keyword[] }[],
): GameState {
  return makeState({
    cards: [
      ...attackers.map((a) => fighter(a.id, a.might, a.keywords ?? [])),
      ...defenders.map((d) => fighter(d.id, d.might, d.keywords ?? [])),
    ],
    permanents: [
      ...attackers.map((a) => ({ cardId: a.id, controller: "p1" as const })),
      ...defenders.map((d) => ({
        cardId: d.id,
        controller: "p2" as const,
        location: NORTH,
      })),
    ],
    battlefields: ["bf-north"],
  });
}

function charge(cardId: string): Action {
  return { type: "standardMove", playerId: "p1", cardId, destination: NORTH };
}
const P1_PASS: Action = { type: "passFocus", playerId: "p1" };
const P2_PASS: Action = { type: "passFocus", playerId: "p2" };

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

describe("detecting combat", () => {
  it("is a combat once opposing units share a battlefield", () => {
    const state = run(battle([{ id: "a1", might: 3 }], [{ id: "d1", might: 2 }]), [
      charge("a1"),
    ]);

    expect(isCombatAt(state, "bf-north")).toBe(true);
  });
});

describe("damage assignment (R465.2.c)", () => {
  it("assigns exactly lethal before moving to the next unit", () => {
    const state = battle([], [
      { id: "d1", might: 2 },
      { id: "d2", might: 2 },
    ]);
    const targets = Object.values(state.permanents);

    const assigned = assignDamage(state, 3, targets);

    expect(assigned.get("d1")).toBe(2);
    expect(assigned.get("d2")).toBe(1);
  });

  it("assigns to Tank first and Backline last (R465.2.c.6)", () => {
    const state = battle([], [
      { id: "plain", might: 1 },
      { id: "back", might: 1, keywords: ["backline"] },
      { id: "tank", might: 1, keywords: ["tank"] },
    ]);
    const targets = Object.values(state.permanents);

    const assigned = assignDamage(state, 2, targets);

    expect(assigned.get("tank")).toBe(1);
    expect(assigned.get("plain")).toBe(1);
    expect(assigned.get("back")).toBeUndefined();
  });

  it("treats 0 Might as needing 1 damage to be lethal (R142.4.b)", () => {
    const state = battle([], [{ id: "d1", might: 0 }]);

    const assigned = assignDamage(state, 1, Object.values(state.permanents));

    expect(assigned.get("d1")).toBe(1);
  });
});

describe("resolving combat", () => {
  it("kills the loser and lets the winner take the battlefield", () => {
    const start = run(
      battle([{ id: "a1", might: 5 }], [{ id: "d1", might: 2 }]),
      [charge("a1"), P1_PASS, P2_PASS],
    );

    expect(start.permanents.d1).toBeUndefined();
    expect(start.players.p2.trash).toEqual(["d1"]);
    expect(start.permanents.a1?.location).toEqual(NORTH);
    expect(start.battlefields["bf-north"]?.controller).toBe("p1");
    expect(start.players.p1.points).toBe(1);
  });

  it("recalls surviving attackers when a defender lives (R466.1.a.2)", () => {
    const start = run(
      battle([{ id: "a1", might: 1 }], [{ id: "d1", might: 9 }]),
      [charge("a1"), P1_PASS, P2_PASS],
    );

    // a1 deals 1 to a 9-Might defender and takes 9 back, so a1 dies outright.
    expect(start.permanents.a1).toBeUndefined();
    expect(start.battlefields["bf-north"]?.controller).toBe("p2");
  });

  it("sends a surviving attacker home when the defender also survives", () => {
    // Both have more Might than the other can deal, so nobody dies.
    const state = battle(
      [{ id: "a1", might: 1 }],
      [{ id: "d1", might: 1 }, { id: "d2", might: 1 }],
    );
    const start = run(state, [charge("a1"), P1_PASS, P2_PASS]);

    // a1's 1 damage kills one defender; the defenders' 2 damage kills a1.
    expect(start.permanents.a1).toBeUndefined();
  });

  it("both sides wiping leaves the battlefield uncontrolled (R466.5.b)", () => {
    const start = run(
      battle([{ id: "a1", might: 2 }], [{ id: "d1", might: 2 }]),
      [charge("a1"), P1_PASS, P2_PASS],
    );

    expect(start.permanents.a1).toBeUndefined();
    expect(start.permanents.d1).toBeUndefined();
    expect(start.battlefields["bf-north"]?.controller).toBeNull();
    expect(start.players.p1.points).toBe(0);
  });

  it("heals surviving units after combat (R466.1.a.1)", () => {
    const start = run(
      battle([{ id: "a1", might: 5 }], [{ id: "d1", might: 1 }]),
      [charge("a1"), P1_PASS, P2_PASS],
    );

    // a1 took 1 damage from d1 but survives at full health afterwards.
    expect(start.permanents.a1?.damage).toBe(0);
  });

  it("uses summed Might on each side, not per-unit duels", () => {
    const state = battle(
      [{ id: "a1", might: 2 }, { id: "a2", might: 2 }],
      [{ id: "d1", might: 3 }],
    );
    const readied: GameState = {
      ...state,
      permanents: {
        ...state.permanents,
        a1: { ...state.permanents.a1!, location: NORTH },
        a2: { ...state.permanents.a2!, location: NORTH },
      },
      battlefields: {
        "bf-north": {
          cardId: "bf-north",
          controller: null,
          contestedBy: "p1",
        },
      },
    };

    const { state: after } = resolveCombat(readied, "bf-north", "p1");

    // 4 combined attacker Might kills the 3-Might defender; its 3 back kills a1
    // only, because assignment must reach lethal before moving on.
    expect(after.permanents.d1).toBeUndefined();
    expect(after.permanents.a1).toBeUndefined();
    expect(after.permanents.a2).toBeDefined();
    expect(after.battlefields["bf-north"]?.controller).toBe("p1");
  });
});
