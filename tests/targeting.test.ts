import { describe, expect, it } from "vitest";
import { anthemMight } from "../src/builders.js";
import { legalTargets } from "../src/decisions.js";
import type { TargetFilter } from "../src/decisions.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

/** `source` at bf-north with a friendly and an enemy beside it, plus one away. */
function board(extra: CardInstance[] = []): GameState {
  return makeState({
    cards: [
      unit("source", { might: 2 }),
      unit("ally", { might: 2 }),
      unit("enemy", { might: 2 }),
      unit("distant", { might: 2 }),
      ...extra,
    ],
    permanents: [
      { cardId: "source", controller: "p1", location: NORTH },
      { cardId: "ally", controller: "p1", location: NORTH },
      { cardId: "enemy", controller: "p2", location: NORTH },
      { cardId: "distant", controller: "p2", location: SOUTH },
    ],
    battlefields: ["bf-north", "bf-south"],
  });
}

const find = (state: GameState, filter: TargetFilter) =>
  legalTargets(state, "p1", filter, "source");

/** Pit Rookie — "buff *another* friendly unit"; First Mate — "ready *another* unit". */
describe("'another' (R355.5)", () => {
  it("excludes the source when asked to", () => {
    expect(
      find(board(), { type: "unit", controller: "friendly", excludeSource: true }),
    ).toEqual(["ally"]);
  });

  it("includes it otherwise — nothing excludes a source by default", () => {
    expect(find(board(), { type: "unit", controller: "friendly" })).toEqual([
      "source",
      "ally",
    ]);
  });
});

/** Gust — "Return a unit at a battlefield with 3 [M] or less to its owner's hand." */
describe("a ceiling on Might", () => {
  it("keeps units at or under the line", () => {
    const heavy = makeState({
      cards: [unit("small", { might: 3 }), unit("big", { might: 4 })],
      permanents: [
        { cardId: "small", controller: "p1", location: NORTH },
        { cardId: "big", controller: "p1", location: NORTH },
      ],
      battlefields: ["bf-north"],
    });

    expect(
      legalTargets(heavy, "p1", {
        type: "unit",
        location: "battlefield",
        maxMight: 3,
      }),
    ).toEqual(["small"]);
  });

  /**
   * R477.3 — Might is what the layers say it is, so a unit an anthem has lifted
   * over the line is out of Gust's reach even though its printed Might is under.
   */
  it("reads the modified Might, not the printed one", () => {
    const commander: CardInstance = {
      ...unit("commander", { might: 1 }),
      abilities: [anthemMight(1)],
    };
    const lifted = makeState({
      cards: [unit("small", { might: 3 }), commander],
      permanents: [
        { cardId: "small", controller: "p1", location: NORTH },
        { cardId: "commander", controller: "p1", location: NORTH },
      ],
      battlefields: ["bf-north"],
    });

    expect(
      legalTargets(lifted, "p1", {
        type: "unit",
        location: "battlefield",
        maxMight: 3,
      }),
    ).toEqual(["commander"]);
  });
});

/** Evelynn, Entrancing — "move an enemy unit at a *different* location to my battlefield". */
describe("somewhere other than here", () => {
  it("takes only what stands elsewhere", () => {
    expect(
      find(board(), {
        type: "unit",
        controller: "enemy",
        awayFromSource: true,
      }),
    ).toEqual(["distant"]);
  });

  it("finds nothing when the source is nowhere", () => {
    const noSource = board();
    const { source: _gone, ...rest } = noSource.permanents;

    expect(
      legalTargets(
        { ...noSource, permanents: rest },
        "p1",
        { type: "unit", awayFromSource: true },
        "source",
      ),
    ).toEqual([]);
  });
});
