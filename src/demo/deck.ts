import { activated, addEnergy, addPower, basicRune, exhaustSelf } from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Domain, GameState } from "../state.js";
import { beginTurn } from "../turn.js";

/**
 * A small hand-authored sample using real Riftbound cards. Costs and domains
 * come from the card database in /reference; the units chosen are ones with no
 * printed rules text, so nothing here is faked to look more finished than it is.
 */

function vanillaUnit(
  id: string,
  name: string,
  energy: number,
  domain: Domain,
): CardInstance {
  return {
    id,
    name,
    type: "unit",
    cost: { ...FREE, energy },
    domain,
    abilities: [],
  };
}

export const SAMPLE_CARDS: CardInstance[] = [
  vanillaUnit("skulker", "Shipyard Skulker", 3, "chaos"),
  vanillaUnit("sergeant", "Vanguard Sergeant", 4, "order"),
  vanillaUnit("phantom", "Playful Phantom", 5, "calm"),
  {
    id: "conduit",
    name: "Energy Conduit",
    type: "gear",
    cost: FREE,
    abilities: [activated([exhaustSelf], addEnergy(1), "reaction")],
  },
  {
    id: "seal-rage",
    name: "Seal of Rage",
    type: "gear",
    cost: FREE,
    abilities: [activated([exhaustSelf], addPower("fury", 1), "reaction")],
  },
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
  for (const card of [...SAMPLE_CARDS, ...RUNES]) {
    cards[card.id] = card;
  }

  return {
    turn: { player: "p1", phase: "main", number: 1 },
    players: {
      p1: {
        id: "p1",
        mainDeck: ["skulker", "sergeant", "phantom"],
        hand: [],
        base: ["conduit", "seal-rage"],
        runeDeck: RUNES.map((rune) => rune.id),
        runes: [],
        runePool: { buckets: [] },
      },
      p2: {
        id: "p2",
        mainDeck: [],
        hand: [],
        base: [],
        runeDeck: [],
        runes: [],
        runePool: { buckets: [] },
      },
    },
    cards,
    permanents: {
      conduit: { cardId: "conduit", exhausted: false },
      "seal-rage": { cardId: "seal-rage", exhausted: false },
    },
    runes: {},
  };
}
