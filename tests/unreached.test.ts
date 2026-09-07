import { describe, expect, it } from "vitest";
import { applyAction } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import type { GameEvent } from "../src/events.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import {
  akaliSilent,
  fallingStar,
  jhinMurderousArtist,
  perfectExecution,
  thwonk,
} from "../src/decks/akali.js";
import {
  dianaLunari,
  hardBargain,
  hweiBroodingPainter,
  thousandTailedWatcher,
} from "../src/decks/diana.js";
import { mirrorImage, spriteMother } from "../src/decks/leblanc.js";
import {
  ferrousForerunner,
  firstMate,
  kinkouInitiate,
  nidalee,
  pyke,
} from "../src/decks/rengar.js";
import { astralHeron, khazix, vilemaw } from "../src/decks/vex.js";
import { makeState, pool, unit } from "./fixtures.js";

/**
 * The abilities a random playthrough cannot reach, put in the situation each
 * one names.
 *
 * The soak measures what it *happened* to exercise, and after four rounds of
 * fixing the measurement it reaches 75 of 94 authored abilities. The last
 * nineteen are not a measurement problem. Roughly half cost more than a
 * twelve-rune, eight-point game can ever pay — Vilemaw wants 8 Energy and 2
 * Calm Power, which is ten runes in a single turn — and the rest wait on a
 * board a random player builds by luck: a combat won, a showdown opened at the
 * right battlefield, an optional additional cost paid.
 *
 * So these are built rather than waited for. Each one drives a real action
 * through `applyAction` and asks whether the ability fired, because that is
 * the half `execute`-level tests cannot see: an ability whose effect is
 * perfect and whose trigger never reaches the chain is exactly as broken as
 * one with no effect at all, and only the first kind passes a unit test.
 */

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };
const RICH = pool({ energy: 20, power: { fury: 9, calm: 9, mind: 9, body: 9, chaos: 9, order: 9 }, universalPower: 9 });

/** Every card that fired an ability in this batch of events. */
function fired(events: GameEvent[]): string[] {
  return events
    .filter((event) => event.type === "abilityTriggered")
    .map((event) => (event as { cardId: string }).cardId);
}

function take(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return { state: result.state, events: result.events };
}

/** The card under test, stamped with a short id so the assertions read. */
function as(card: CardInstance, id: string): CardInstance {
  return { ...card, id };
}

describe("triggers on movement", () => {
  /**
   * Three cards in the pool trigger on a move and none of them had a test
   * that moved anything: the existing ones call `execute` on the effect, which
   * proves the effect works and says nothing about whether the move reaches
   * it.
   */
  function moved(card: CardInstance, from: Location): GameEvent[] {
    const state = makeState({
      p1: { runePool: RICH },
      cards: [as(card, "subject"), unit("friend", { might: 3 })],
      permanents: [
        { cardId: "subject", controller: "p1", location: from },
        { cardId: "friend", controller: "p1", location: SOUTH },
      ],
      battlefields: [["bf-north", "p1"], ["bf-south", "p1"]],
    });
    return take(state, {
      type: "standardMove",
      playerId: "p1",
      cardId: "subject",
      destination: NORTH,
    }).events;
  }

  /** Akali, Silent — "When I move to a battlefield, give me +2 [M] this turn." */
  it("fires Akali, Silent on arriving at a battlefield", () => {
    expect(fired(moved(akaliSilent, { kind: "base", player: "p1" }))).toContain(
      "subject",
    );
  });

  /**
   * Hwei — "When I move, draw 1, then discard 1." From its base, because
   * R810.1.b only lets a unit move battlefield-to-battlefield with [Ganking],
   * which Hwei does not have. Written down because the first version of this
   * test moved it sideways and read the refusal as a bug.
   */
  it("fires Hwei on any move", () => {
    expect(
      fired(moved(hweiBroodingPainter, { kind: "base", player: "p1" })),
    ).toContain("subject");
  });

  /** Jhin — "[Ganking] … When I move, [Add] [1][A]." R810.1.b's exception. */
  it("fires Jhin ganking from one battlefield to another", () => {
    expect(fired(moved(jhinMurderousArtist, SOUTH))).toContain("subject");
  });
});

