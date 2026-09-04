import {
  activated,
  dealDamage,
  draw,
  addEnergy,
  addPower,
  basicRune,
  counterSpell,
  createToken,
  exhaustSelf,
  spell,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Domain, GameState, Keyword } from "../state.js";
import { beginTurn } from "../tasks.js";

/**
 * A small hand-authored sample using real Riftbound cards. Costs and domains
 * come from the card database in /reference; the units chosen are ones with no
 * printed rules text, so nothing here is faked to look more finished than it is.
 *
 * The two battlefields are placeholders — real battlefields carry abilities we
 * cannot model yet, so these are bare locations to move between.
 */

function vanillaUnit(
  id: string,
  name: string,
  energy: number,
  might: number,
  domain: Domain,
  keywords: Keyword[] = [],
): CardInstance {
  return {
    id,
    name,
    type: "unit",
    cost: { ...FREE, energy },
    domain,
    keywords,
    might,
    abilities: [],
  };
}

export const SAMPLE_CARDS: CardInstance[] = [
  // [Assault] — +1 Might while it holds the Attacker designation (R807).
  vanillaUnit("skulker", "Shipyard Skulker", 3, 3, "chaos", ["assault"]),
  vanillaUnit("sergeant", "Vanguard Sergeant", 4, 4, "order"),
  // Not printed with Ganking — given it here so the keyword is exercisable.
  vanillaUnit("phantom", "Playful Phantom", 5, 5, "calm", ["ganking"]),
  // Cloud Drake — "When you play me, draw 1." (6 energy, 5 Might)
  {
    ...vanillaUnit("drake", "Cloud Drake", 6, 5, "calm"),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: draw(1),
      },
    ],
  },
  // Riptide Rex — "When you play me, deal 6 to an enemy unit at a battlefield."
  {
    ...vanillaUnit("rex", "Riptide Rex", 6, 6, "chaos"),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: dealDamage(6),
        targeting: {
          filters: [{ type: "unit", controller: "enemy", location: "battlefield" }],
        },
      },
    ],
  },
  // Incinerate — "[Action] Deal 2 to a unit at a battlefield." (2 energy)
  spell("incinerate", "Incinerate", { ...FREE, energy: 2 }, dealDamage(2), [
    "action",
  ]),
  // Wind Wall — "[Reaction] Counter a spell." (3 energy + 2 calm)
  spell(
    "windwall",
    "Wind Wall",
    { ...FREE, energy: 3, power: { calm: 2 } },
    counterSpell(),
    ["reaction"],
  ),
  // Mirror Image — "Choose a unit. Play a ready Reflection unit token to your
  // base. It becomes a copy of that unit. Give it [Temporary]." (3e + 2 mind)
  spell(
    "mirror",
    "Mirror Image",
    { ...FREE, energy: 3, power: { mind: 2 } },
    createToken("reflection", 1, {
      ready: true,
      copyOfTarget: 0,
      grants: ["temporary"],
    }),
  ),
  // Honest Broker — "[Deathknell] Play a Gold gear token exhausted."
  {
    ...vanillaUnit("broker", "Honest Broker", 2, 2, "order"),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "permanentKilled", subject: "self" },
        effect: createToken("gold"),
      },
    ],
  },
  {
    id: "conduit",
    name: "Energy Conduit",
    type: "gear",
    cost: FREE,
    keywords: [],
    abilities: [activated([exhaustSelf], addEnergy(1), "reaction")],
  },
  // p2's garrison, so combat is reachable in the demo. The two identical
  // Watchmen sit in the same assignment band as each other, which is what makes
  // damage assignment a real choice rather than a forced order (R465.2.c.7).
  // [Shield] — +1 Might while it holds the Defender designation (R814).
  vanillaUnit("grunt", "Sentry Grunt", 2, 2, "order", ["tank", "shield"]),
  vanillaUnit("watch-a", "Watchman", 1, 1, "order"),
  vanillaUnit("watch-b", "Watchman", 1, 1, "order"),
  vanillaUnit("archer", "Backline Archer", 2, 2, "order", ["backline"]),
  {
    id: "seal-rage",
    name: "Seal of Rage",
    type: "gear",
    cost: FREE,
    keywords: [],
    abilities: [activated([exhaustSelf], addPower("fury", 1), "reaction")],
  },
];

