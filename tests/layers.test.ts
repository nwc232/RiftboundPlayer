import { describe, expect, it } from "vitest";
import { anthemKeyword, anthemMight, passive } from "../src/builders.js";
import { characteristicsOf, keywordsOf, mightOf } from "../src/layers.js";
import type { CardInstance, GameState, Location } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const NORTH: Location = { kind: "battlefield", id: "bf-north" };
const SOUTH: Location = { kind: "battlefield", id: "bf-south" };

/** Garen, Commander — "Other friendly units have +1 Might here." */
const garen: CardInstance = {
  ...unit("garen", { might: 4 }),
  name: "Garen, Commander",
  abilities: [anthemMight(1)],
};

/** Captain Farron — "Other friendly units here have [Assault]." */
const farron: CardInstance = {
  ...unit("farron", { might: 4 }),
  name: "Captain Farron",
  abilities: [anthemKeyword("assault")],
};

/** Fiora, Victorious — "While I'm Mighty, I have Shield." (R476.3) */
const fiora: CardInstance = {
  ...unit("fiora", { might: 4 }),
  name: "Fiora, Victorious",
  abilities: [
    passive(
      { target: "self" },
      { layer: "ability", op: "grantKeyword", keyword: "shield" },
      { when: "mighty" },
    ),
  ],
};

/** Taric, Protector — printed [Shield]: +1 Might while a defender. */
const taric: CardInstance = {
  ...unit("taric", { might: 3, keywords: ["shield"] }),
  name: "Taric, Protector",
};

function board(
  cards: CardInstance[],
  permanents: {
    cardId: string;
    controller?: "p1" | "p2";
    location?: Location;
    designation?: "attacker" | "defender";
  }[],
): GameState {
  return makeState({
    cards,
    permanents: permanents.map((entry) => ({
      cardId: entry.cardId,
      controller: entry.controller ?? "p1",
      ...(entry.location !== undefined ? { location: entry.location } : {}),
      ...(entry.designation !== undefined
        ? { designation: entry.designation }
        : {}),
    })),
    battlefields: ["bf-north", "bf-south"],
  });
}

describe("arithmetic layer (R477.3)", () => {
  it("applies an anthem to other friendly units but not to itself", () => {
    const state = board([garen, unit("ally", { might: 2 })], [
      { cardId: "garen", location: NORTH },
      { cardId: "ally", location: NORTH },
    ]);

    expect(mightOf(state, "ally")).toBe(3);
    expect(mightOf(state, "garen")).toBe(4);
  });

  it("respects 'here' — an anthem does not reach another battlefield", () => {
    const state = board([garen, unit("ally", { might: 2 })], [
      { cardId: "garen", location: NORTH },
      { cardId: "ally", location: SOUTH },
    ]);

    expect(mightOf(state, "ally")).toBe(2);
  });

  it("does not buff an enemy unit", () => {
    const state = board([garen, unit("enemy", { might: 2 })], [
      { cardId: "garen", location: NORTH },
      { cardId: "enemy", controller: "p2", location: NORTH },
    ]);

    expect(mightOf(state, "enemy")).toBe(2);
  });

  it("stops applying the moment the source leaves the board", () => {
    const state = board([garen, unit("ally", { might: 2 })], [
      { cardId: "garen", location: NORTH },
      { cardId: "ally", location: NORTH },
    ]);
    const { garen: _gone, ...permanents } = state.permanents;

    expect(mightOf({ ...state, permanents }, "ally")).toBe(2);
  });
});

describe("Assault and Shield (R807 / R814)", () => {
  it("adds Might only while the unit holds the matching designation", () => {
    const idle = board([taric], [{ cardId: "taric", location: NORTH }]);
    const defending = board([taric], [
      { cardId: "taric", location: NORTH, designation: "defender" },
    ]);
    const attacking = board([taric], [
      { cardId: "taric", location: NORTH, designation: "attacker" },
    ]);

    expect(mightOf(idle, "taric")).toBe(3);
    expect(mightOf(defending, "taric")).toBe(4);
    // Shield is defence-only; being an attacker does nothing for it.
    expect(mightOf(attacking, "taric")).toBe(3);
  });

  it("sums a granted instance on top of a printed one (R814.2)", () => {
    const granting: CardInstance = {
      ...unit("cleric", { might: 2 }),
      abilities: [anthemKeyword("shield")],
    };
    const state = board([taric, granting], [
      { cardId: "taric", location: NORTH, designation: "defender" },
      { cardId: "cleric", location: NORTH },
    ]);

    // Printed Shield 1 plus a granted Shield 1 is Shield 2, not redundant.
    expect(characteristicsOf(state, "taric").shield).toBe(2);
    expect(mightOf(state, "taric")).toBe(5);
  });
});

/**
 * R476.2's recursion is the whole point of the loop: granting a keyword happens
 * in the ability layer, but that keyword's Might lands in the arithmetic layer
 * *after* it — so a single pass would miss it.
 */
describe("recurring over the layers (R476.2)", () => {
  it("grants Assault in one layer and pays it out in a later one", () => {
    const state = board([farron, unit("ally", { might: 2 })], [
      { cardId: "farron", location: NORTH },
      { cardId: "ally", location: NORTH, designation: "attacker" },
    ]);

    expect(keywordsOf(state, "ally")).toContain("assault");
    expect(mightOf(state, "ally")).toBe(3);
  });

  it("resolves Fiora — a buff makes her Mighty, which grants Shield", () => {
    // Fiora alone is 4 Might: not Mighty, so no Shield even while defending.
    const alone = board([fiora], [
      { cardId: "fiora", location: NORTH, designation: "defender" },
    ]);
    expect(keywordsOf(alone, "fiora")).not.toContain("shield");
    expect(mightOf(alone, "fiora")).toBe(4);

    // Garen's +1 takes her to 5, which is Mighty (R708), which grants Shield,
    // whose own +1 lands back in the arithmetic layer.
    const buffed = board([fiora, garen], [
      { cardId: "fiora", location: NORTH, designation: "defender" },
      { cardId: "garen", location: NORTH },
    ]);

    expect(keywordsOf(buffed, "fiora")).toContain("shield");
    expect(mightOf(buffed, "fiora")).toBe(6);
  });

  it("unwinds cleanly when the buff goes away (R476.3)", () => {
    const buffed = board([fiora, garen], [
      { cardId: "fiora", location: NORTH, designation: "defender" },
      { cardId: "garen", location: NORTH },
    ]);
    const { garen: _removed, ...permanents } = buffed.permanents;
    const after = { ...buffed, permanents };

    // 6 with three effects, straight back to 4 with none — not 5.
    expect(mightOf(after, "fiora")).toBe(4);
    expect(keywordsOf(after, "fiora")).not.toContain("shield");
  });
});

describe("off-board objects (R711)", () => {
  it("reads printed Might for a card that is not a permanent", () => {
    const state = board([garen, unit("ally", { might: 2 })], [
      { cardId: "garen", location: NORTH },
    ]);

    // "ally" is in no zone the layers apply to, so it keeps its printed value.
    expect(mightOf(state, "ally")).toBe(2);
  });
});
