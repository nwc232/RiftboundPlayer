import {
  additionalCost,
  banishThenPlay,
  buff,
  createToken,
  draw,
  drawPerBattlefield,
  ifThen,
  legionCostReduction,
  modifyMight,
  moveUnit,
  mutualDamage,
  otherUnitsTotalMight,
  paidAdditionalCost,
  playPermission,
  ready,
  recycleFromOpponentHand,
  returnToHand,
  seq,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Cost, Domain } from "../state.js";

/**
 * Deck 2 — **Rengar, Pridestalker** (Body / Fury). Same conventions as
 * `vex.ts`: printed stats from the card data, and the rule beside anything
 * whose shape is not obvious.
 */

const cost = (energy: number, domain?: Domain, power = 0): Cost => ({
  energy,
  power: domain !== undefined && power > 0 ? { [domain]: power } : {},
  anyPower: 0,
});

export const pridestalker: CardInstance = {
  id: "pridestalker",
  name: "Pridestalker",
  tags: ["Rengar"],
  text: "When you play a unit, give a unit +1 [M] this turn.",
  type: "legend",
  cost: FREE,
  keywords: [],
  domains: ["fury", "body"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "friendly" },
      targeting: { filters: [{ type: "unit" }] },
      effect: modifyMight(1, "thisTurn"),
    },
  ],
};

export const rengarTrophyHunter: CardInstance = {
  id: "rengar-trophy-hunter",
  name: "Rengar, Trophy Hunter",
  tags: ["Cat", "Rengar", "Ixtal"],
  text: "[Ambush] I can be played to a battlefield where there are enemy units.",
  type: "unit",
  cost: cost(5, "body", 1),
  might: 6,
  domains: ["body"],
  keywords: ["ambush"],
  // R822.1.d — a card may widen Ambush's permissions; this is that.
  abilities: [playPermission({ kind: "whereEnemyUnits" })],
};

export const sabotage: CardInstance = {
  id: "sabotage",
  name: "Sabotage",
  text: "Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card.",
  type: "spell",
  cost: cost(1, "body", 1),
  domains: ["body"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      effect: recycleFromOpponentHand("unit"),
    },
  ],
};

export const punchFirst: CardInstance = {
  id: "punch-first",
  name: "Punch First",
  text: "[Action] Give a unit +5 [M] this turn.",
  type: "spell",
  cost: cost(1, "body", 2),
  domains: ["body"],
  keywords: ["action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: modifyMight(5, "thisTurn"),
    },
  ],
};

export const inferna: CardInstance = {
  id: "inferna",
  name: "Inferna",
  tags: ["Bilgewater"],
  text: "[Ambush] [Assault 2]",
  type: "unit",
  cost: cost(2),
  might: 1,
  assault: 2,
  domains: ["fury"],
  keywords: ["ambush", "assault"],
  abilities: [],
};

export const irresistibleFaefolk: CardInstance = {
  id: "irresistible-faefolk",
  name: "Irresistible Faefolk",
  tags: ["Fae", "Ionia"],
  text: "When I move to a battlefield, you may move an enemy unit to that battlefield.",
  type: "unit",
  cost: cost(2),
  might: 1,
  domains: ["body"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self", to: "battlefield" },
      optional: true,
      targeting: { filters: [{ type: "unit", controller: "enemy" }] },
      // "that battlefield" is where the source now stands (R323.4's "here").
      effect: moveUnit("sourceLocation", 0),
    },
  ],
};

export const pitRookie: CardInstance = {
  id: "pit-rookie",
  name: "Pit Rookie",
  tags: ["Bilgewater"],
  text: "When you play me, buff another friendly unit.",
  type: "unit",
  cost: cost(2),
  might: 2,
  domains: ["body"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      targeting: {
        filters: [{ type: "unit", controller: "friendly", excludeSource: true }],
      },
      effect: buff(0),
    },
  ],
};

export const thrillOfTheHunt: CardInstance = {
  id: "thrill-of-the-hunt",
  name: "Thrill of the Hunt",
  tags: ["Rengar"],
  text: "[Reaction] Banish a friendly unit, then its owner plays it to any battlefield, ignoring its cost.",
  type: "spell",
  cost: cost(2, "body", 1),
  domains: ["fury", "body"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      // The destination is taken as a second choice at finalization — see the
      // survey's deviations for why that is slightly early.
      targeting: {
        filters: [
          { type: "unit", controller: "friendly" },
          { type: "battlefield" },
        ],
      },
      effect: banishThenPlay(0, 1),
    },
  ],
};

export const firstMate: CardInstance = {
  id: "first-mate",
  name: "First Mate",
  tags: ["Pirate", "Bilgewater"],
  text: "When you play me, ready another unit.",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["body"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      targeting: { filters: [{ type: "unit", excludeSource: true }] },
      effect: ready(0),
    },
  ],
};

export const grimApothecary: CardInstance = {
  id: "grim-apothecary",
  name: "Grim Apothecary",
  tags: ["Noxus"],
  text: "[Ambush] When you play me, you may return a friendly unit at a battlefield to its owner's hand.",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["fury"],
  keywords: ["ambush"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      optional: true,
      targeting: {
        filters: [
          { type: "unit", controller: "friendly", location: "battlefield" },
        ],
      },
      effect: returnToHand(0),
    },
  ],
};