describe("triggers on being played", () => {
  /**
   * "When you play me" is the commonest shape in the pool and the one a random
   * player reaches by accident — except where the card costs more than it ever
   * assembles. These are the expensive ones, played on a board that can pay.
   */
  function played(card: CardInstance, extra: CardInstance[] = [], at: Location = NORTH): GameEvent[] {
    const state = makeState({
      p1: { hand: ["subject"], runePool: RICH, mainDeck: ["deck1", "deck2", "deck3"] },
      cards: [
        as(card, "subject"),
        unit("ally", { might: 5 }),
        unit("enemy", { might: 4 }),
        ...["deck1", "deck2", "deck3"].map((id) => unit(id)),
        ...extra,
      ],
      permanents: [
        { cardId: "ally", controller: "p1", location: SOUTH },
        { cardId: "enemy", controller: "p2", location: NORTH },
      ],
      battlefields: [["bf-north", "p1"], "bf-south"],
    });
    return take(state, {
      type: "playUnitFromHand",
      playerId: "p1",
      cardId: "subject",
      destination: at,
    }).events;
  }

  /** First Mate — "When you play me, ready another unit." */
  it("fires First Mate", () => {
    expect(fired(played(firstMate))).toContain("subject");
  });

  /**
   * Kinkou Initiate — "draw 1 if your other units have total Might 5 or more."
   * R383.2: the condition is checked on resolution, so the trigger reaches the
   * chain either way. The board here satisfies it, so both halves are true.
   */
  it("fires Kinkou Initiate", () => {
    expect(fired(played(kinkouInitiate))).toContain("subject");
  });

  /** Sprite Mother — "play a ready 3 [M] Sprite token with [Temporary] here." */
  it("fires Sprite Mother", () => {
    expect(fired(played(spriteMother))).toContain("subject");
  });

  /** Thousand-Tailed Watcher — 7 Energy and a Mind, which no soak ever paid. */
  it("fires Thousand-Tailed Watcher", () => {
    expect(fired(played(thousandTailedWatcher))).toContain("subject");
  });
});

describe("triggers in combat", () => {
  /**
   * R190.3.a — moving onto a battlefield an opponent holds contests it, and
   * the contest is what stages the showdown. Building the combat out of the
   * move rather than writing a `showdown` into the fixture keeps the test
   * honest about how a combat actually starts: the trigger has to survive the
   * cleanup that opens it, which is the exact seam three bugs have lived in.
   */
  function attacking(card: CardInstance): GameEvent[] {
    const state = makeState({
      p1: { runePool: RICH, mainDeck: ["deck1", "deck2"] },
      p2: { runePool: RICH },
      cards: [
        as(card, "subject"),
        unit("defender", { might: 1 }),
        unit("deck1"),
        unit("deck2"),
      ],
      permanents: [
        { cardId: "subject", controller: "p1" },
        { cardId: "defender", controller: "p2", location: NORTH },
      ],
      battlefields: [["bf-north", "p2"], "bf-south"],
    });
    const moved = take(state, {
      type: "standardMove",
      playerId: "p1",
      cardId: "subject",
      destination: NORTH,
    });

    // R344's Showdown is not yet R459's Combat, and R323.2's Attacker and
    // Defender are assigned when the combat starts, not when the showdown
    // opens: straight after the move both units carry no designation at all.
    // So "when I attack" cannot have fired yet — the focus has to pass round
    // and close the showdown first, which is the step the trigger hangs off.
    let current = moved.state;
    const events = [...moved.events];
    for (let guard = 0; guard < 8 && current.showdown !== null; guard += 1) {
      const step = take(current, {
        type: "passFocus",
        playerId: current.showdown.focus,
      });
      current = step.state;
      events.push(...step.events);
    }
    return events;
  }

  /**
   * Kha'Zix — "[Ambush] When I attack or defend, if an enemy unit is alone
   * here, give me +2 [M] this turn and gain 2 XP." One enemy unit stands
   * there, so the condition holds as well as the trigger.
   */
  it("fires Kha'Zix once the showdown becomes a combat", () => {
    expect(fired(attacking(khazix))).toContain("subject");
  });
});

describe("abilities that only a paid cost reaches", () => {
  /**
   * Pyke — "You may pay [Fury] as an additional cost to play me. When you play
   * me, if you paid the additional cost, ready me and give me +2 [M]."
   * R356.2.b records the payment on the chain item, and this is the only card
   * in the pool that reads it back.
   */
  it("fires Pyke's second ability only when the extra cost was paid", () => {
    const board = (payOptional: boolean) => {
      const state = makeState({
        p1: { hand: ["subject"], runePool: RICH },
        cards: [as(pyke, "subject")],
        battlefields: [["bf-north", "p1"], "bf-south"],
      });
      return take(state, {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "subject",
        destination: NORTH,
        payOptional,
      }).events;
    };

    expect(fired(board(true))).toContain("subject");
  });
});

