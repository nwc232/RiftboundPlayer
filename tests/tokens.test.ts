import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { killUnits } from "../src/combat.js";
import {
  anthemMight,
  createToken,
  draw,
  modifyMight,
  passive,
  takeControl,
} from "../src/builders.js";
import { collectTriggers } from "../src/triggers.js";
import { chainItemCardId } from "../src/chain.js";
import {
  characteristicsOf,
  controllerOf,
  keywordsOf,
  mightOf,
} from "../src/layers.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { endTurn } from "../src/tasks.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };

function board(
  cards: CardInstance[],
  permanents: { cardId: string; controller?: "p1" | "p2"; location?: Location }[],
): GameState {
  return makeState({
    cards,
    permanents: permanents.map((entry) => ({
      cardId: entry.cardId,
      controller: entry.controller ?? "p1",
      ...(entry.location !== undefined ? { location: entry.location } : {}),
    })),
    battlefields: ["bf-north"],
  });
}

const CONTEXT = (
  targets: string[] = [],
  sourceLocation?: Location,
): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets,
  ...(sourceLocation !== undefined ? { sourceLocation } : {}),
});

describe("creating tokens (R179–187)", () => {
  it("puts a token on the board with R187's printed characteristics", () => {
    // Ferrous Forerunner — "Play two 3 [M] Mech unit tokens to your base."
    const after = execute(board([], []), createToken("mech", 2), CONTEXT()).state;

    const tokens = Object.values(after.permanents);
    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(after.cards[token.cardId]?.isToken).toBe(true);
      expect(mightOf(after, token.cardId)).toBe(3);
      expect(token.location).toEqual({ kind: "base", player: "p1" });
    }
  });

  it("enters exhausted by default and ready when the effect says so (R184.1)", () => {
    const base = board([], []);
    const exhausted = execute(base, createToken("recruit"), CONTEXT()).state;
    const ready = execute(base, createToken("recruit", 1, { ready: true }), CONTEXT())
      .state;

    expect(Object.values(exhausted.permanents)[0]?.exhausted).toBe(true);
    expect(Object.values(ready.permanents)[0]?.exhausted).toBe(false);
  });

  it("takes controller and owner from the creating effect (R182/R183)", () => {
    const after = execute(board([], []), createToken("bird"), CONTEXT()).state;
    const token = Object.values(after.permanents)[0]!;

    expect(token.controller).toBe("p1");
    expect(token.owner).toBe("p1");
  });

  it("enters at the source's location when the effect says 'here' (R184.2)", () => {
    const after = execute(
      board([], []),
      createToken("tentacle", 1, { to: "sourceLocation" }),
      CONTEXT([], NORTH),
    ).state;

    expect(Object.values(after.permanents)[0]?.location).toEqual(NORTH);
  });

  /**
   * R186.1 — "If a token is put into any Non-Board Zone besides the chain, it
   * ceases to exist immediately after moving to its new zone." A killed token
   * never reaches a trash, so nothing can recur it from there.
   */
  it("ceases to exist when killed rather than going to a trash", () => {
    const created = execute(board([], []), createToken("recruit"), CONTEXT()).state;
    const tokenId = Object.keys(created.permanents)[0]!;

    const after = killUnits(created, [tokenId]).state;

    // "Ceases to exist" is about zones: off the board, and never in a trash
    // for anything to recur it from.
    expect(after.permanents[tokenId]).toBeUndefined();
    expect(after.players.p1.trash).toEqual([]);
    expect(after.players.p2.trash).toEqual([]);
  });

  it("sends a killed card to its owner's trash, not its controller's (R56)", () => {
    const state = makeState({
      cards: [unit("stolen")],
      // p2 controls it, but p1 owns it.
      permanents: [{ cardId: "stolen", controller: "p2" }],
    });
    const owned: GameState = {
      ...state,
      permanents: {
        stolen: { ...state.permanents.stolen!, owner: "p1" },
      },
    };

    const after = killUnits(owned, ["stolen"]).state;

    expect(after.players.p1.trash).toEqual(["stolen"]);
    expect(after.players.p2.trash).toEqual([]);
  });
});

