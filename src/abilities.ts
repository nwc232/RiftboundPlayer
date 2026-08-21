import { addEnergy as creditEnergy, addPower as creditPower } from "./cost.js";
import type { GameEvent } from "./events.js";
import type {
  CardId,
  Domain,
  GameState,
  Keyword,
  Location,
  PlayerId,
} from "./state.js";
import { mightOf } from "./layers.js";
import type {
  Duration,
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
  /**
   * R432.1 — modulate a target's Might for a duration. `min`/`max` are
   * R477.3.b's limitation: applied once, at this moment, and remembered at the
   * limited level. `double` computes the amount from current Might instead.
   */
  | {
      op: "modifyMight";
      amount?: number;
      double?: true;
      duration: Duration;
      min?: number;
      max?: number;
      targetIndex: number;
    }
  /** Fortified Position — "It gains [Shield 2] this combat." */
  | {
      op: "grantKeywordFor";
      keyword: Keyword;
      value?: number;
      duration: Duration;
      targetIndex: number;
    }
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

    /**
     * R477.3.b — the limitation applies *now* and the effect is remembered at
     * that limited level. "-4 Might to a min of 1" on a 2-Might unit generates
     * -1, and stays -1 even if the unit is buffed afterwards.
     */
    case "modifyMight": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };

      const current = mightOf(state, targetId);
      // R432.1.a — doubling reads current Might, so Shield counts toward it.
      const requested = effect.double === true ? current : (effect.amount ?? 0);
      // R477.3.c — a player cannot increase an attribute by a negative amount.
      const raw = effect.double === true ? Math.max(0, requested) : requested;

      let limited = current + raw;
      if (effect.min !== undefined) limited = Math.max(effect.min, limited);
      if (effect.max !== undefined) limited = Math.min(effect.max, limited);
      const amount = limited - current;

      if (amount === 0) return { state, events: [] };
      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `mod-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: { layer: "arithmetic", op: "addMight", amount },
              duration: effect.duration,
            },
          ],
        },
        events: [
          {
            type: "mightModified",
            playerId: context.controller,
            cardId: targetId,
            amount,
            duration: effect.duration,
          },
        ],
      };
    }

    case "grantKeywordFor": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `mod-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: {
                layer: "ability",
                op: "grantKeyword",
                keyword: effect.keyword,
                ...(effect.value !== undefined ? { value: effect.value } : {}),
              },
              duration: effect.duration,
            },
          ],
        },
        events: [
          {
            type: "keywordGranted",
            playerId: context.controller,
            cardId: targetId,
            keyword: effect.keyword,
            duration: effect.duration,
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
