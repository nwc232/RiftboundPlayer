import {
  activated,
  additionalCost,
  attachSelf,
  atBattlefield,
  dealDamage,
  draw,
  empower,
  exhaustSelf,
  flow,
  gainXP,
  grantKeywordFor,
  ifThen,
  kill,
  modifyMight,
  moveUnit,
  onYourTurn,
  passive,
  ready,
  recall,
  replacesDeath,
  reveal,
  restrict,
  scorePoint,
  seeFacedown,
  seq,
  stun,
  repeat,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Cost, Domain } from "../state.js";

/**
 * Deck 4 — **Rogue Assassin** (Calm / Fury), sent by a player who wanted to
 * test with it. Authored from the printed cards, like the others.
 *
 * Seven of its cards were already authored for the first two decks — Discipline,
 * Defy, Back Off, Astral Heron and all three battlefields — so they are not
 * repeated here. What the rest needed is in `reference/decks.md`.
 */

const cost = (energy: number, domain?: Domain, power = 0): Cost => ({
  energy,
  power: domain !== undefined && power > 0 ? { [domain]: power } : {},
  anyPower: 0,
});

/** A cost of `energy` plus `any` Power of any domain (R135.2.e.6.c's [A]). */
const anyCost = (energy: number, any: number): Cost => ({
  energy,
  power: {},
  anyPower: any,
});

export const rogueAssassin: CardInstance = {
  id: "rogue-assassin",
  name: "Rogue Assassin",
  tags: ["Akali"],
  text: "[Empower] [3][A] [Action] Exhaust: If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it.",
  type: "legend",
  cost: FREE,
  keywords: [],
  domains: ["calm", "fury"],
  abilities: [
    // R827.1.c.1 — [Empower] expands into its own activated ability. R107.4.c
    // makes the Legend a Game Object, so it can carry the status; having no
    // permanent, it carries it on the player.
    empower(anyCost(3, 1)),
    {
      kind: "activated",
      timing: "action",
      costs: [exhaustSelf],
      // "If it's your turn" is a gate on playing the ability, not a check on
      // resolution — R827.1.c.1's shape.
      when: onYourTurn,
      // R323.2's designations are what "in a showdown" reads: a unit is in one
      // because it is wearing a designation, not because a combat exists.
      targeting: {
        filters: [{ type: "unit", controller: "friendly", designation: "either" }],
      },
      effect: seq(
        moveUnit("base", 0),
        // R828 — "and if I'm [Empowered]" is asked as it resolves, so it is a
        // conditional rather than a dependent ability.
        ifThen({ kind: "empowered" }, ready(0)),
      ),
    },
  ],
};

export const akaliDeadlyWeapon: CardInstance = {
  id: "akali-deadly-weapon",
  name: "Akali, Deadly Weapon",
  supertypes: ["champion"],
  tags: ["Akali", "Ionia"],
  text: "[Empower] [2][Fury] When I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead. [Empowered] I have +1 [M].",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["fury"],
  keywords: [],
  abilities: [
    empower(cost(2, "fury", 1)),
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self" },
      optional: true,
      // "to or from" — neither end is where she is by the time this resolves:
      // she is standing at the destination, and "from" is a battlefield she
      // has already left. R359.3.f.3 lets the trigger note both.
      targeting: { filters: [{ type: "unit", atMoveEndpoint: true }] },
      effect: ifThen({ kind: "empowered" }, dealDamage(2), dealDamage(1)),
    },
    passive({ target: "self" }, {
      layer: "arithmetic",
      op: "addMight",
      amount: 1,
    }, { when: "empowered" }),
  ],
};