export const kinkouInitiate: CardInstance = {
  id: "kinkou-initiate",
  name: "Kinkou Initiate",
  tags: ["Ionia"],
  text: "When you play me, draw 1 if your other units have total Might 5 or more.",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["body"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // The "if" comes after the instruction, so R383.2.a.1 makes it part of
      // the effect: the trigger fires either way and may do nothing.
      effect: ifThen(otherUnitsTotalMight(5), draw(1)),
    },
  ],
};

export const pyke: CardInstance = {
  id: "pyke",
  name: "Pyke, Dockside Butcher",
  tags: ["Pyke", "Bilgewater"],
  text: "[Hidden] [Ganking] You may pay [Fury] as an additional cost to play me. When you play me, if you paid the additional cost, ready me and give me +2 [M] this turn.",
  type: "unit",
  cost: cost(3),
  might: 2,
  domains: ["fury"],
  keywords: ["hidden", "ganking"],
  abilities: [
    additionalCost(cost(0, "fury", 1)),
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // R205 — the clause checks whether the game action was performed.
      requires: paidAdditionalCost,
      targetsSubject: true,
      effect: seq(ready(0), modifyMight(2, "thisTurn")),
    },
  ],
};

export const rampage: CardInstance = {
  id: "rampage",
  name: "Rampage",
  text: "As you play this, you may pay [Body] as an additional cost. Choose a friendly unit and an enemy unit. If you paid the additional cost, give the friendly unit +2 [M] this turn. They deal damage equal to their Mights to each other.",
  type: "spell",
  cost: cost(3),
  domains: ["body"],
  keywords: [],
  abilities: [
    additionalCost(cost(0, "body", 1)),
    {
      kind: "activated",
      timing: "default",
      costs: [],
      targeting: {
        filters: [
          { type: "unit", controller: "friendly" },
          { type: "unit", controller: "enemy" },
        ],
      },
      effect: seq(
        ifThen(paidAdditionalCost, modifyMight(2, "thisTurn", {}, 0)),
        mutualDamage(0, 1),
      ),
    },
  ],
};

export const nidalee: CardInstance = {
  id: "nidalee",
  name: "Nidalee, Cat Form",
  tags: ["Cat", "Ixtal", "Nidalee"],
  text: "[Ambush] When I win a combat, draw 1.",
  type: "unit",
  cost: cost(3, "body", 1),
  might: 4,
  domains: ["body"],
  keywords: ["ambush"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "combatWon", subject: "self" },
      effect: draw(1),
    },
  ],
};

export const kaisa: CardInstance = {
  id: "kaisa",
  name: "Kai'Sa, Survivor",
  tags: ["Kai'Sa"],
  text: "[Accelerate] When I conquer, draw 1.",
  type: "unit",
  cost: cost(4),
  might: 4,
  domains: ["fury"],
  keywords: ["accelerate"],
  abilities: [
    {
      kind: "triggered",
      // R471.2.a — a Conquer ability triggers at the battlefield conquered,
      // and R471.2's "at" includes the units standing on it.
      trigger: { on: "battlefieldScored", subject: "here", method: "conquer" },
      effect: draw(1),
    },
  ],
};

export const noxusHopeful: CardInstance = {
  id: "noxus-hopeful",
  name: "Noxus Hopeful",
  tags: ["Trifarian", "Noxus"],
  text: "[Legion] — I cost [2] less.",
  type: "unit",
  cost: cost(4),
  might: 4,
  domains: ["fury"],
  keywords: [],
  abilities: [legionCostReduction({ energy: 2 })],
};

export const ferrousForerunner: CardInstance = {
  id: "ferrous-forerunner",
  name: "Ferrous Forerunner",
  tags: ["Mech", "Yordle", "Bandle City"],
  text: "[Deathknell] — Play two 3 [M] Mech unit tokens to your base.",
  type: "unit",
  cost: cost(6, "fury", 1),
  might: 6,
  domains: ["fury"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "permanentKilled", subject: "self" },
      effect: createToken("mech", 2, { to: "base" }),
    },
  ],
};

export const emperorsDais: CardInstance = {
  id: "emperors-dais",
  name: "Emperor's Dais",
  text: "When you conquer here, you may pay [1] and return a unit you control here to its owner's hand. If you do, play a 2 [M] Sand Soldier unit token here.",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here", method: "conquer" },
      optional: true,
      // R383.3.b — "pay [1] and…" immediately after the "you may" is the
      // ability's base cost, so "if you do" is settled by finalizing at all.
      costs: [{ kind: "pay", cost: cost(1) }],
      targeting: {
        filters: [
          { type: "unit", controller: "friendly", atSource: true },
        ],
      },
      effect: seq(
        returnToHand(0),
        createToken("sandSoldier", 1, { to: "sourceLocation" }),
      ),
    },
  ],
};

export const seatOfPower: CardInstance = {
  id: "seat-of-power",
  name: "Seat of Power",
  text: "When you conquer here, draw 1 for each other battlefield you or allies control..",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here", method: "conquer" },
      effect: drawPerBattlefield({ excludeSource: true }),
    },
  ],
};

export const starSpring: CardInstance = {
  id: "star-spring",
  name: "Star Spring",
  text: "The first time a player plays a non-token unit here each turn, they may move another unit they control here to its base.",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "any", here: true, nonToken: true },
      // R383.3.e — "the first time … each turn".
      oncePerTurn: true,
      controllerIsEventPlayer: true,
      optional: true,
      targeting: {
        filters: [
          {
            type: "unit",
            controller: "friendly",
            atSource: true,
            excludeSource: true,
          },
        ],
      },
      effect: moveUnit("base", 0),
    },
  ],
};
