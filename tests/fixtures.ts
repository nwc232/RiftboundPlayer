import { EMPTY_POOL, FREE } from "../src/cost.js";
import type {
  CardInstance,
  Cost,
  Domain,
  GameState,
  PlayerId,
  PlayerState,
  RunePool,
} from "../src/state.js";

export function cost(partial: Partial<Cost> = {}): Cost {
  return { ...FREE, ...partial };
}

export function pool(partial: Partial<RunePool> = {}): RunePool {
  return { ...EMPTY_POOL, ...partial };
}

export function unit(id: string, partial: Partial<CardInstance> = {}): CardInstance {
  return { id, name: id, type: "unit", cost: FREE, ...partial };
}

export function runeCard(id: string, domain: Domain): CardInstance {
  return { id, name: `${domain} rune`, type: "rune", cost: FREE, domain };
}

function player(id: PlayerId, partial: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    mainDeck: [],
    hand: [],
    base: [],
    runeDeck: [],
    runes: [],
    runePool: EMPTY_POOL,
    ...partial,
  };
}

export function makeState(options: {
  p1?: Partial<PlayerState>;
  p2?: Partial<PlayerState>;
  cards?: CardInstance[];
} = {}): GameState {
  const cards: GameState["cards"] = {};
  for (const card of options.cards ?? []) {
    cards[card.id] = card;
  }

  return {
    players: {
      p1: player("p1", options.p1 ?? {}),
      p2: player("p2", options.p2 ?? {}),
    },
    cards,
    permanents: {},
    runes: {},
  };
}
