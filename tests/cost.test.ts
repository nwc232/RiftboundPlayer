import { describe, expect, it } from "vitest";
import { canPay, spend } from "../src/cost.js";
import { cost, pool } from "./fixtures.js";

describe("spend", () => {
  it("subtracts energy from the pool", () => {
    const result = spend(pool({ energy: 3 }), cost({ energy: 2 }));

    expect(result).toEqual({ energy: 1, power: {}, universalPower: 0 });
  });

  it("refuses when there is not enough energy", () => {
    expect(spend(pool({ energy: 1 }), cost({ energy: 2 }))).toBeUndefined();
  });

  it("does not let Power pay an Energy cost", () => {
    const available = pool({ power: { fury: 5 }, universalPower: 5 });

    expect(canPay(available, cost({ energy: 1 }))).toBe(false);
  });

  it("pays a domain requirement with matching Power", () => {
    const result = spend(
      pool({ power: { order: 2 } }),
      cost({ power: { order: 2 } }),
    );

    expect(result).toEqual({ energy: 0, power: { order: 0 }, universalPower: 0 });
  });

  it("refuses when the domain does not match", () => {
    const available = pool({ power: { fury: 2 } });

    expect(canPay(available, cost({ power: { order: 1 } }))).toBe(false);
  });

  it("covers a domain shortfall with universal Power", () => {
    const result = spend(
      pool({ power: { order: 1 }, universalPower: 2 }),
      cost({ power: { order: 3 } }),
    );

    expect(result).toEqual({ energy: 0, power: { order: 0 }, universalPower: 0 });
  });

  it("spends domain Power before universal Power on an [A] requirement", () => {
    const result = spend(
      pool({ power: { fury: 1 }, universalPower: 1 }),
      cost({ anyPower: 1 }),
    );

    expect(result).toEqual({
      energy: 0,
      power: { fury: 0 },
      universalPower: 1,
    });
  });

  it("lets an [A] requirement be paid by any domain", () => {
    expect(canPay(pool({ power: { chaos: 1 } }), cost({ anyPower: 1 }))).toBe(true);
    expect(canPay(pool({ power: { body: 1 } }), cost({ anyPower: 1 }))).toBe(true);
  });

  it("does not reuse Power already spent on a domain requirement", () => {
    const available = pool({ power: { mind: 1 } });

    expect(canPay(available, cost({ power: { mind: 1 }, anyPower: 1 }))).toBe(false);
  });

  it("pays a mixed energy, domain, and [A] cost", () => {
    const result = spend(
      pool({ energy: 4, power: { calm: 2, fury: 1 } }),
      cost({ energy: 3, power: { calm: 1 }, anyPower: 2 }),
    );

    expect(result).toEqual({
      energy: 1,
      power: { calm: 0, fury: 0 },
      universalPower: 0,
    });
  });
});
