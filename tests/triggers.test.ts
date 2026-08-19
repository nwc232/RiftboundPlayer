import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { chainItemCardId, sourceLocationOf } from "../src/chain.js";
import { draw } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import type { CardInstance, GameState } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

/** Cloud Drake — "When you play me, draw 1." (6 energy, 5 Might) */
const cloudDrake: CardInstance = {
  ...unit("drake", { might: 5, cost: { ...FREE, energy: 6 } }),
  name: "Cloud Drake",
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      effect: draw(1),
    },
  ],
};

/** Grove of the God-Willow — "When you hold here, draw 1." (a battlefield) */
const grove: CardInstance = {
  id: "grove",
  name: "Grove of the God-Willow",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here", method: "hold" },
      effect: draw(1),
    },
  ],
};

/** Scrapheap — "When this is played, discarded, or killed, draw 1." */
const scrapheap: CardInstance = {
  id: "scrapheap",
  name: "Scrapheap",
  type: "gear",
  cost: FREE,
  keywords: [],
  might: 1,
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "permanentKilled", subject: "self" },
      effect: draw(1),
    },
  ],
};

function run(state: GameState, actions: Action[]) {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
  }
  return current;
}

const P1_PRIORITY: Action = { type: "passPriority", playerId: "p1" };
const P2_PRIORITY: Action = { type: "passPriority", playerId: "p2" };

describe("play triggers (R383.4.a)", () => {
  function board(): GameState {
    return makeState({
      p1: {
        hand: ["drake"],
        mainDeck: ["a", "b"],
        runePool: pool({ energy: 9 }),
      },
      cards: [cloudDrake, unit("a"), unit("b")],
    });
  }

  it("puts the trigger on the chain rather than resolving it (R383.3)", () => {
    const state = run(board(), [
      { type: "playUnitFromHand", playerId: "p1", cardId: "drake" },
    ]);

    expect(state.chain).toHaveLength(1);
    expect(chainItemCardId(state.chain[0]!)).toBe("drake");
    expect(state.players.p1.hand).toEqual([]);
  });

  it("draws once the trigger resolves", () => {
    const state = run(board(), [
      { type: "playUnitFromHand", playerId: "p1", cardId: "drake" },
      P1_PRIORITY,
      P2_PRIORITY,
    ]);

    expect(state.chain).toHaveLength(0);
    expect(state.players.p1.hand).toEqual(["a"]);
  });

  it("leaves the source on the board — a trigger is not a card that moves", () => {
    const state = run(board(), [
      { type: "playUnitFromHand", playerId: "p1", cardId: "drake" },
      P1_PRIORITY,
      P2_PRIORITY,
    ]);

    expect(state.permanents.drake).toBeDefined();
    expect(state.players.p1.trash).toEqual([]);
  });

  it("is answerable — the opponent gets priority while it is pending", () => {
    const state = run(board(), [
      { type: "playUnitFromHand", playerId: "p1", cardId: "drake" },
    ]);

    expect(state.priority).toBe("p1");
    expect(applyAction(state, P2_PRIORITY)).toEqual({
      ok: false,
      reason: "notYourPriority",
    });
  });
});

describe("death triggers (R428.1.a.1.b)", () => {
  it("fires even though the source has already left the board", () => {
    const state: GameState = {
      ...makeState({
        p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
        cards: [scrapheap, unit("a")],
        permanents: [{ cardId: "scrapheap", controller: "p1", damage: 5 }],
      }),
    };

    // The cleanup after any action sweeps lethal damage, killing Scrapheap.
    const after = run(state, [{ type: "drawCard", playerId: "p1" }]);

    expect(after.permanents.scrapheap).toBeUndefined();
    expect(after.chain).toHaveLength(1);
    expect(chainItemCardId(after.chain[0]!)).toBe("scrapheap");
  });
});

/**
 * R323.4 orders the cleanup 3a (note the dying unit's location, add the
 * trigger) before 3b (kill it). Without the note, a Deathknell reading "at my
 * battlefield" — Kog'Maw, Caustic — would have nothing to resolve "here"
 * against, because the permanent carrying the location is gone by then.
 */
