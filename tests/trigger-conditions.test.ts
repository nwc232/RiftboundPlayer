import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { chainItemCardId } from "../src/chain.js";
import { draw, spell } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import type { GameEvent } from "../src/events.js";
import { seatOf } from "../src/state.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";
import type { TriggerCondition } from "../src/triggers.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

/** A unit whose only ability is "when <condition>, draw 1". */
function watcher(
  id: string,
  trigger: TriggerCondition,
  might = 1,
): CardInstance {
  return {
    ...unit(id, { might }),
    abilities: [{ kind: "triggered", trigger, effect: draw(1) }],
  };
}

/** A Legend, which lives in the Legend Zone rather than on the board (R107.4). */
function legend(id: string, trigger: TriggerCondition): CardInstance {
  return {
    id,
    name: id,
    type: "legend",
    cost: FREE,
    keywords: [],
    abilities: [{ kind: "triggered", trigger, effect: draw(1) }],
  };
}

function run(state: GameState, actions: Action[]) {
  let current = state;
  const log: GameEvent[] = [];
  for (const action of actions) {
    const result = applyAction(current, action);
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    current = result.state;
    log.push(...result.events);
  }
  return { state: current, log };
}

const P1_PASS: Action = { type: "passFocus", playerId: "p1" };
const P2_PASS: Action = { type: "passFocus", playerId: "p2" };
const P1_PRIORITY: Action = { type: "passPriority", playerId: "p1" };
const P2_PRIORITY: Action = { type: "passPriority", playerId: "p2" };

/**
 * p1's `mine` in base, p2's `theirs` already at bf-north. Moving `mine` there
 * contests the battlefield, which stages a showdown and then a combat.
 */
function battlefieldStandoff(
  mine: CardInstance,
  theirs: CardInstance,
): GameState {
  return makeState({
    p1: { mainDeck: ["a", "b", "c"], runePool: pool({ energy: 9 }) },
    p2: { mainDeck: ["d", "e", "f"] },
    cards: [
      mine,
      theirs,
      ...["a", "b", "c", "d", "e", "f"].map((id) => unit(id)),
    ],
    permanents: [
      { cardId: mine.id, controller: "p1" },
      { cardId: theirs.id, controller: "p2", location: NORTH },
    ],
    battlefields: ["bf-north"],
  });
}

const ATTACK: Action = {
  type: "standardMove",
  playerId: "p1",
  cardId: "mine",
  destination: NORTH,
};

/**
 * R464.2.c.3 — units gain their designation as combat opens, and R464.2.e makes
 * that its own trigger moment. Kha'Zix, Mutating Horror: "When I attack or
 * defend…".
 */