/**
 * R477.1.b. Copyable traits are Name, Super Type, Type, Tags, Cost, Domain and
 * Rules Text (R477.1.b.1.a) — Might is deliberately absent from that list.
 */
describe("copy effects (R477.1.b)", () => {
  /** Keeper of Masks — "play two Reflection unit tokens here. They become copies of me." */
  const keeper: CardInstance = {
    ...unit("keeper", { might: 1 }),
    name: "Keeper of Masks",
    abilities: [passive({ target: "self" }, {
      layer: "arithmetic",
      op: "addMight",
      amount: 2,
    })],
  };

  function copied(): GameState {
    const start = board([keeper], [{ cardId: "keeper", location: NORTH }]);
    return execute(
      start,
      createToken("reflection", 1, { copyOfTarget: 0 }),
      CONTEXT(["keeper"]),
    ).state;
  }

  it("takes the copied name and rules text", () => {
    const after = copied();
    const tokenId = Object.keys(after.permanents).find((id) => id !== "keeper")!;

    const traits = characteristicsOf(after, tokenId);
    expect(traits.name).toBe("Keeper of Masks");
    expect(traits.abilities).toHaveLength(1);
  });

  it("applies passives that came across in the copied rules text", () => {
    const after = copied();
    const tokenId = Object.keys(after.permanents).find((id) => id !== "keeper")!;

    // Printed Might 1 comes across, then the copied "+2 to self" applies.
    expect(mightOf(after, tokenId)).toBe(3);
  });

  /**
   * R477.1.b.1.a's written list of copyable traits omits Might, but the
   * official ruling on LeBlanc's Reflection is explicit: "the Reflection copies
   * only the unit's copyable traits (printed Might and Rules Text)".
   */
  it("copies printed Might over the token's own", () => {
    const after = copied();
    const tokenId = Object.keys(after.permanents).find((id) => id !== "keeper")!;

    // The token is still a printed 0 [M] Reflection underneath (R187.6).
    expect(after.cards[tokenId]?.might).toBe(0);
    // Keeper's printed 1 replaces it in the trait layer, then its copied
    // "+2 to self" lands in the arithmetic layer, same as on the original.
    expect(characteristicsOf(after, tokenId).baseMight).toBe(1);
    expect(mightOf(after, tokenId)).toBe(3);
    expect(mightOf(after, "keeper")).toBe(3);
  });

  /**
   * The other half of that ruling: gear, buffs, and Might bonuses stay behind.
   * A copy "enters as a clean copy", so it takes printed Might, not current.
   */
  it("does not copy a buff on the original", () => {
    const start = board([keeper], [{ cardId: "keeper", location: NORTH }]);
    const buffed = execute(
      start,
      modifyMight(4, "thisTurn"),
      CONTEXT(["keeper"]),
    ).state;
    expect(mightOf(buffed, "keeper")).toBe(7);

    const after = execute(
      buffed,
      createToken("reflection", 1, { copyOfTarget: 0 }),
      CONTEXT(["keeper"]),
    ).state;
    const tokenId = Object.keys(after.permanents).find((id) => id !== "keeper")!;

    // Printed 1 plus the copied passive — the +4 this turn does not come along.
    expect(mightOf(after, tokenId)).toBe(3);
  });

  it("copies the cost, which a token otherwise does not have (R185.3.a.2)", () => {
    const priced: CardInstance = {
      ...unit("priced", { might: 4 }),
      name: "Noxus Hopeful",
      cost: { energy: 4, power: {}, anyPower: 0 },
    };
    const start = board([priced], [{ cardId: "priced", location: NORTH }]);
    const after = execute(
      start,
      createToken("reflection", 1, { copyOfTarget: 0 }),
      CONTEXT(["priced"]),
    ).state;
    const tokenId = Object.keys(after.permanents).find((id) => id !== "priced")!;

    // R206's example: Atakhan reads the *copied* cost off a Reflection token.
    expect(characteristicsOf(after, tokenId).cost.energy).toBe(4);
  });

  /**
   * R477.1.b.1.b — a copy takes the source's *current* copyable traits, so a
   * Reflection copying a Reflection that is already a copy of something else
   * ends up as that third thing.
   */
  it("copies a copy's current traits, not its printed ones", () => {
    const first = copied();
    const firstToken = Object.keys(first.permanents).find(
      (id) => id !== "keeper",
    )!;

    const second = execute(
      first,
      createToken("reflection", 1, { copyOfTarget: 0 }),
      CONTEXT([firstToken]),
    ).state;
    const secondToken = Object.keys(second.permanents).find(
      (id) => id !== "keeper" && id !== firstToken,
    )!;

    expect(characteristicsOf(second, secondToken).name).toBe("Keeper of Masks");
    expect(mightOf(second, secondToken)).toBe(3);
  });

  it("terminates on a copy cycle rather than recurring forever", () => {
    const a: CardInstance = { ...unit("a", { might: 1 }), name: "A" };
    const b: CardInstance = { ...unit("b", { might: 2 }), name: "B" };
    const state = board([a, b], [
      { cardId: "a", location: NORTH },
      { cardId: "b", location: NORTH },
    ]);
    const cyclic: GameState = {
      ...state,
      modifiers: [
        {
          id: "m1",
          targetId: "a",
          modification: { layer: "trait", op: "copyOf", sourceId: "b" },
          duration: "permanent",
        },
        {
          id: "m2",
          targetId: "b",
          modification: { layer: "trait", op: "copyOf", sourceId: "a" },
          duration: "permanent",
        },
      ],
    };

    expect(() => characteristicsOf(cyclic, "a")).not.toThrow();
    expect(keywordsOf(cyclic, "a")).toBeDefined();
  });
});

