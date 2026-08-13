import { describe, expect, it } from "vitest";
import { canPay, spend, totals } from "../src/cost.js";
import type { PaymentPurpose } from "../src/state.js";
import { cost, pool } from "./fixtures.js";

const PLAY_UNIT: PaymentPurpose = { kind: "playCard", cardType: "unit" };
const PLAY_SPELL: PaymentPurpose = { kind: "playCard", cardType: "spell" };

function remaining(result: ReturnType<typeof spend>) {
  if (result === undefined) throw new Error("expected the cost to be payable");
  return totals(result);
}

describe("spend", () => {
  it("subtracts energy from the pool", () => {
    const result = spend(pool({ energy: 3 }), cost({ energy: 2 }), PLAY_UNIT);

    expect(remaining(result).energy).toBe(1);
  });

  it("refuses when there is not enough energy", () => {
    expect(
      spend(pool({ energy: 1 }), cost({ energy: 2 }), PLAY_UNIT),
    ).toBeUndefined();
  });

  it("does not let Power pay an Energy cost", () => {
    const available = pool({ power: { fury: 5 }, universalPower: 5 });

    expect(canPay(available, cost({ energy: 1 }), PLAY_UNIT)).toBe(false);
  });

  it("pays a domain requirement with matching Power", () => {
    const result = spend(
      pool({ power: { order: 2 } }),
      cost({ power: { order: 2 } }),
      PLAY_UNIT,
    );

    expect(remaining(result).power).toEqual({});
  });

  it("refuses when the domain does not match", () => {
    const available = pool({ power: { fury: 2 } });

    expect(canPay(available, cost({ power: { order: 1 } }), PLAY_UNIT)).toBe(
      false,
    );
  });

  it("covers a domain shortfall with universal Power", () => {
    const result = spend(
      pool({ power: { order: 1 }, universalPower: 2 }),
      cost({ power: { order: 3 } }),
      PLAY_UNIT,
    );

    expect(remaining(result)).toEqual({
      energy: 0,
      power: {},
      universalPower: 0,
    });
  });

  it("spends domain Power before universal Power on an [A] requirement", () => {
    const result = spend(
      pool({ power: { fury: 1 }, universalPower: 1 }),
      cost({ anyPower: 1 }),
      PLAY_UNIT,
    );

    expect(remaining(result).universalPower).toBe(1);
    expect(remaining(result).power).toEqual({});
  });

  it("does not reuse Power already spent on a domain requirement", () => {
    const available = pool({ power: { mind: 1 } });

    expect(
      canPay(available, cost({ power: { mind: 1 }, anyPower: 1 }), PLAY_UNIT),
    ).toBe(false);
  });

  it("pays a mixed energy, domain, and [A] cost", () => {
    const result = spend(
      pool({ energy: 4, power: { calm: 2, fury: 1 } }),
      cost({ energy: 3, power: { calm: 1 }, anyPower: 2 }),
      PLAY_UNIT,
    );

    expect(remaining(result)).toEqual({
      energy: 1,
      power: {},
      universalPower: 0,
    });
  });
});

describe("restricted resources", () => {
  const spellOnly = {
    energy: 2,
    restriction: { kind: "onlyCardType", cardType: "spell" } as const,
  };

  it("cannot spend spell-only energy on a unit", () => {
    expect(canPay(pool(spellOnly), cost({ energy: 2 }), PLAY_UNIT)).toBe(false);
  });

  it("can spend spell-only energy on a spell", () => {
    expect(canPay(pool(spellOnly), cost({ energy: 2 }), PLAY_SPELL)).toBe(true);
  });

  it("ignores restricted buckets when totalling what a unit can afford", () => {
    const mixed = pool({ energy: 1 }, spellOnly);

    expect(canPay(mixed, cost({ energy: 2 }), PLAY_UNIT)).toBe(false);
    expect(canPay(mixed, cost({ energy: 3 }), PLAY_SPELL)).toBe(true);
  });

  it("spends restricted energy first so the flexible energy survives", () => {
    const result = spend(
      pool({ energy: 2 }, spellOnly),
      cost({ energy: 2 }),
      PLAY_SPELL,
    );

    if (result === undefined) throw new Error("expected the cost to be payable");
    const unrestricted = result.buckets.find((b) => b.restriction === null);
    const restricted = result.buckets.find((b) => b.restriction !== null);

    expect(restricted?.energy).toBe(0);
    expect(unrestricted?.energy).toBe(2);
  });
});
