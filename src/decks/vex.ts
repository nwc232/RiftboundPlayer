import {
  aloneThere,
  allOf,
  atBattlefield,
  attachSelf,
  counterSpell,
  discountNextCard,
  draw,
  exhaustSelf,
  ifThen,
  lookAtTop,
  modifyMight,
  moveUnit,
  onYourTurn,
  playPermission,
  playedFrom,
  restrictMovement,
  returnToHand,
  seq,
  stun,
  swapLocations,
  swapMight,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Cost, Domain } from "../state.js";

/**
 * Deck 1 — **Vex, Gloomist** (Chaos / Calm). Authored from the printed cards;
 * every ability cites the rule that decided how it is expressed. The full list
 * and what each card needed lives in `reference/decks.md`.
 */

const cost = (energy: number, domain?: Domain, power = 0): Cost => ({
  energy,
  power: domain !== undefined && power > 0 ? { [domain]: power } : {},
  anyPower: 0,
});

/** "When you or an ally hold, you may exhaust me to draw 1." */
export const gloomist: CardInstance = {
  id: "gloomist",
  name: "Gloomist",
  type: "legend",
  cost: FREE,
  keywords: [],
  domains: ["calm", "chaos"],
  abilities: [
    {
      kind: "triggered",
      // R107.4.b — the Legend Zone is not a location, so it holds nothing
      // "here"; the subject is the controller.
      trigger: { on: "battlefieldScored", subject: "controller", method: "hold" },
      optional: true,
      // R383.3.b — "exhaust me to" at the front of the effect is the base cost.
      costs: [exhaustSelf],
      effect: draw(1),
    },
  ],
};

/** "[Deflect] · When an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn." */
export const vexApathetic: CardInstance = {
  id: "vex-apathetic",
  name: "Vex, Apathetic",
  type: "unit",
  cost: cost(4),
  might: 4,
  domains: ["chaos"],
  keywords: ["deflect"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "enemy" },
      // R383.2.a.1 — "while I'm at a battlefield" sits immediately after the
      // condition, so it gates the trigger rather than the effect.
      requires: atBattlefield,
      // "it" is named by the condition, so there is nothing to choose.
      targetsSubject: true,
      effect: seq(stun(0), restrictMovement("thisTurn", 0)),
    },
  ],
};

/** "[Hidden] [Backline] · When you play me from face down on your turn, you may move an enemy unit at a different location to my battlefield." */
export const evelynn: CardInstance = {
  id: "evelynn",
  name: "Evelynn, Entrancing",
  type: "unit",
  cost: cost(2),
  might: 2,
  domains: ["chaos"],
  keywords: ["hidden", "backline"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // R811.3 lets a [Hidden] card be played normally instead, so both halves
      // of this gate matter.
      requires: allOf(playedFrom("facedown"), onYourTurn),
      optional: true,
      targeting: {
        filters: [{ type: "unit", controller: "enemy", awayFromSource: true }],
      },
      effect: moveUnit("sourceLocation", 0),
    },
  ],
};

/** "[Reaction] Give a friendly unit +1 [M] this turn, then an additional +1 [M] this turn if it is the only unit you control there." */
export const enGarde: CardInstance = {
  id: "en-garde",
  name: "En Garde",
  type: "spell",
  cost: cost(1),
  domains: ["calm"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      // R383.2.a.1's other half — the "if" comes after the instruction, so it
      // is asked on resolution.
      effect: seq(
        modifyMight(1, "thisTurn"),
        ifThen(aloneThere("target", "friendly"), modifyMight(1, "thisTurn")),
      ),
    },
  ],
};

/** "[Reaction] Return a unit at a battlefield with 3 [M] or less to its owner's hand." */
export const gust: CardInstance = {
  id: "gust",
  name: "Gust",
  type: "spell",
  cost: cost(1),
  domains: ["chaos"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: {
        filters: [{ type: "unit", location: "battlefield", maxMight: 3 }],
      },
      effect: returnToHand(0),
    },
  ],
};