/**
 * R477.1.a — Controller is a trait, so taking control is a layer effect rather
 * than a rewrite. Possession takes control permanently; Hostile Takeover's
 * "lose control of that unit at end of turn" is the same effect with a
 * duration, and simply expires.
 */
describe("taking control (R477.1.a)", () => {
  function enemyAtBattlefield(): GameState {
    return board([unit("thrall", { might: 3 })], [
      { cardId: "thrall", controller: "p2", location: NORTH },
    ]);
  }

  it("moves control without touching the stored permanent", () => {
    const after = execute(
      enemyAtBattlefield(),
      takeControl("permanent"),
      CONTEXT(["thrall"]),
    ).state;

    expect(controllerOf(after, "thrall")).toBe("p1");
    // The permanent itself is untouched; the change lives in the layer.
    expect(after.permanents.thrall?.controller).toBe("p2");
  });

  it("recalls to the new controller's base, not the old one (R454)", () => {
    const after = execute(
      enemyAtBattlefield(),
      takeControl("permanent", { recall: true }),
      CONTEXT(["thrall"]),
    ).state;

    expect(after.permanents.thrall?.location).toEqual({
      kind: "base",
      player: "p1",
    });
  });

  it("gives control back when a durational steal expires", () => {
    const stolen = execute(
      enemyAtBattlefield(),
      takeControl("thisTurn"),
      CONTEXT(["thrall"]),
    ).state;
    expect(controllerOf(stolen, "thrall")).toBe("p1");

    const next = endTurn(stolen).state;

    expect(controllerOf(next, "thrall")).toBe("p2");
  });

  /** R56 — the trash is the *owner's*, which a control change does not move. */
  it("returns a stolen unit to its owner's trash when it dies", () => {
    const stolen = execute(
      enemyAtBattlefield(),
      takeControl("permanent"),
      CONTEXT(["thrall"]),
    ).state;

    const after = killUnits(stolen, ["thrall"]).state;

    expect(after.players.p2.trash).toEqual(["thrall"]);
    expect(after.players.p1.trash).toEqual([]);
  });

  it("makes a stolen unit friendly for an anthem", () => {
    const commander: CardInstance = {
      ...unit("commander", { might: 4 }),
      abilities: [anthemMight(1)],
    };
    const start = board([commander, unit("thrall", { might: 3 })], [
      { cardId: "commander", controller: "p1", location: NORTH },
      { cardId: "thrall", controller: "p2", location: NORTH },
    ]);
    expect(mightOf(start, "thrall")).toBe(3);

    const stolen = execute(start, takeControl("permanent"), CONTEXT(["thrall"]))
      .state;

    expect(mightOf(stolen, "thrall")).toBe(4);
  });
});