describe("attack and defend triggers (R464.2.e)", () => {
  it("fires for the attacker as the combat showdown closes", () => {
    const start = battlefieldStandoff(
      watcher("mine", { on: "designated", subject: "self", designation: "attacker" }),
      unit("theirs", { might: 1 }),
    );

    const { state } = run(start, [ATTACK, P1_PASS, P2_PASS]);

    expect(state.chain).toHaveLength(1);
    expect(chainItemCardId(state.chain[0]!)).toBe("mine");
  });

  it("fires for the defender too, and only for their own designation", () => {
    const start = battlefieldStandoff(
      unit("mine", { might: 1 }),
      watcher("theirs", { on: "designated", subject: "self", designation: "defender" }, 1),
    );

    const { state } = run(start, [ATTACK, P1_PASS, P2_PASS]);

    expect(state.chain.map(chainItemCardId)).toEqual(["theirs"]);
  });

  it("does not fire an attacker trigger on a unit that defends", () => {
    const start = battlefieldStandoff(
      unit("mine", { might: 1 }),
      watcher("theirs", { on: "designated", subject: "self", designation: "attacker" }, 1),
    );

    const { state } = run(start, [ATTACK, P1_PASS, P2_PASS]);

    expect(state.chain).toHaveLength(0);
  });

  /**
   * R335 — the trigger is a pending chain item, so the Combat Damage Step
   * cannot run until it resolves. Nothing has taken damage yet.
   */
  it("blocks the combat damage step until it resolves", () => {
    const start = battlefieldStandoff(
      watcher("mine", { on: "designated", subject: "self" }, 5),
      unit("theirs", { might: 1 }),
    );

    const held = run(start, [ATTACK, P1_PASS, P2_PASS]);
    expect(held.state.permanents.theirs?.damage).toBe(0);

    const after = run(held.state, [P1_PRIORITY, P2_PRIORITY]);
    expect(after.state.permanents.theirs).toBeUndefined();
  });

  /**
   * R323.2.a/b only assign a designation a unit doesn't already hold, so a
   * combat that re-affirms the same designation is not a second attack.
   */
  it("does not fire twice across one combat", () => {
    const start = battlefieldStandoff(
      watcher("mine", { on: "designated", subject: "self" }, 5),
      unit("theirs", { might: 1 }),
    );

    const { log } = run(start, [ATTACK, P1_PASS, P2_PASS, P1_PRIORITY, P2_PRIORITY]);

    expect(log.filter((e) => e.type === "designated" && e.cardId === "mine"))
      .toHaveLength(1);
  });
});

