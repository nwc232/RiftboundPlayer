import {
  activated,
  draw,
  addEnergy,
  addPower,
  basicRune,
  counterSpell,
  dealDamage,
  exhaustSelf,
  spell,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Domain, GameState, Keyword } from "../state.js";
import { beginTurn } from "../turn.js";

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
  vanillaUnit("skulker", "Shipyard Skulker", 3, 3, "chaos"),
  vanillaUnit("sergeant", "Vanguard Sergeant", 4, 4, "order"),
  // Not printed with Ganking — given it here so the keyword is exercisable.
  vanillaUnit("phantom", "Playful Phantom", 5, 5, "calm", ["ganking"]),
  // Cloud Drake — "When you play me, draw 1." (6 energy, 5 Might)
  {
    ...vanillaUnit("drake", "Cloud Drake", 4, 5, "calm"),
    abilities: [
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: draw(1),
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
  {
    id: "conduit",
    name: "Energy Conduit",
    type: "gear",
    cost: FREE,
    keywords: [],
    abilities: [activated([exhaustSelf], addEnergy(1), "reaction")],
  },
  // p2's garrison, so combat is reachable in the demo.
  vanillaUnit("grunt", "Sentry Grunt", 2, 2, "order", ["tank"]),
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
    players: {
      p1: {
        id: "p1",
        mainDeck: ["drake", "skulker", "incinerate", "sergeant", "phantom"],
        hand: [],
        trash: [],
        runeDeck: RUNES.map((rune) => rune.id),
        runes: [],
        runePool: { buckets: [] },
        points: 0,
        scoredThisTurn: [],
      },
      p2: {
        id: "p2",
        mainDeck: [],
        hand: [],
        trash: [],
        runeDeck: [],
        runes: [],
        runePool: { buckets: [] },
        points: 0,
        scoredThisTurn: [],
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
    showdown: null,
    winner: null,
    chain: [],
    priority: null,
    priorityPasses: 0,
  };
}
