import { describe, expect, it } from "vitest";
import { applyAction, playUnitFromHand } from "../src/actions.js";
import type { Action } from "../src/actions.js";
import { ambushEnemyBattlefields, draw, spell } from "../src/builders.js";
import { FREE } from "../src/cost.js";
import { legalActions } from "../src/legal.js";
import { validPlayLocations } from "../src/play.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, pool, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };
const P1_BASE: Location = { kind: "base", player: "p1" };

/** Inferna — "[Ambush] … [Assault 2]". Only the play permission matters here. */
function ambusher(id: string): CardInstance {
  return unit(id, { might: 3, keywords: ["ambush"] });
}

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
 * R355.2.a — "By default, Valid locations include the controller's Base or a
 * Battlefield the controller controls."
 */
describe("where a unit may be played (R355.2)", () => {
  function board(card: CardInstance, extra: Partial<GameState> = {}): GameState {
    return {
      ...makeState({
        p1: { hand: [card.id], runePool: pool({ energy: 9 }) },
        cards: [card, unit("ally", { might: 1 }), unit("enemy", { might: 1 })],
        battlefields: ["bf-north", "bf-south"],
      }),
      ...extra,
    };
  }

  it("offers only the base when nothing else is controlled", () => {
    expect(validPlayLocations(board(unit("plain")), "p1", "plain")).toEqual([
      P1_BASE,
    ]);
  });

  it("offers a battlefield the player controls", () => {
    const controlled = board(unit("plain"), {
      battlefields: {
        "bf-north": { cardId: "bf-north", controller: "p1", contestedBy: null },
        "bf-south": { cardId: "bf-south", controller: null, contestedBy: null },
      },
    });

    expect(validPlayLocations(controlled, "p1", "plain")).toEqual([
      P1_BASE,
      NORTH,
    ]);
  });

  it("refuses a battlefield with no permission for it", () => {
    const result = playUnitFromHand(board(unit("plain")), "p1", "plain", NORTH);

    expect(result).toEqual({ ok: false, reason: "invalidDestination" });
  });
});

/** R822.1.b — "I may be played to a battlefield where you control Units." */
describe("[Ambush] as a play permission (R822.1.b)", () => {
  function withAlly(at: Location | null): GameState {
    return makeState({
      p1: { hand: ["inferna"], runePool: pool({ energy: 9 }) },
      cards: [ambusher("inferna"), unit("ally", { might: 1 })],
      permanents:
        at === null
          ? []
          : [{ cardId: "ally", controller: "p1", location: at }],
      battlefields: ["bf-north", "bf-south"],
    });
  }

  it("opens a battlefield where the player already has a unit", () => {
    expect(validPlayLocations(withAlly(NORTH), "p1", "inferna")).toEqual([
      P1_BASE,
      NORTH,
    ]);
  });

  it("does not open one where the player has nothing", () => {
    expect(validPlayLocations(withAlly(SOUTH), "p1", "inferna")).not.toContainEqual(
      NORTH,
    );
  });

  it("does not open one from a unit sitting in base", () => {
    const inBase = withAlly({ kind: "base", player: "p1" });

    expect(validPlayLocations(inBase, "p1", "inferna")).toEqual([P1_BASE]);
  });

  /** R822.1.d — Rengar, Trophy Hunter widens the permission. */
  it("a card's own text can widen it to enemy-held battlefields", () => {
    const rengar: CardInstance = {
      ...unit("rengar", { might: 4, keywords: ["ambush"] }),
      abilities: [ambushEnemyBattlefields],
    };
    const state = makeState({
      p1: { hand: ["rengar"], runePool: pool({ energy: 9 }) },
      cards: [rengar, unit("enemy", { might: 1 })],
      permanents: [{ cardId: "enemy", controller: "p2", location: NORTH }],
      battlefields: ["bf-north", "bf-south"],
    });

    expect(validPlayLocations(state, "p1", "rengar")).toEqual([P1_BASE, NORTH]);
  });
});

/**
 * R822.1.b's other half — "I have [Reaction] as long as I'm being played to a
 * battlefield where you control Units." The grant is about *this play*, so the
 * same card is Reaction-timed to one location and sorcery-timed to another.
 */
describe("[Ambush] as a timing grant (R822.1.b)", () => {
  /** p2's turn, a showdown open at bf-north where p1 has a unit. */
  function duringShowdown(): GameState {
    const base = makeState({
      p1: { hand: ["inferna"], runePool: pool({ energy: 9 }) },
      p2: { mainDeck: ["x"] },
      cards: [ambusher("inferna"), unit("ally", { might: 1 }), unit("x")],
      permanents: [{ cardId: "ally", controller: "p1", location: NORTH }],
      battlefields: ["bf-north", "bf-south"],
    });
    return {
      ...base,
      turn: { player: "p2", phase: "main", number: 2 },
      showdown: {
        battlefieldId: "bf-north",
        attacker: "p2",
        focus: "p1",
        consecutivePasses: 0,
      },
    };
  }

  it("plays into a showdown on the opponent's turn", () => {
    const state = run(duringShowdown(), [
      {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "inferna",
        destination: NORTH,
      },
    ]);

    expect(state.permanents.inferna?.location).toEqual(NORTH);
  });

  it("cannot use that timing to reach the base instead", () => {
    const result = playUnitFromHand(
      duringShowdown(),
      "p1",
      "inferna",
      P1_BASE,
    );

    // The base is a valid *location*, but Ambush grants no timing for it.
    expect(result).toEqual({ ok: false, reason: "notYourTurn" });
  });

  it("a unit without [Ambush] still cannot be played then", () => {
    const plain: GameState = {
      ...duringShowdown(),
      cards: {
        ...duringShowdown().cards,
        inferna: unit("inferna", { might: 3 }),
      },
    };

    const result = playUnitFromHand(plain, "p1", "inferna", NORTH);

    expect(result).toEqual({ ok: false, reason: "notYourTurn" });
  });

  /** R813 — [Reaction] reaches even a Closed State, with the chain up. */
  it("plays in response to a spell already on the chain", () => {
    const bolt = spell("bolt", "Bolt", FREE, draw(1));
    const base = duringShowdown();
    const withSpell: GameState = {
      ...base,
      showdown: null,
      cards: { ...base.cards, bolt },
      players: {
        ...base.players,
        p2: { ...base.players.p2, hand: ["bolt"] },
      },
    };

    const played = run(withSpell, [
      { type: "playSpell", playerId: "p2", cardId: "bolt", targets: [] },
    ]);
    expect(played.chain).toHaveLength(1);

    const ambushed = run(played, [
      { type: "passPriority", playerId: "p2" },
      {
        type: "playUnitFromHand",
        playerId: "p1",
        cardId: "inferna",
        destination: NORTH,
      },
    ]);

    expect(ambushed.permanents.inferna?.location).toEqual(NORTH);
  });
});

/**
 * legalActions filters candidates through applyAction, so the new restriction
 * reaches a UI without anything being taught the rule twice.
 */
describe("legal actions follow the permission", () => {
  it("only offers the locations a unit may actually be played to", () => {
    const state = makeState({
      p1: { hand: ["inferna"], runePool: pool({ energy: 9 }) },
      cards: [ambusher("inferna"), unit("ally", { might: 1 })],
      permanents: [{ cardId: "ally", controller: "p1", location: NORTH }],
      battlefields: ["bf-north", "bf-south"],
    });

    const plays = legalActions(state, "p1").filter(
      (action) => action.type === "playUnitFromHand",
    );

    expect(plays.map((action) => action.destination)).toEqual([P1_BASE, NORTH]);
  });
});