/** "[Action] Look at the top 3 cards of your Main Deck. Put 1 into your hand and recycle the rest." */
export const stackedDeck: CardInstance = {
  id: "stacked-deck",
  name: "Stacked Deck",
  type: "spell",
  cost: cost(1),
  domains: ["chaos"],
  keywords: ["action"],
  abilities: [
    { kind: "activated", timing: "action", costs: [], effect: lookAtTop(3, 1) },
  ],
};

/** "[Reaction] Counter a spell that costs no more than [4] and no more than [A]." */
export const defy: CardInstance = {
  id: "defy",
  name: "Defy",
  type: "spell",
  cost: cost(1, "calm", 1),
  domains: ["calm"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: {
        filters: [{ type: "spellOnChain", maxEnergy: 4, maxPower: 1 }],
      },
      effect: counterSpell(0),
    },
  ],
};

/** "[Reaction] Give a unit +2 [M] this turn. Draw 1." */
export const discipline: CardInstance = {
  id: "discipline",
  name: "Discipline",
  type: "spell",
  cost: cost(2),
  domains: ["calm"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: seq(modifyMight(2, "thisTurn"), draw(1)),
    },
  ],
};

/** "[Hidden] · When you play me, you may choose a friendly unit. Move me to its location and it to my original location." */
export const tideturner: CardInstance = {
  id: "tideturner",
  name: "Tideturner",
  type: "unit",
  cost: cost(2),
  might: 2,
  domains: ["chaos"],
  keywords: ["hidden"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // R383.3.a — "you may" as the first clause, so it is decided at
      // finalization rather than on resolution.
      optional: true,
      targeting: {
        filters: [{ type: "unit", controller: "friendly", excludeSource: true }],
      },
      effect: swapLocations(0),
    },
  ],
};

/** "[Action] Return a unit at a battlefield to its owner's hand." */
export const rebuke: CardInstance = {
  id: "rebuke",
  name: "Rebuke",
  type: "spell",
  cost: cost(2, "chaos", 2),
  domains: ["chaos"],
  keywords: ["action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      targeting: { filters: [{ type: "unit", location: "battlefield" }] },
      effect: returnToHand(0),
    },
  ],
};

/** "[Hidden] [Action] Swap the Might of two units at the same battlefield this turn." */
export const switcheroo: CardInstance = {
  id: "switcheroo",
  name: "Switcheroo",
  type: "spell",
  cost: cost(2, "chaos", 2),
  domains: ["chaos"],
  keywords: ["hidden", "action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      // "at the same battlefield" ties the second choice to the first, which
      // a positional filter cannot say — see the survey's deviations.
      targeting: {
        filters: [
          { type: "unit", location: "battlefield" },
          { type: "unit", location: "battlefield" },
        ],
      },
      effect: swapMight("thisTurn"),
    },
  ],
};

/** "[Hidden] [Action] [Stun] a unit. If you played this from your hand, draw 1." */
export const backOff: CardInstance = {
  id: "back-off",
  name: "Back Off",
  type: "spell",
  cost: cost(3),
  domains: ["calm"],
  keywords: ["hidden", "action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: seq(stun(0), ifThen(playedFrom("hand"), draw(1))),
    },
  ],
};

/** "[Equip] [Chaos] · +2 [M] · [Ganking]" */
export const bootsOfSwiftness: CardInstance = {
  id: "boots",
  name: "Boots of Swiftness",
  type: "gear",
  cost: cost(3),
  domains: ["chaos"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      // R818.1.c.2 — "[Cost]: Attach this gear to a unit you control."
      costs: [{ kind: "pay", cost: cost(0, "chaos", 1) }],
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      effect: attachSelf(0),
    },
  ],
  // R718.3/R718.4 — the Effect Text and Might Bonus, which go to the host.
  attachment: { mightBonus: 2, keywords: ["ganking"] },
};

/** "You may play me to an open battlefield." */
export const sneakyDeckhand: CardInstance = {
  id: "sneaky-deckhand",
  name: "Sneaky Deckhand",
  type: "unit",
  cost: cost(3),
  might: 2,
  domains: ["chaos"],
  keywords: [],
  abilities: [playPermission({ kind: "openBattlefield" })],
};

