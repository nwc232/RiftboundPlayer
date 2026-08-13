import { basicRune } from "../src/builders.js";
import { EMPTY_POOL, FREE } from "../src/cost.js";
import type {
  CardInstance,
  Cost,
  Domain,
  GameState,
  PaymentRestriction,
  PlayerId,
  PlayerState,
  PowerCount,
  RunePool,
} from "../src/state.js";

export function cost(partial: Partial<Cost> = {}): Cost {
  return { ...FREE, ...partial };
}

interface BucketSpec {
  energy?: number;
  power?: PowerCount;
  universalPower?: number;
  restriction?: PaymentRestriction;
}

/** One bucket per spec; no args gives an empty pool. */
export function pool(...specs: BucketSpec[]): RunePool {
  return {
    buckets: specs.map((spec) => ({
      restriction: spec.restriction ?? null,
      energy: spec.energy ?? 0,
      power: spec.power ?? {},
      universalPower: spec.universalPower ?? 0,
    })),
  };
}

export function unit(id: string, partial: Partial<CardInstance> = {}): CardInstance {
  return { id, name: id, type: "unit", cost: FREE, abilities: [], ...partial };
}

export function runeCard(id: string, domain: Domain): CardInstance {
  return basicRune(id, domain);
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
    turn: { player: "p1", phase: "main", number: 1 },
    players: {
      p1: player("p1", options.p1 ?? {}),
      p2: player("p2", options.p2 ?? {}),
    },
    cards,
    permanents: {},
    runes: {},
  };
}