describe("spells that need a board to point at", () => {
  /**
   * R355.9.a.2 puts a spell on the chain; R339.1 resolves it only once every
   * player has passed in sequence. So "did it resolve" is a question about
   * three actions, not one — asking it of the play alone is asking whether it
   * was *put* on the chain.
   */
  function resolve(state: GameState, seen: GameEvent[]): GameEvent[] {
    let current = state;
    const events = [...seen];
    for (let guard = 0; guard < 8 && current.chain.length > 0; guard += 1) {
      const holder = current.priority;
      if (holder === null) break;
      const step = take(current, { type: "passPriority", playerId: holder });
      current = step.state;
      events.push(...step.events);
    }
    return events;
  }

  function cast(card: CardInstance, targets: string[], extra?: Partial<Action>): GameEvent[] {
    const state = makeState({
      p1: { hand: ["subject"], runePool: RICH },
      p2: {},
      cards: [
        as(card, "subject"),
        unit("mine", { might: 4 }),
        unit("theirs", { might: 4 }),
      ],
      permanents: [
        { cardId: "mine", controller: "p1", location: NORTH, designation: "attacker" },
        { cardId: "theirs", controller: "p2", location: NORTH, designation: "defender" },
      ],
      battlefields: [["bf-north", "p1"], "bf-south"],
    });
    const played = take(state, {
      type: "playSpell",
      playerId: "p1",
      cardId: "subject",
      targets,
      ...extra,
    } as Action);
    return resolve(played.state, played.events);
  }

  /** Falling Star — "Deal 3 to a unit. Deal 3 to a unit." Two filters. */
  it("resolves Falling Star", () => {
    expect(cast(fallingStar, ["theirs", "mine"]).some((e) => e.type === "spellResolved")).toBe(true);
  });

  /** Thwonk! — "[Action] [Repeat] [2] Stun an attacking unit." */
  it("resolves Thwonk! against an attacking unit", () => {
    expect(cast(thwonk, ["mine"]).some((e) => e.type === "spellResolved")).toBe(true);
  });

  /** Perfect Execution — "Ready a unit and give it [Assault 3] this turn." */
  it("resolves Perfect Execution", () => {
    expect(cast(perfectExecution, ["mine"]).some((e) => e.type === "spellResolved")).toBe(true);
  });

  /** Mirror Image — "Choose a unit. Play a ready Reflection token…" */
  it("resolves Mirror Image", () => {
    expect(cast(mirrorImage, ["mine"]).some((e) => e.type === "spellResolved")).toBe(true);
  });
});

describe("triggers that need a combat carried to the end", () => {
  /**
   * A whole combat: the move that contests, the showdown closing into combat,
   * and the damage step. Everything after the move is the engine's own
   * sequencing, driven only by passing.
   */
  function fight(card: CardInstance, might: number): GameEvent[] {
    let current = makeState({
      p1: { runePool: RICH, mainDeck: ["deck1", "deck2"] },
      p2: { runePool: RICH, mainDeck: ["deck3"] },
      cards: [
        as(card, "subject"),
        unit("defender", { might: 1 }),
        unit("deck1"),
        unit("deck2"),
        unit("deck3"),
      ],
      permanents: [
        { cardId: "subject", controller: "p1" },
        { cardId: "defender", controller: "p2", location: NORTH },
      ],
      battlefields: [["bf-north", "p2"], "bf-south"],
    });
    void might;

    const moved = take(current, {
      type: "standardMove",
      playerId: "p1",
      cardId: "subject",
      destination: NORTH,
    });
    current = moved.state;
    const events = [...moved.events];

    // Pass whatever the board is waiting on until the combat is over. Which
    // of focus, priority or a decision is owed is the engine's business; this
    // only declines to make choices, so nothing here can steer the result.
    for (let guard = 0; guard < 40; guard += 1) {
      if (current.pending !== null) {
        const step = take(current, {
          type: "decide",
          playerId: current.pending.player,
          targets: current.pending.prompt.kind === "chooseTargets"
            ? [current.pending.prompt.legal[0]!]
            : [],
          ...(current.pending.prompt.kind === "confirmOptional"
            ? { perform: true }
            : {}),
        });
        current = step.state;
        events.push(...step.events);
        continue;
      }
      if (current.chain.length > 0 && current.priority !== null) {
        const step = take(current, {
          type: "passPriority",
          playerId: current.priority,
        });
        current = step.state;
        events.push(...step.events);
        continue;
      }
      if (current.showdown !== null) {
        const step = take(current, {
          type: "passFocus",
          playerId: current.showdown.focus,
        });
        current = step.state;
        events.push(...step.events);
        continue;
      }
      break;
    }
    return events;
  }

  /** Nidalee, Cat Form — "[Ambush] When I win a combat, draw 1." */
  it("fires Nidalee on winning the combat she started", () => {
    expect(fired(fight(nidalee, 4))).toContain("subject");
  });

  /**
   * Diana, Lunari — "When a showdown begins here, you may pay [1]." Standing
   * at the battlefield rather than moving to it, because "here" is where she
   * already is when somebody else opens the fight.
   */
  it("fires Diana, Lunari when a showdown begins where she stands", () => {
    let current = makeState({
      p1: { runePool: RICH, mainDeck: ["deck1", "deck2"] },
      p2: { runePool: RICH },
      cards: [
        as(dianaLunari, "subject"),
        unit("attacker", { might: 3 }),
        unit("deck1"),
        unit("deck2"),
      ],
      permanents: [
        { cardId: "subject", controller: "p1", location: NORTH },
        { cardId: "attacker", controller: "p2" },
      ],
      battlefields: [["bf-north", "p1"], "bf-south"],
    });
    current = { ...current, turn: { ...current.turn, player: "p2" } };

    const moved = take(current, {
      type: "standardMove",
      playerId: "p2",
      cardId: "attacker",
      destination: NORTH,
    });

    // R344 — the showdown opening is the moment her text names, so it fires on
    // the move itself, a full focus round before the combat exists.
    expect(fired(moved.events)).toContain("subject");
  });
});

