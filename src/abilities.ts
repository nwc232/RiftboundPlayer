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
import { controllerOf, mightOf } from "./layers.js";
import { tokenCard } from "./tokens.js";
import type { TokenKind } from "./tokens.js";
import type {
  DelayedTiming,
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
  /**
   * R180/R184 — create a token on the board. R184.1 lets the creating effect
   * override the default entering state, and R184.2 restrict its location.
   */
  | {
      op: "createToken";
      token: TokenKind;
      count: number;
      /** R184.1 — units default to entering exhausted (R185.2.d). */
      ready?: true;
      /** Where it enters; defaults to the controller's base. */
      to?: "base" | "sourceLocation";
      /** R477.1.b — becomes a copy of the chosen target as it enters. */
      copyOfTarget?: number;
      /** R184.3 — the creating effect may grant abilities to the token. */
      grants?: Keyword[];
    }
  /**
   * Possession — "Take control of it and recall it." Control is a trait-layer
   * effect (R477.1.a), so a durational one (Hostile Takeover's "lose control
   * at end of turn") just expires rather than needing an undo.
   */
  | {
      op: "takeControl";
      duration: Duration;
      /** R454 — recall is not a move; it sends the unit to its base. */
      recall?: true;
      targetIndex: number;
    }
  /**
   * R317.1.a — schedule an effect for a later moment. Distinct from a duration:
   * a modifier stops applying, a delayed effect *fires*. Hostile Takeover's
   * "lose control of that unit and recall it at end of turn" needs both.
   */
  | { op: "delay"; at: DelayedTiming; effect: Effect }
  /** R454 — a recall sends a unit to its controller's base and is not a move. */
  | { op: "recall"; targetIndex: number }
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

    case "takeControl": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };

      const events: GameEvent[] = [
        {
          type: "controlTaken",
          playerId: context.controller,
          cardId: targetId,
          duration: effect.duration,
        },
      ];

      // R454 — a recall sends it to the *new* controller's base, and is not a
      // move, so it does not contest anything on arrival.
      const permanents =
        effect.recall === true
          ? {
              ...state.permanents,
              [targetId]: {
                ...permanent,
                location: {
                  kind: "base" as const,
                  player: context.controller,
                },
              },
            }
          : state.permanents;
      if (effect.recall === true) {
        events.push({
          type: "unitRecalled",
          playerId: context.controller,
          cardId: targetId,
        });
      }

      return {
        state: {
          ...state,
          permanents,
          modifiers: [
            ...state.modifiers,
            {
              id: `control-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: {
                layer: "trait",
                op: "setController",
                player: context.controller,
              },
              duration: effect.duration,
            },
          ],
        },
        events,
      };
    }

    case "createToken": {
      let current = state;
      const events: GameEvent[] = [];
      const copySourceId =
        effect.copyOfTarget === undefined
          ? undefined
          : context.targets[effect.copyOfTarget];

      for (let i = 0; i < effect.count; i += 1) {
        const index = current.tokensCreated;
        const tokenId = `token-${effect.token}-${index}`;
        const card = tokenCard(effect.token, tokenId);

        const location: Location =
          effect.to === "sourceLocation" && context.sourceLocation !== undefined
            ? context.sourceLocation
            : { kind: "base", player: context.controller };

        current = {
          ...current,
          tokensCreated: index + 1,
          cards: { ...current.cards, [tokenId]: card },
          permanents: {
            ...current.permanents,
            [tokenId]: {
              cardId: tokenId,
              // R182/R183 — both come from whoever controlled this effect.
              controller: context.controller,
              owner: context.controller,
              exhausted: effect.ready !== true,
              location,
              damage: 0,
            },
          },
          // R477.1.b — the copy is a trait-layer effect on the token, not a
          // rewrite of it, so it lives as a modifier like any other. R184.3's
          // granted keywords ride along the same way.
          modifiers: [
            ...current.modifiers,
            ...(copySourceId === undefined
              ? []
              : [
                  {
                    id: `copy-${tokenId}`,
                    targetId: tokenId,
                    modification: {
                      layer: "trait" as const,
                      op: "copyOf" as const,
                      sourceId: copySourceId,
                    },
                    duration: "permanent" as const,
                  },
                ]),
            ...(effect.grants ?? []).map((keyword, n) => ({
              id: `grant-${tokenId}-${n}`,
              targetId: tokenId,
              modification: {
                layer: "ability" as const,
                op: "grantKeyword" as const,
                keyword,
              },
              duration: "permanent" as const,
            })),
          ],
        };

        events.push({
          type: "tokenCreated",
          playerId: context.controller,
          cardId: tokenId,
          token: effect.token,
        });
      }

      return { state: current, events };
    }

    case "delay":
      return {
        state: {
          ...state,
          delayed: [
            ...state.delayed,
            {
              id: `delayed-${state.delayed.length}-${context.sourceId}`,
              at: effect.at,
              controller: context.controller,
              sourceId: context.sourceId,
              effect: effect.effect,
              // R355.5 — the choices were made when this was scheduled.
              targets: [...context.targets],
            },
          ],
        },
        events: [
          {
            type: "effectScheduled",
            playerId: context.controller,
            cardId: context.sourceId,
            at: effect.at,
          },
        ],
      };

    case "recall": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };

      const to = controllerOf(state, targetId);
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: {
              ...permanent,
              location: { kind: "base", player: to },
            },
          },
        },
        events: [{ type: "unitRecalled", playerId: to, cardId: targetId }],
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