export const scuttleCrab: CardInstance = {
  id: "scuttle-crab",
  name: "Scuttle Crab",
  tags: ["Bilgewater"],
  text: "When you play me, draw 1. [Deathknell] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. Gain 1 XP.",
  type: "unit",
  cost: cost(2),
  // R470's scoring has no Might requirement, so a 0 Might unit conquers and
  // holds like any other — the reminder text is a reminder.
  might: 0,
  domains: ["calm"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      effect: draw(1),
    },
    {
      kind: "triggered",
      // [Deathknell] is "when I die, get the effect" — a death trigger with a
      // keyword's name on it.
      trigger: { on: "permanentKilled", subject: "self" },
      targeting: { filters: [{ type: "player", controller: "enemy" }] },
      effect: seq(
        reveal("hand", undefined, 0),
        // R424.2.b — looking is explicitly *not* revealing, so this grants the
        // looking and triggers nothing that watches for a reveal.
        seeFacedown("thisTurn"),
        gainXP(1),
      ),
    },
  ],
};

export const zhonyasHourglass: CardInstance = {
  id: "zhonyas-hourglass",
  name: "Zhonya's Hourglass",
  text: "[Hidden] The next time a friendly unit would die, kill this instead. Recall that unit exhausted.",
  type: "gear",
  cost: cost(2),
  domains: ["calm"],
  keywords: ["hidden"],
  abilities: [
    // R369 — a replacement, so the unit does not die and no Deathknell fires
    // for it. R454 makes the recall not a move.
    replacesDeath(
      { target: "friendlyUnits", here: false },
      seq({ op: "killSelf" }, recall(0), { op: "exhaust", targetIndex: 0 }),
      { oncePerTurn: true },
    ),
  ],
};

export const shurikenFlip: CardInstance = {
  id: "shuriken-flip",
  name: "Shuriken Flip",
  supertypes: ["signature"],
  tags: ["Akali"],
  text: "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit. [Flow] [3][A]",
  type: "spell",
  cost: cost(1, "calm", 1),
  domains: ["calm", "fury"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      // "up to one" keeps its position and is answered with NO_TARGET when
      // declined, so the second filter stays at index 1.
      targeting: {
        filters: [
          {
            type: "unit",
            controller: "enemy",
            location: "battlefield",
            optional: true,
          },
          { type: "unit", controller: "friendly" },
        ],
      },
      effect: seq(dealDamage(2, 0), moveUnit("base", 1)),
    },
    flow(anyCost(3, 1)),
  ],
};

export const stellacornHerder: CardInstance = {
  id: "stellacorn-herder",
  name: "Stellacorn Herder",
  tags: ["Mount Targon"],
  text: "When I move, draw 1.",
  type: "unit",
  cost: cost(4),
  might: 3,
  domains: ["calm"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self" },
      effect: draw(1),
    },
  ],
};

export const jhinMurderousArtist: CardInstance = {
  id: "jhin-murderous-artist",
  name: "Jhin, Murderous Artist",
  supertypes: ["champion"],
  tags: ["Jhin", "Ionia"],
  text: "[Deflect] [Ganking] When I move, [Add] [1][A].",
  type: "unit",
  cost: cost(4, "fury", 1),
  might: 4,
  domains: ["fury"],
  keywords: ["deflect", "ganking"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self" },
      effect: seq(
        { op: "addEnergy", amount: 1 },
        { op: "addPower", domain: "selfDomain", amount: 1 },
      ),
    },
  ],
};

export const block: CardInstance = {
  id: "block",
  name: "Block",
  text: "[Hidden] [Action] Give a unit [Shield 3] and [Tank] this turn.",
  type: "spell",
  cost: cost(2),
  domains: ["calm"],
  keywords: ["hidden", "action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      // R814.2 — a granted Shield value is summed rather than redundant, so
      // the value travels with the grant.
      effect: seq(
        grantKeywordFor("shield", "thisTurn", 0, 3),
        grantKeywordFor("tank", "thisTurn", 0),
      ),
    },
  ],
};

export const longSword: CardInstance = {
  id: "long-sword",
  name: "Long Sword",
  tags: ["Equipment"],
  text: "[Quick-Draw] [Equip] [Fury]",
  type: "gear",
  cost: cost(2, "fury", 1),
  domains: ["fury"],
  // R819.1.d — [Quick-Draw] is short for [Reaction] plus "when you play this,
  // attach it to a unit you control", both derived rather than written here.
  keywords: ["quickDraw"],
  attachment: { mightBonus: 2, keywords: [] },
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [{ kind: "pay", cost: cost(0, "fury", 1) }],
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      effect: attachSelf(0),
    },
  ],
};