const BATTLEFIELDS: CardInstance[] = [
  { id: "bf-north", name: "North Battlefield", type: "battlefield", cost: FREE, keywords: [], abilities: [] },
  { id: "bf-south", name: "South Battlefield", type: "battlefield", cost: FREE, keywords: [], abilities: [] },
];

const RUNES: CardInstance[] = [
  basicRune("rune-1", "fury"),
  basicRune("rune-2", "fury"),
  basicRune("rune-3", "order"),
  basicRune("rune-4", "order"),
  basicRune("rune-5", "chaos"),
  basicRune("rune-6", "calm"),
  // Mind runes, so Mirror Image's 2 Mind Power is actually payable.
  basicRune("rune-7", "mind"),
  basicRune("rune-8", "mind"),
];

/** p1 starts mid-turn: beginTurn runs Awaken through Draw and leaves us in Main. */
export function makeDemoState(): GameState {
  return beginTurn(emptyBoard(), "p1", 1).state;
}

function emptyBoard(): GameState {
  const cards: GameState["cards"] = {};
  for (const card of [...SAMPLE_CARDS, ...BATTLEFIELDS, ...RUNES]) {
    cards[card.id] = card;
  }

  return {
    turn: { player: "p1", phase: "main", number: 1 },
    mode: "duel",
    turnOrder: ["p1", "p2"],
    players: {
      p1: {
        id: "p1",
        mainDeck: ["rex", "skulker", "mirror", "broker", "incinerate", "drake", "sergeant", "phantom"],
        hand: [],
        trash: [],
        banished: [],
        legend: null,
        champion: null,
        runeDeck: RUNES.map((rune) => rune.id),
        runes: [],
        runePool: { buckets: [] },
        points: 0,
        scoredThisTurn: [],
        xp: 0,
      },
      p2: {
        id: "p2",
        mainDeck: [],
        hand: [],
        trash: [],
        banished: [],
        legend: null,
        champion: null,
        runeDeck: [],
        runes: [],
        runePool: { buckets: [] },
        points: 0,
        scoredThisTurn: [],
        xp: 0,
      },
    },
    cards,
    permanents: {
      conduit: {
        cardId: "conduit",
        controller: "p1",
        exhausted: false,
        location: { kind: "base", player: "p1" },
        damage: 0,
      },
      "seal-rage": {
        cardId: "seal-rage",
        controller: "p1",
        exhausted: false,
        location: { kind: "base", player: "p1" },
        damage: 0,
      },
      grunt: {
        cardId: "grunt",
        controller: "p2",
        exhausted: false,
        location: { kind: "battlefield", id: "bf-south" },
        damage: 0,
      },
      "watch-a": {
        cardId: "watch-a",
        controller: "p2",
        exhausted: false,
        location: { kind: "battlefield", id: "bf-south" },
        damage: 0,
      },
      "watch-b": {
        cardId: "watch-b",
        controller: "p2",
        exhausted: false,
        location: { kind: "battlefield", id: "bf-south" },
        damage: 0,
      },
      archer: {
        cardId: "archer",
        controller: "p2",
        exhausted: false,
        location: { kind: "battlefield", id: "bf-south" },
        damage: 0,
      },
    },
    runes: {},
    battlefields: {
      "bf-north": { cardId: "bf-north", controller: null, contestedBy: null },
      "bf-south": { cardId: "bf-south", controller: "p2", contestedBy: null },
    },
    battlefieldOrder: ["bf-north", "bf-south"],
    facedown: {},
    playedThisTurn: { p1: [], p2: [] },
    triggeredThisTurn: {},
    pendingDiscounts: [],
    revealed: [],
    damageReplacements: [],
    showdown: null,
    winner: null,
    chain: [],
    priority: null,
    priorityPasses: 0,
    pending: null,
    tasks: [],
    modifiers: [],
    tokensCreated: 0,
    delayed: [],
  };
}
