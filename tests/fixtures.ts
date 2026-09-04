import { basicRune } from "../src/builders.js";
import { EMPTY_POOL, FREE } from "../src/cost.js";
import { modeFor } from "../src/modes-of-play.js";
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
    banished: [],
    legend: null,
    champion: null,
    runeDeck: [],
    runes: [],
    runePool: EMPTY_POOL,
    points: 0,
    scoredThisTurn: [],
    xp: 0,
    ...partial,
  };
}

interface PermanentSpec {
  cardId: string;
  controller?: PlayerId;
  exhausted?: boolean;
  damage?: number;
  location?: Location;
  /** R716 — set directly in tests about equipment following its host. */
  attachedTo?: string;
  /** R323.2 — set directly in tests that need Assault or Shield to apply. */
  designation?: "attacker" | "defender";
  /** R423 — set directly rather than through an effect that has to resolve. */
  stunned?: true;
}

export function makeState(options: {
  p1?: Partial<PlayerState>;
  p2?: Partial<PlayerState>;
  /** R487/R488 — a third and fourth seat, for the modes that have them. */
  p3?: Partial<PlayerState>;
  p4?: Partial<PlayerState>;
  cards?: CardInstance[];
  permanents?: PermanentSpec[];
  /** Ids only, or `[id, controller]` to hand one to a player already. */
  battlefields?: (string | [string, PlayerId])[];
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
      ...(spec.stunned !== undefined ? { stunned: spec.stunned } : {}),
      ...(spec.attachedTo !== undefined ? { attachedTo: spec.attachedTo } : {}),
    };
  }

  const battlefieldOrder: string[] = [];
  const battlefields: GameState["battlefields"] = {};
  for (const entry of options.battlefields ?? []) {
    const [id, controller] =
      typeof entry === "string" ? [entry, null] : entry;
    battlefieldOrder.push(id);
    battlefields[id] = { cardId: id, controller, contestedBy: null };
  }

  // Two seats unless a test asks for more: `turnOrder` is what the engine
  // reads, so a fixture that never mentions p3 is a Duel in every respect.
  const turnOrder: PlayerId[] = ["p1", "p2"];
  const players: GameState["players"] = {
    p1: player("p1", options.p1 ?? {}),
    p2: player("p2", options.p2 ?? {}),
  };
  for (const id of ["p3", "p4"] as const) {
    const seat = options[id];
    if (seat === undefined) continue;
    turnOrder.push(id);
    players[id] = player(id, seat);
  }

  return {
    turn: { player: "p1", phase: "main", number: 1 },
    // R485 unless a test seats more: `modeFor` is the sanctioned mode for
    // however many seats the fixture asked for.
    mode: modeFor(turnOrder.length).id,
    turnOrder,
    players,
    cards,
    permanents,
    runes: {},
    battlefields,
    battlefieldOrder,
    facedown: {},
    playedThisTurn: Object.fromEntries(turnOrder.map((id) => [id, []])),
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