/**
 * A copy takes the source's Rules Text (R477.1.b.1.a), so its triggers are the
 * copy's triggers too — with one exception the Reflection prints itself.
 */
describe("triggers on a copy", () => {
  /** A unit whose rules text carries a trigger that fires while it lives. */
  const watcher: CardInstance = {
    ...unit("watcher", { might: 2 }),
    name: "Dawn Watcher",
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "phaseBegan", phase: "beginning", subject: "controller" },
        effect: draw(1),
      },
    ],
  };

  /** Cloud Drake — "When you play me, draw 1." */
  const drake: CardInstance = {
    ...unit("drake", { might: 5 }),
    name: "Cloud Drake",
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: draw(1),
      },
    ],
  };

  function reflectionOf(source: CardInstance): {
    state: GameState;
    tokenId: string;
  } {
    const start = board([source], [{ cardId: source.id, location: NORTH }]);
    const state = execute(
      start,
      createToken("reflection", 1, { ready: true, copyOfTarget: 0 }),
      CONTEXT([source.id]),
    ).state;
    const tokenId = Object.keys(state.permanents).find(
      (id) => id !== source.id,
    )!;
    return { state, tokenId };
  }

  /** Honest Broker — "[Deathknell] Play a Gold gear token exhausted." */
  const broker: CardInstance = {
    ...unit("broker", { might: 2 }),
    name: "Honest Broker",
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "permanentKilled", subject: "self" },
        effect: createToken("gold"),
      },
    ],
  };

  /**
   * R808.1.d.3 — the dying permanent's details are noted *before* it moves. A
   * copy effect is keyed to the permanent, so without that note the copy's
   * rules text would read as printed again, and a Reflection prints nothing.
   */
  it("fires a copied Deathknell, whose source is gone by then", () => {
    const { state, tokenId } = reflectionOf(broker);

    const killed = killUnits(state, [tokenId]);
    const triggered = collectTriggers(killed.state, killed.events);

    expect(killed.state.permanents[tokenId]).toBeUndefined();
    expect(triggered.map((item) => chainItemCardId(item))).toEqual([tokenId]);
  });

  it("fires a trigger that came across in the copied rules text", () => {
    const { state, tokenId } = reflectionOf(watcher);

    const triggered = collectTriggers(state, [
      { type: "phaseBegan", playerId: "p1", phase: "beginning" },
    ]);

    // Both the original and its copy watch for it.
    expect(triggered.map((item) => chainItemCardId(item)).sort()).toEqual(
      ["watcher", tokenId].sort(),
    );
  });

  /**
   * The Reflection's own text: "I don't get that card's play effects." The
   * engine gets this from R383.4.a rather than a special case — a Play Effect
   * triggers on the permanent being *played to the board*, and a created token
   * emits `tokenCreated`, not `unitPlayed`.
   */
  it("does not fire a copied play effect", () => {
    const { state } = reflectionOf(drake);
    const made = execute(
      board([drake], [{ cardId: "drake", location: NORTH }]),
      createToken("reflection", 1, { ready: true, copyOfTarget: 0 }),
      CONTEXT(["drake"]),
    );

    expect(
      made.events.some((event) => event.type === "unitPlayed"),
    ).toBe(false);
    expect(collectTriggers(made.state, made.events)).toEqual([]);
    expect(state.players.p1.hand).toEqual([]);
  });
});
