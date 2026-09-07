import {
  activated,
  addEnergy,
  additionalCost,
  atBattlefield,
  chosenCost,
  discard,
  draw,
  exhaustSelf,
  gainXP,
  ifThen,
  modifyMight,
  moveUnit,
  onlyInShowdowns,
  passive,
  predict,
  ready,
  readyRunes,
  repeat,
  restrictionAura,
  returnToHand,
  seq,
  attachSelf,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Cost, Domain } from "../state.js";

/**
 * Deck 5 — **Scorn of the Moon** (Mind / Chaos), the second list a player sent
 * to test with.
 *
 * Seven of its cards were already authored — Tideturner, Gust, Stacked Deck,
 * Star-Crossed, Vex Apathetic, Abandoned Hall and Star Spring — so they are not
 * repeated here.
 */

const cost = (energy: number, domain?: Domain, power = 0): Cost => ({
  energy,
  power: domain !== undefined && power > 0 ? { [domain]: power } : {},
  anyPower: 0,
});

export const scornOfTheMoon: CardInstance = {
  id: "scorn-of-the-moon",
  name: "Scorn of the Moon",
  tags: ["Diana"],
  text: "[Reaction] Exhaust: [Add] [1]. Spend this Energy only during showdowns.",
  type: "legend",
  cost: FREE,
  keywords: [],
  domains: ["chaos", "mind"],
  abilities: [
    // R160 — the restriction travels with the resources into their own bucket,
    // so it is a property of what was added rather than of the pool.
    activated([exhaustSelf], addEnergy(1, onlyInShowdowns), "reaction"),
  ],
};

export const dianaLunari: CardInstance = {
  id: "diana-lunari",
  name: "Diana, Lunari",
  supertypes: ["champion"],
  tags: ["Diana", "Mount Targon"],
  text: "When a showdown begins here, you may pay [1]. If you do, [Predict], then reveal the top card of your Main Deck. If it's a spell, draw it.",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["mind"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      // "When a showdown begins here" — R344's moment, not R459's. It was
      // authored as `combatStarted`, which is a whole focus round later and
      // is what Threshold of the Gray actually says.
      trigger: { on: "showdownOpened", subject: "here" },
      optional: true,
      // R383.3.b — "you may pay [1]" at the front of the effect is the
      // ability's base cost, paid to finalize.
      costs: [{ kind: "pay", cost: cost(1) }],
      effect: seq(
        predict(1),
        // R424.1.a.2 — the reveal leaves it on top; the arm is what draws it.
        { op: "branchOnCardType", of: "revealTop", arms: { spell: draw(1) } },
      ),
    },
  ],
};

export const hweiBroodingPainter: CardInstance = {
  id: "hwei-brooding-painter",
  name: "Hwei, Brooding Painter",
  supertypes: ["champion"],
  tags: ["Hwei", "Ionia"],
  text: "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's type: Spell — Draw 1. Gear — Ready up to 2 runes. Unit — Give me +3 [M] this turn.",
  type: "unit",
  cost: cost(5, "mind", 1),
  might: 5,
  domains: ["mind"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self" },
      targetsSubject: true,
      effect: seq(
        draw(1),
        // The discard and the branch are one op because the arms name what it
        // discarded, and there is no way to choose that ahead of time.
        {
          op: "branchOnCardType",
          of: "discardOne",
          arms: {
            spell: draw(1),
            gear: readyRunes(2),
            unit: modifyMight(3, "thisTurn"),
          },
        },
      ),
    },
  ],
};

export const travelingMerchant: CardInstance = {
  id: "traveling-merchant",
  name: "Traveling Merchant",
  tags: ["Bilgewater"],
  text: "When I move, discard 1, then draw 1.",
  type: "unit",
  cost: cost(2),
  might: 2,
  domains: ["chaos"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self" },
      effect: seq(discard(1), draw(1)),
    },
  ],
};

export const ravenbloomStudent: CardInstance = {
  id: "ravenbloom-student",
  name: "Ravenbloom Student",
  tags: ["Ionia"],
  text: "When you play a spell, give me +1 [M] this turn.",
  type: "unit",
  cost: cost(2),
  might: 2,
  domains: ["mind"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "spellPlayed", subject: "friendly" },
      // "give *me*" — the source is the subject, so nothing is chosen.
      targetsSubject: true,
      effect: modifyMight(1, "thisTurn"),
    },
  ],
};

export const thousandTailedWatcher: CardInstance = {
  id: "thousand-tailed-watcher",
  name: "Thousand-Tailed Watcher",
  tags: ["Ionia"],
  text: "[Accelerate] When you play me, give enemy units -3 [M] this turn, to a minimum of 1 [M].",
  type: "unit",
  cost: cost(7, "mind", 1),
  might: 7,
  domains: ["mind"],
  keywords: ["accelerate"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // R355.5.a — "enemy units" is a criterion, not a choice, so nothing is
      // targeted: [Deflect] does not tax it and a warded unit is caught.
      effect: {
        op: "modifyMightEach",
        who: "enemy",
        amount: -3,
        duration: "thisTurn",
        min: 1,
      },
    },
  ],
};

export const fizzTrickster: CardInstance = {
  id: "fizz-trickster",
  name: "Fizz, Trickster",
  supertypes: ["champion"],
  tags: ["Fizz", "Bilgewater"],
  text: "When you play me, you may play a spell from your trash with Energy cost no more than [3], ignoring its Energy cost. Recycle that spell after you play it.",
  type: "unit",
  cost: cost(3, "chaos", 1),
  might: 3,
  domains: ["chaos"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // Grants the permission rather than performing the play, so the spell
      // goes through R354's real steps and chooses its own targets. The cost
      // is timing — it may be taken later in the turn. Written up.
      effect: {
        op: "grantPlayFromTrash",
        cardType: "spell",
        maxEnergy: 3,
        waiveEnergy: true,
        recycleOnLeave: true,
        duration: "thisTurn",
      },
    },
  ],
};