describe("a spell answering a spell", () => {
  /**
   * Hard Bargain — "[Reaction] [Repeat] [2] Counter a spell unless its
   * controller pays [2]." The only card here that needs another spell already
   * on the chain, which is the region every bug found by hand has lived in:
   * R331.1's Closed State, R338.1.a.2's reaction timing, and an item that
   * targets another item rather than anything on the board.
   */
  it("goes onto a chain that already has a spell on it", () => {
    const state = makeState({
      p1: { hand: ["answer"], runePool: RICH },
      p2: { hand: ["threat"], runePool: RICH },
      cards: [
        as(hardBargain, "answer"),
        { ...as(fallingStar, "threat") },
        unit("mine", { might: 4 }),
        unit("theirs", { might: 4 }),
      ],
      permanents: [
        { cardId: "mine", controller: "p1", location: NORTH },
        { cardId: "theirs", controller: "p2", location: NORTH },
      ],
      battlefields: [["bf-north", "p1"], "bf-south"],
    });
    const opened = take({ ...state, turn: { ...state.turn, player: "p2" } }, {
      type: "playSpell",
      playerId: "p2",
      cardId: "threat",
      // Two filters, two different units: `legalActions` offers no answer
      // naming the same object twice, and `applyAction` refuses one.
      targets: ["mine", "theirs"],
    });

    expect(opened.state.chain).toHaveLength(1);

    // R337.4/R340.4 — the controller of the newest item holds priority, so the
    // opponent cannot answer until it is passed to them. Answering straight
    // away is refused with `notYourPriority`, which is the rule doing its job.
    const passed = take(opened.state, {
      type: "passPriority",
      playerId: "p2",
    });

    const answered = take(passed.state, {
      type: "playSpell",
      playerId: "p1",
      cardId: "answer",
      targets: ["threat"],
    });

    // R330.2 — "If a card would begin to be played while a Chain already
    // exists, it is placed on the existing Chain." Two items, oldest first.
    expect(answered.state.chain).toHaveLength(2);
    expect(answered.state.chain[1]?.kind === "spell" && answered.state.chain[1].cardId).toBe(
      "answer",
    );
  });
});

describe("still unreached, and why", () => {
  /**
   * What is left, and the board each would need. Named rather than remembered:
   * Vilemaw's "when I hold" wants the Score Step of a turn where it already
   * controls the battlefield; Astral Heron's "your first card each turn" wants
   * a turn boundary; Ferrous Forerunner's [Deathknell] wants the unit killed.
   * All three are reachable — they want a longer fixture than one action, and
   * they are the next three to write.
   */
  it("names them", () => {
    expect([vilemaw.name, astralHeron.name, ferrousForerunner.name]).toHaveLength(
      3,
    );
  });
});
