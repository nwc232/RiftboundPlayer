import { addEnergy as creditEnergy, addPower as creditPower } from "./cost.js";
import type { GameEvent } from "./events.js";
import type { CardId, Domain, GameState, Location, PlayerId } from "./state.js";
import type {
  Modification,
  PassiveCondition,
  PassiveScope,
} from "./layers.js";
import type { TriggeredAbility } from "./triggers.js";

/**
 * The vocabulary of what an effect can say. No behaviour lives here — these are
 * descriptions that `execute` turns into state changes. Keeping effects as data
 * is what lets other cards read and rewrite them before they run.
 */
export type Effect =
  | { op: "addEnergy"; amount: number }
  | { op: "addPower"; domain: Domain | "selfDomain"; amount: number }
  /** `targetIndex` picks from the choices made when the item was played. */
  | { op: "dealDamage"; amount: number; targetIndex: number }
  | { op: "draw"; count: number }
  | { op: "counterSpell"; targetIndex: number }
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

/**
 * R477 — a continuous effect that modifies characteristics rather than doing
 * anything when it resolves. Passives never go on the chain; they are read
 * live by the layer pipeline, so removing the source removes the effect.
 */
export interface PassiveAbility {
  kind: "passive";
  scope: PassiveScope;
  condition?: PassiveCondition;
  modification: Modification;
}

export type Ability = ActivatedAbility | TriggeredAbility | PassiveAbility;

export interface EffectContext {
  controller: PlayerId;
  sourceId: CardId;
  /** Targets chosen while playing (R355.5). Empty for most abilities. */
  targets: CardId[];
  /**
   * Where the source is — or, if it has since died, where it was when the
   * ability triggered (R323.4). This is what "here" resolves against.
   */
  sourceLocation?: Location;
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

    // R142.3 — damage is marked on the unit. Lethal damage kills it in the
    // cleanup that follows (R428.1.a.2), not immediately.
    case "dealDamage": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: {
              ...permanent,
              damage: permanent.damage + effect.amount,
            },
          },
        },
        events: [
          {
            type: "damageDealt",
            playerId: context.controller,
            cardId: targetId,
            amount: effect.amount,
          },
        ],
      };
    }

    case "draw": {
      let current = state;
      const events: GameEvent[] = [];
      for (let i = 0; i < effect.count; i += 1) {
        const player = current.players[context.controller];
        const [drawnId, ...rest] = player.mainDeck;
        if (drawnId === undefined) break;
        current = {
          ...current,
          players: {
            ...current.players,
            [context.controller]: {
              ...player,
              mainDeck: rest,
              hand: [...player.hand, drawnId],
            },
          },
        };
        events.push({
          type: "cardDrawn",
          playerId: context.controller,
          cardId: drawnId,
        });
      }
      return { state: current, events };
    }

    // R359.3.d — a countered spell never executes; it goes to its owner's
    // trash as if it had resolved. Cards like Abandon replace that destination.
    case "counterSpell": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      // R359.3.d targets a spell; a triggered ability is not counterable here.
      const index = state.chain.findIndex(
        (item) => item.kind === "spell" && item.cardId === targetId,
      );
      if (index === -1) return { state, events: [] };

      const owner = state.chain[index]!.controller;
      return {
        state: {
          ...state,
          chain: state.chain.filter((_, i) => i !== index),
          players: {
            ...state.players,
            [owner]: {
              ...state.players[owner],
              trash: [...state.players[owner].trash, targetId],
            },
          },
        },
        events: [
          {
            type: "spellCountered",
            playerId: context.controller,
            cardId: targetId,
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
