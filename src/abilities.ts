import { addEnergy as creditEnergy, addPower as creditPower } from "./cost.js";
import type { GameEvent } from "./events.js";
import type { CardId, Domain, GameState, PlayerId } from "./state.js";

/**
 * The vocabulary of what an effect can say. No behaviour lives here — these are
 * descriptions that `execute` turns into state changes. Keeping effects as data
 * is what lets other cards read and rewrite them before they run.
 */
export type Effect =
  | { op: "addEnergy"; amount: number }
  | { op: "addPower"; domain: Domain | "selfDomain"; amount: number }
  | { op: "seq"; steps: Effect[] };

export type AbilityCost = { kind: "exhaustSelf" } | { kind: "recycleSelf" };

/** Recorded from the card, but not yet enforced — that needs the chain. */
export type AbilityTiming = "reaction" | "action" | "default";

export interface ActivatedAbility {
  kind: "activated";
  timing: AbilityTiming;
  costs: AbilityCost[];
  effect: Effect;
}

export type Ability = ActivatedAbility;

export interface EffectContext {
  controller: PlayerId;
  sourceId: CardId;
}

export interface EffectOutcome {
  state: GameState;
  events: GameEvent[];
}

function resolveDomain(
  state: GameState,
  domain: Domain | "selfDomain",
  context: EffectContext,
): Domain | undefined {
  if (domain !== "selfDomain") {
    return domain;
  }
  return state.cards[context.sourceId]?.domain;
}

function withPool(
  state: GameState,
  playerId: PlayerId,
  update: (pool: GameState["players"][PlayerId]["runePool"]) => GameState["players"][PlayerId]["runePool"],
): GameState {
  const player = state.players[playerId];
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, runePool: update(player.runePool) },
    },
  };
}

/**
 * The interpreter. Every card's effect flows through this one function, which
 * is the only place that knows how to turn an Effect into a state change.
 */
export function execute(
  state: GameState,
  effect: Effect,
  context: EffectContext,
): EffectOutcome {
  switch (effect.op) {
    case "addEnergy":
      return {
        state: withPool(state, context.controller, (pool) =>
          creditEnergy(pool, effect.amount),
        ),
        events: [
          {
            type: "energyAdded",
            playerId: context.controller,
            amount: effect.amount,
          },
        ],
      };

    case "addPower": {
      const domain = resolveDomain(state, effect.domain, context);
      if (domain === undefined) {
        return { state, events: [] };
      }
      return {
        state: withPool(state, context.controller, (pool) =>
          creditPower(pool, domain, effect.amount),
        ),
        events: [
          {
            type: "powerAdded",
            playerId: context.controller,
            domain,
            amount: effect.amount,
          },
        ],
      };
    }

    case "seq": {
      let current = state;
      const events: GameEvent[] = [];
      for (const step of effect.steps) {
        const outcome = execute(current, step, context);
        current = outcome.state;
        events.push(...outcome.events);
      }
      return { state: current, events };
    }

    default: {
      const unhandled: never = effect;
      return { state, events: [] };
    }
  }
}