/** Nidalee, Cat Form — "When I win a combat, draw 1. (I win if I remain.)" */
describe("combat result triggers (R466.3)", () => {
  it("fires for the side that is the only one left standing", () => {
    const start = battlefieldStandoff(
      watcher("mine", { on: "combatWon", subject: "self" }, 5),
      unit("theirs", { might: 1 }),
    );

    const { state, log } = run(start, [ATTACK, P1_PASS, P2_PASS]);

    expect(log).toContainEqual({
      type: "combatResolved",
      battlefieldId: "bf-north",
      winner: "p1",
      loser: "p2",
    });
    expect(state.chain.map(chainItemCardId)).toContain("mine");
  });

  /**
   * R466.3.d — a repelled attack is "No Result", so surviving the fight is not
   * the same as winning it. The attacker is recalled during the Combat Cleanup
   * and neither player has won.
   *
   * A repel needs an asymmetry to happen at all: damage assigned equals summed
   * Might and the last unit soaks whatever is left (R465.2.c.4), so in a plain
   * fight one side is always wiped. Here the defender is Stunned, contributing
   * no Might (R423.1.b) while keeping its full Might against lethal (R423.1.c).
   */
  it("is No Result when the attacker is repelled", () => {
    const start = makeState({
      p1: { mainDeck: ["a", "b", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["d", "e", "f"] },
      cards: [
        watcher("mine", { on: "combatWon", subject: "self" }, 2),
        unit("theirs", { might: 5 }),
        ...["a", "b", "c", "d", "e", "f"].map((id) => unit(id)),
      ],
      permanents: [
        { cardId: "mine", controller: "p1" },
        { cardId: "theirs", controller: "p2", location: NORTH, stunned: true },
      ],
      battlefields: ["bf-north"],
    });

    const { state, log } = run(start, [ATTACK, P1_PASS, P2_PASS]);

    // Both are still alive, and R466.1.a.2 sent the attacker home.
    expect(state.permanents.mine?.location).toEqual({
      kind: "base",
      player: "p1",
    });
    expect(state.permanents.theirs).toBeDefined();

    expect(log).toContainEqual({
      type: "combatResolved",
      battlefieldId: "bf-north",
      winner: null,
      loser: null,
    });
    expect(state.chain.map(chainItemCardId)).not.toContain("mine");
  });

  /** R466.3.c — the result belongs to the controller; units inherit it. */
  it("fires for a bystander of the winning side that is still there", () => {
    const start = makeState({
      p1: { mainDeck: ["a", "b", "c"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["d", "e", "f"] },
      cards: [
        unit("mine", { might: 5 }),
        watcher("ally", { on: "combatWon", subject: "self" }, 1),
        unit("theirs", { might: 1 }),
        ...["a", "b", "c", "d", "e", "f"].map((id) => unit(id)),
      ],
      permanents: [
        { cardId: "mine", controller: "p1" },
        { cardId: "ally", controller: "p1", location: NORTH },
        { cardId: "theirs", controller: "p2", location: NORTH },
      ],
      battlefields: ["bf-north"],
    });

    // p2 has two units to spread their 1 damage over, so R465.2.c.7's choice
    // is real and the engine stops to ask.
    const { state } = run(start, [
      ATTACK,
      P1_PASS,
      P2_PASS,
      { type: "decide", playerId: "p2", targets: ["mine"] },
    ]);

    expect(state.chain.map(chainItemCardId)).toContain("ally");
  });
});

/** Irresistible Faefolk — "When I move to a battlefield…". */
describe("movement triggers", () => {
  function movingBoard(trigger: TriggerCondition): GameState {
    return makeState({
      p1: { mainDeck: ["a", "b"], runePool: pool({ energy: 9 }) },
      cards: [watcher("mover", trigger), unit("a"), unit("b")],
      permanents: [{ cardId: "mover", controller: "p1" }],
      battlefields: ["bf-north"],
    });
  }

  const MOVE: Action = {
    type: "standardMove",
    playerId: "p1",
    cardId: "mover",
    destination: NORTH,
  };

  it("fires when the unit itself moves to a battlefield", () => {
    const { state } = run(
      movingBoard({ on: "unitMoved", subject: "self", to: "battlefield" }),
      [MOVE],
    );

    expect(state.chain.map(chainItemCardId)).toEqual(["mover"]);
  });

  it("does not fire on a move the source only watched", () => {
    const start = makeState({
      p1: { mainDeck: ["a", "b"], runePool: pool({ energy: 9 }) },
      cards: [
        watcher("watcher", { on: "unitMoved", subject: "self" }),
        unit("other"),
        unit("a"),
        unit("b"),
      ],
      permanents: [
        { cardId: "watcher", controller: "p1" },
        { cardId: "other", controller: "p1" },
      ],
      battlefields: ["bf-north"],
    });

    const { state } = run(start, [
      { type: "standardMove", playerId: "p1", cardId: "other", destination: NORTH },
    ]);

    expect(state.chain).toHaveLength(0);
  });
});

/**
 * Pridestalker — "When you play a unit, give a unit +1 Might this turn." A
 * Legend, so this covers the Legend Zone as a trigger source at the same time.
 */
describe("friendly and enemy subjects", () => {
  function playBoard(
    p1Legend: CardInstance | null,
    p2Watcher: CardInstance | null,
  ): GameState {
    const cards: CardInstance[] = [
      unit("played", { might: 2 }),
      unit("a"),
      unit("b"),
      unit("c"),
    ];
    if (p1Legend !== null) cards.push(p1Legend);
    if (p2Watcher !== null) cards.push(p2Watcher);

    return makeState({
      p1: {
        hand: ["played"],
        mainDeck: ["a", "b"],
        runePool: pool({ energy: 9 }),
        ...(p1Legend !== null ? { legend: p1Legend.id } : {}),
      },
      p2: { mainDeck: ["c"] },
      cards,
      permanents:
        p2Watcher !== null
          ? [{ cardId: p2Watcher.id, controller: "p2", location: NORTH }]
          : [],
      battlefields: ["bf-north"],
    });
  }

  const PLAY: Action = {
    type: "playUnitFromHand",
    playerId: "p1",
    cardId: "played",
  };

  it("fires a Legend's ability from the Legend Zone (R107.4.c)", () => {
    const { state } = run(
      playBoard(legend("pride", { on: "unitPlayed", subject: "friendly" }), null),
      [PLAY],
    );

    expect(state.chain.map(chainItemCardId)).toEqual(["pride"]);
  });

  it("does not fire a friendly watcher on the opponent's play", () => {
    const { state } = run(
      playBoard(null, watcher("theirs", { on: "unitPlayed", subject: "friendly" })),
      [PLAY],
    );

    expect(state.chain).toHaveLength(0);
  });

  /** Vex, Apathetic — "When an opponent plays a unit while I'm at a battlefield". */
  it("fires an enemy watcher on the opponent's play", () => {
    const { state } = run(
      playBoard(null, watcher("theirs", { on: "unitPlayed", subject: "enemy" })),
      [PLAY],
    );

    expect(state.chain.map(chainItemCardId)).toEqual(["theirs"]);
  });

  it("watches spells separately from units", () => {
    const bolt = spell("bolt", "Bolt", FREE, draw(1));
    const start = makeState({
      p1: { hand: ["bolt"], mainDeck: ["a", "b"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["c"] },
      cards: [
        bolt,
        watcher("seer", { on: "spellPlayed", subject: "friendly" }),
        unit("a"),
        unit("b"),
        unit("c"),
      ],
      permanents: [{ cardId: "seer", controller: "p1" }],
    });

    const { state } = run(start, [
      { type: "playSpell", playerId: "p1", cardId: "bolt", targets: [] },
    ]);

    expect(state.chain.map(chainItemCardId)).toContain("seer");
  });
});

/**
 * R471.2 — Score abilities trigger "at the Battlefield that Scored". Kai'Sa,
 * Survivor ("When I conquer, draw 1.") and Vilemaw ("When I hold, draw 1.") are
 * units standing on the battlefield, not the battlefield card itself.
 */
describe("score triggers on units and legends (R471.2)", () => {
  function holdingBoard(
    unitTrigger: TriggerCondition,
    p1Legend?: CardInstance,
  ): GameState {
    const cards: CardInstance[] = [
      watcher("holder", unitTrigger),
      unit("a"),
      unit("b"),
      unit("c"),
    ];
    if (p1Legend !== undefined) cards.push(p1Legend);

    const base = makeState({
      p1: {
        mainDeck: ["a", "b"],
        runePool: pool({ energy: 9 }),
        ...(p1Legend !== undefined ? { legend: p1Legend.id } : {}),
      },
      p2: { mainDeck: ["c"] },
      cards,
      permanents: [{ cardId: "holder", controller: "p1", location: NORTH }],
      battlefields: ["bf-north"],
    });

    return {
      ...base,
      turn: { player: "p2", phase: "main", number: 2 },
      battlefields: {
        "bf-north": { cardId: "bf-north", controller: "p1", contestedBy: null },
      },
    };
  }

  const P2_END: Action = { type: "endTurn", playerId: "p2" };

  it("fires for a unit standing at the battlefield that was held", () => {
    const { state } = run(
      holdingBoard({ on: "battlefieldScored", subject: "here", method: "hold" }),
      [P2_END],
    );

    expect(seatOf(state, "p1").points).toBe(1);
    expect(state.chain.map(chainItemCardId)).toContain("holder");
  });

  it("does not fire a Conquer ability on a Hold", () => {
    const { state } = run(
      holdingBoard({
        on: "battlefieldScored",
        subject: "here",
        method: "conquer",
      }),
      [P2_END],
    );

    expect(state.chain).toHaveLength(0);
  });

  /** Gloomist — "When you or an ally hold, you may exhaust me to draw 1." */
  it("fires for a Legend, which is at no location at all (R107.4.b)", () => {
    const { state } = run(
      holdingBoard(
        { on: "battlefieldScored", subject: "here", method: "conquer" },
        legend("gloom", {
          on: "battlefieldScored",
          subject: "controller",
          method: "hold",
        }),
      ),
      [P2_END],
    );

    expect(state.chain.map(chainItemCardId)).toEqual(["gloom"]);
  });
});
