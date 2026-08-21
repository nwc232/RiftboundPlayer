import { basicRune } from "../src/builders.js";
import { EMPTY_POOL, FREE } from "../src/cost.js";
import type {
  CardInstance,
  Cost,
  Domain,
  GameState,
  Location,
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
  return {
    id,
    name: id,
    type: "unit",
    cost: FREE,
    abilities: [],
    keywords: [],
    ...partial,
  };
}

export function runeCard(id: string, domain: Domain): CardInstance {
  return basicRune(id, domain);
}

function player(id: PlayerId, partial: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    mainDeck: [],
    hand: [],
    trash: [],
    runeDeck: [],
    runes: [],
    runePool: EMPTY_POOL,
    points: 0,
    scoredThisTurn: [],
    ...partial,
  };
}

interface PermanentSpec {
  cardId: string;
  controller?: PlayerId;
  exhausted?: boolean;
  damage?: number;
  location?: Location;
  /** R323.2 — set directly in tests that need Assault or Shield to apply. */
  designation?: "attacker" | "defender";
}

export function makeState(options: {
  p1?: Partial<PlayerState>;
  p2?: Partial<PlayerState>;
  cards?: CardInstance[];
  permanents?: PermanentSpec[];
  battlefields?: string[];
} = {}): GameState {
  const cards: GameState["cards"] = {};
  for (const card of options.cards ?? []) {
    cards[card.id] = card;
  }

  const permanents: GameState["permanents"] = {};
  for (const spec of options.permanents ?? []) {
    const controller = spec.controller ?? "p1";
    permanents[spec.cardId] = {
      cardId: spec.cardId,
      controller,
      exhausted: spec.exhausted ?? false,
      location: spec.location ?? { kind: "base", player: controller },
      damage: spec.damage ?? 0,
      ...(spec.designation !== undefined
        ? { designation: spec.designation }
        : {}),
    };
  }

  const battlefields: GameState["battlefields"] = {};
  for (const id of options.battlefields ?? []) {
    battlefields[id] = { cardId: id, controller: null, contestedBy: null };
  }

  return {
    turn: { player: "p1", phase: "main", number: 1 },
    players: {
      p1: player("p1", options.p1 ?? {}),
      p2: player("p2", options.p2 ?? {}),
    },
    cards,
    permanents,
    runes: {},
    battlefields,
    battlefieldOrder: options.battlefields ?? [],
    showdown: null,
    winner: null,
    chain: [],
    priority: null,
    priorityPasses: 0,
    pending: null,
    tasks: [],
  };
}