/** "[Reaction] Return a friendly unit and an enemy unit to their owners' hands." */
export const starCrossed: CardInstance = {
  id: "star-crossed",
  name: "Star-Crossed",
  type: "spell",
  cost: cost(3, "chaos", 1),
  domains: ["chaos"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: {
        filters: [
          { type: "unit", controller: "friendly" },
          { type: "unit", controller: "enemy" },
        ],
      },
      effect: seq(returnToHand(0), returnToHand(1)),
    },
  ],
};

/** "[Ambush] · When I attack or defend, if an enemy unit is alone here, give me +2 [M] this turn and gain 2 XP." */
export const khazix: CardInstance = {
  id: "khazix",
  name: "Kha'Zix, Mutating Horror",
  type: "unit",
  cost: cost(4, "chaos", 1),
  might: 4,
  domains: ["chaos"],
  keywords: ["ambush"],
  abilities: [
    {
      kind: "triggered",
      // No designation given — R464.2.c.3 covers "attack **or** defend".
      trigger: { on: "designated", subject: "self" },
      requires: aloneThere("source", "enemy"),
      targetsSubject: true,
      effect: seq(modifyMight(2, "thisTurn"), { op: "gainXP", amount: 2 }),
    },
  ],
};

/** "When you play your first card each turn, if I'm at a battlefield, your next card costs [2][A][A] less." */
export const astralHeron: CardInstance = {
  id: "astral-heron",
  name: "Astral Heron",
  type: "unit",
  cost: cost(7),
  might: 7,
  domains: ["calm"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "cardPlayed", subject: "friendly" },
      // R383.3.e — "the first … each turn". R383.2.a.1 — "if I'm at a
      // battlefield" gates the trigger, since it follows the condition.
      oncePerTurn: true,
      requires: atBattlefield,
      effect: discountNextCard({ energy: 2, power: {}, anyPower: 2 }),
    },
  ],
};

/** "[Ambush] · Enemy units here with less Might than me don't deal combat damage. · When I hold, draw 1." */
export const vilemaw: CardInstance = {
  id: "vilemaw",
  name: "Vilemaw",
  type: "unit",
  cost: cost(8, "calm", 2),
  might: 8,
  domains: ["calm"],
  keywords: ["ambush"],
  abilities: [
    {
      kind: "passive",
      // The Might comparison is relative to the source, so it lives here
      // rather than in a condition, which only ever sees the subject.
      scope: { target: "enemyUnits", here: true, weakerThanSource: true },
      modification: { layer: "ability", op: "silenceCombatDamage" },
    },
    {
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here", method: "hold" },
      effect: draw(1),
    },
  ],
};

/** "When you conquer here, ready 2 runes at the end of this turn." */
export const targonsPeak: CardInstance = {
  id: "targons-peak",
  name: "Targon's Peak",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here", method: "conquer" },
      effect: { op: "delay", at: "endOfTurn", effect: { op: "readyRunes", count: 2 } },
    },
  ],
};

/** "When a player plays a spell, they may give a unit they control here +1 [M] this turn." */
export const abandonedHall: CardInstance = {
  id: "abandoned-hall",
  name: "Abandoned Hall",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "spellPlayed", subject: "any" },
      // "they" — the ability belongs to whoever played the spell, not to the
      // battlefield's controller, and every "you" in it follows.
      controllerIsEventPlayer: true,
      optional: true,
      targeting: {
        filters: [{ type: "unit", controller: "friendly", atSource: true }],
      },
      effect: modifyMight(1, "thisTurn"),
    },
  ],
};

/** "When combat starts here, the attacker and defender each [Add] [1]." */
export const thresholdOfTheGray: CardInstance = {
  id: "threshold-of-the-gray",
  name: "Threshold of the Gray",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "combatStarted", subject: "here" },
      effect: { op: "addEnergyToEach", amount: 1 },
    },
  ],
};