export const fallingStar: CardInstance = {
  id: "falling-star",
  name: "Falling Star",
  text: "Deal 3 to a unit. Deal 3 to a unit.",
  type: "spell",
  cost: cost(2, "fury", 2),
  domains: ["fury"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      // R355.5.a — two filters rather than one asking for two, because they
      // are answered separately and one object cannot answer both.
      targeting: { filters: [{ type: "unit" }, { type: "unit" }] },
      effect: seq(dealDamage(3, 0), dealDamage(3, 1)),
    },
  ],
};

export const thwonk: CardInstance = {
  id: "thwonk",
  name: "Thwonk!",
  text: "[Action] [Repeat] [2] Stun an attacking unit.",
  type: "spell",
  cost: cost(2),
  domains: ["calm"],
  keywords: ["action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      // R323.2 hands out the designation; this reads the one being worn.
      targeting: { filters: [{ type: "unit", designation: "attacker" }] },
      effect: stun(0),
    },
    repeat({ energy: 2 }),
  ],
};

export const akaliSilent: CardInstance = {
  id: "akali-silent",
  name: "Akali, Silent",
  supertypes: ["champion"],
  tags: ["Akali", "Ionia"],
  text: "I can't be chosen by enemy spells and abilities unless I'm in combat. When I move to a battlefield, give me +2 [M] this turn.",
  type: "unit",
  cost: cost(4, "calm", 1),
  might: 4,
  domains: ["calm"],
  keywords: [],
  abilities: [
    // "unless" is the exception half, not a negated condition: a defender is
    // in combat and is not attacking.
    {
      ...restrict({ what: "beChosen", by: "enemy" }),
      unless: { when: "inCombat" },
    },
    {
      kind: "triggered",
      trigger: { on: "unitMoved", subject: "self", to: "battlefield" },
      targetsSubject: true,
      effect: modifyMight(2, "thisTurn"),
    },
  ],
};

export const nasusAscended: CardInstance = {
  id: "nasus-ascended",
  name: "Nasus, Ascended",
  supertypes: ["champion"],
  tags: ["Nasus", "Shurima"],
  text: "[Deflect 2] [Empower] [8] [Empowered] When I conquer, you score 1 point.",
  type: "unit",
  cost: cost(8, "calm", 1),
  might: 8,
  domains: ["calm"],
  keywords: ["deflect"],
  deflect: 2,
  abilities: [
    empower(cost(8)),
    // R828.1.d — the granted ability is a trigger, active only while the
    // status holds. R471.1.a's near-victory restriction does not catch it:
    // scoring directly is not conquering.
    {
      ...passive({ target: "self" }, {
        layer: "ability",
        op: "grantAbility",
        ability: {
          kind: "triggered",
          trigger: { on: "battlefieldScored", subject: "here", method: "conquer" },
          effect: scorePoint(1),
        },
      }, { when: "empowered" }),
    },
  ],
};

export const brittleSteel: CardInstance = {
  id: "brittle-steel",
  name: "Brittle Steel",
  text: "Kill a gear. [Flow] [4][Fury]",
  type: "spell",
  cost: cost(2, "fury", 1),
  domains: ["fury"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      targeting: { filters: [{ type: "gear" }] },
      effect: kill(0),
    },
    flow(cost(4, "fury", 1)),
  ],
};

export const perfectExecution: CardInstance = {
  id: "perfect-execution",
  name: "Perfect Execution",
  text: "Ready a unit and give it [Assault 3] this turn. [Flow] [3][Fury]",
  type: "spell",
  cost: cost(3, "fury", 1),
  domains: ["fury"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: seq(ready(0), grantKeywordFor("assault", "thisTurn", 0, 3)),
    },
    flow(cost(3, "fury", 1)),
  ],
};