export const rideTheWind: CardInstance = {
  id: "ride-the-wind",
  name: "Ride the Wind",
  text: "[Action] Move a friendly unit and ready it.",
  type: "spell",
  cost: cost(2, "chaos", 1),
  domains: ["chaos"],
  keywords: ["action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      effect: seq(moveUnit("base", 0), ready(0)),
    },
  ],
};

export const flash: CardInstance = {
  id: "flash",
  name: "Flash",
  text: "[Reaction] Move up to 2 friendly units to base.",
  type: "spell",
  cost: cost(2),
  domains: ["chaos"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      // "up to 2" is two optional filters: each keeps its position and is
      // answered with NO_TARGET when declined.
      targeting: {
        filters: [
          { type: "unit", controller: "friendly", optional: true },
          { type: "unit", controller: "friendly", optional: true },
        ],
      },
      effect: seq(moveUnit("base", 0), moveUnit("base", 1)),
    },
  ],
};

export const moonfall: CardInstance = {
  id: "moonfall",
  name: "Moonfall",
  supertypes: ["signature"],
  tags: ["Diana"],
  text: "[Action] Choose a battlefield where you have units. You may move up to one enemy unit to that battlefield. Then give enemy units there -2 [M] this turn.",
  type: "spell",
  cost: cost(3, "mind", 1),
  domains: ["chaos", "mind"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      targeting: {
        filters: [
          { type: "battlefield", withYourUnits: true },
          { type: "unit", controller: "enemy", optional: true },
        ],
      },
      effect: seq(
        // R420 — moving as an effect, to the battlefield chosen first.
        { op: "moveUnit", targetIndex: 1, to: "chosenBattlefield", atTargetIndex: 0 },
        {
          op: "modifyMightEach",
          who: "enemy",
          atTargetIndex: 0,
          amount: -2,
          duration: "thisTurn",
        },
      ),
    },
  ],
};

export const eclipse: CardInstance = {
  id: "eclipse",
  name: "Eclipse",
  text: "[Reaction] Give a unit -4 [M] this turn. [Predict].",
  type: "spell",
  cost: cost(3),
  domains: ["mind"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: seq(modifyMight(-4, "thisTurn"), predict(1)),
    },
  ],
};

export const lastRites: CardInstance = {
  id: "last-rites",
  name: "Last Rites",
  tags: ["Equipment"],
  text: "[Equip] — [Chaos], Recycle 2 cards from your trash",
  type: "gear",
  cost: cost(3),
  domains: ["chaos"],
  keywords: [],
  attachment: { mightBonus: 2, keywords: [] },
  abilities: [
    {
      kind: "activated",
      timing: "default",
      // R818's Equip cost, with a non-resource half: R416.1 sends the recycled
      // cards to the bottom of the Main Deck, and R355.1 puts the choice of
      // which in the action that plays it.
      costs: [
        { kind: "pay", cost: cost(0, "chaos", 1) },
        { kind: "chosen", does: "recycle", fromTrash: true, count: 2 },
      ],
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      effect: attachSelf(0),
    },
  ],
};

export const theSyren: CardInstance = {
  id: "the-syren",
  name: "The Syren",
  text: "[1], Exhaust: Move a friendly unit at a battlefield to your base.",
  type: "gear",
  cost: cost(2),
  domains: ["chaos"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [{ kind: "pay", cost: cost(1) }, exhaustSelf],
      targeting: {
        filters: [
          { type: "unit", controller: "friendly", location: "battlefield" },
        ],
      },
      effect: moveUnit("base", 0),
    },
  ],
};

export const stupefy: CardInstance = {
  id: "stupefy",
  name: "Stupefy",
  text: "[Reaction] Give a unit -1 [M] this turn, to a minimum of 1 [M]. Draw 1.",
  type: "spell",
  cost: cost(1),
  domains: ["mind"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      // R477.3.b's limitation, applied once at this moment and remembered at
      // the limited level.
      effect: seq(
        { op: "modifyMight", amount: -1, duration: "thisTurn", min: 1, targetIndex: 0 },
        draw(1),
      ),
    },
  ],
};

export const abandon: CardInstance = {
  id: "abandon",
  name: "Abandon",
  text: "[Reaction] Counter a spell. Return it to its owner's hand instead of putting it in their trash. [Predict].",
  type: "spell",
  cost: cost(2),
  domains: ["chaos"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "spellOnChain", controller: "enemy" }] },
      // R56 — the *owner's* hand, replacing R359.3.d's destination rather
      // than adding to it.
      effect: seq(
        { op: "counterSpell", targetIndex: 0, to: "hand" },
        predict(1),
      ),
    },
  ],
};

export const hardBargain: CardInstance = {
  id: "hard-bargain",
  name: "Hard Bargain",
  text: "[Reaction] [Repeat] [2] Counter a spell unless its controller pays [2].",
  type: "spell",
  cost: cost(2),
  domains: ["chaos"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "spellOnChain", controller: "enemy" }] },
      // The only card in the pool that asks the *opponent* a question while it
      // resolves. R320.1's decisions already name who they are addressed to.
      effect: { op: "counterUnlessPaid", targetIndex: 0, cost: cost(2) },
    },
    repeat({ energy: 2 }),
  ],
};

export const rockfallPath: CardInstance = {
  id: "rockfall-path",
  name: "Rockfall Path",
  text: "Units can't be played here.",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    // R190.6.d — it names no side, so it applies whoever holds it, including
    // nobody.
    restrictionAura("play", "any", { here: true, match: { type: "unit" } }),
  ],
};