describe("death-trigger location snapshot (R323.4)", () => {
  const AT_BF = { kind: "battlefield", id: "bf" } as const;

  function dyingAtBattlefield(): GameState {
    return makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      cards: [scrapheap, unit("a")],
      permanents: [
        {
          cardId: "scrapheap",
          controller: "p1",
          location: AT_BF,
          damage: 5,
        },
      ],
      battlefields: ["bf"],
    });
  }

  it("notes the location on the kill event, before the card leaves the board", () => {
    const result = applyAction(dyingAtBattlefield(), {
      type: "drawCard",
      playerId: "p1",
    });
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);

    expect(result.events.find((event) => event.type === "unitKilled")).toEqual({
      type: "unitKilled",
      playerId: "p1",
      cardId: "scrapheap",
      location: AT_BF,
    });
  });

  it("carries it onto the trigger, so 'here' still resolves after the death", () => {
    const state = run(dyingAtBattlefield(), [
      { type: "drawCard", playerId: "p1" },
    ]);
    const item = state.chain[0]!;

    expect(state.permanents.scrapheap).toBeUndefined();
    expect(state.players.p1.trash).toEqual(["scrapheap"]);
    expect(sourceLocationOf(state, item)).toEqual(AT_BF);
  });

  it("keeps no snapshot for a living source — its location is looked up", () => {
    const state = run(
      makeState({
        p1: { hand: ["drake"], mainDeck: ["a"], runePool: pool({ energy: 9 }) },
        cards: [cloudDrake, unit("a")],
      }),
      [{ type: "playUnitFromHand", playerId: "p1", cardId: "drake" }],
    );
    const item = state.chain[0]!;

    expect(item.kind === "trigger" ? item.sourceLocation : "n/a").toBeUndefined();
    expect(sourceLocationOf(state, item)).toEqual({
      kind: "base",
      player: "p1",
    });
  });
});

describe("battlefield triggers", () => {
  it("fires on Hold for the battlefield's controller (R190.6.d)", () => {
    const held: GameState = {
      ...makeState({
        p1: { mainDeck: ["a", "b"], runePool: pool({ energy: 9 }) },
        cards: [grove, unit("u1"), unit("a"), unit("b")],
        permanents: [
          {
            cardId: "u1",
            controller: "p1",
            location: { kind: "battlefield", id: "grove" },
          },
        ],
        battlefields: ["grove"],
      }),
    };
    const controlled: GameState = {
      ...held,
      turn: { player: "p2", phase: "main", number: 2 },
      battlefields: {
        grove: { cardId: "grove", controller: "p1", contestedBy: null },
      },
    };

    // p2 ends their turn; p1's Beginning Phase holds grove, firing its trigger.
    const state = run(controlled, [{ type: "endTurn", playerId: "p2" }]);

    expect(state.players.p1.points).toBe(1);
    expect(state.chain).toHaveLength(1);
    expect(chainItemCardId(state.chain[0]!)).toBe("grove");
  });

  it("does not fire while the battlefield is uncontrolled", () => {
    const uncontrolled: GameState = {
      ...makeState({
        p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
        cards: [grove, unit("a")],
        battlefields: ["grove"],
      }),
      turn: { player: "p2", phase: "main", number: 2 },
    };

    const state = run(uncontrolled, [{ type: "endTurn", playerId: "p2" }]);

    expect(state.chain).toHaveLength(0);
  });
});

describe("trigger ordering (R383.3.d.1)", () => {
  it("puts the turn player's triggers on before the opponent's", () => {
    const mine: CardInstance = { ...scrapheap, id: "mine", name: "Mine" };
    const theirs: CardInstance = { ...scrapheap, id: "theirs", name: "Theirs" };

    const state: GameState = makeState({
      p1: { mainDeck: ["a"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["b"] },
      cards: [mine, theirs, unit("a"), unit("b")],
      permanents: [
        { cardId: "theirs", controller: "p2", damage: 5 },
        { cardId: "mine", controller: "p1", damage: 5 },
      ],
    });

    const after = run(state, [{ type: "drawCard", playerId: "p1" }]);

    // p1 is the turn player, so their trigger is added first and therefore
    // sits lower on the chain — meaning it resolves last.
    expect(after.chain.map(chainItemCardId)).toEqual(["mine", "theirs"]);
  });
});
