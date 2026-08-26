import { addEnergy as creditEnergy, addPower as creditPower } from "./cost.js";
import type { GameEvent } from "./events.js";
import type {
  CardId,
  Cost,
  Domain,
  GameState,
  Keyword,
  Location,
  PlayerId,
  PlaySource,
} from "./state.js";
import { killUnits } from "./combat.js";
import { ownerOf } from "./state.js";
import { drawCards } from "./draw.js";
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
import type { ResolutionChoice } from "./tasks.js";
import type { Targeting } from "./decisions.js";
import type { PlayPermission } from "./play.js";
import type { CostModifier } from "./costing.js";
import { holds } from "./conditions.js";
import type { Condition } from "./conditions.js";

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
  /** R816 — what [Temporary] does. Kills the ability's own source. */
  | { op: "killSelf" }
  /** Gust, Rebuke, Star-Crossed — back to its *owner's* hand (R56). */
  | { op: "returnToHand"; targetIndex: number }
  /** R415 — readying an already-ready unit does nothing (R415.1.c). */
  | { op: "ready"; targetIndex: number }
  /** R426 — place a Buff counter, worth +1 Might (R703). At most one. */
  | { op: "buff"; targetIndex: number }
  /** R427 — straight to Banishment, and not a kill or a discard (R427.2.a/b). */
  | { op: "banish"; targetIndex: number }
  /** R423 — a binary status, not a kill. */
  | { op: "stun"; targetIndex: number }
  /** R420 — moving as an *effect*, which is a Limited Action, not a move. */
  | { op: "moveUnit"; targetIndex: number; to: "sourceLocation" | "base" }
  /**
   * R383.2.a.1's second half — a conditional statement that is *not*
   * immediately after the trigger condition is part of the effect, so it is
   * asked here, on resolution. Loose Cannon's "draw 1 if you have one or fewer
   * cards in your hand" is this; Sona's "if I'm at a battlefield" is not.
   */
  | { op: "conditional"; test: Condition; then: Effect; otherwise?: Effect }
  /** R730.1 — Kha'Zix, Mutating Horror's "gain 2 XP". */
  | { op: "gainXP"; amount: number }
  /**
   * R433 — Switcheroo's "Swap the Might of two units at the same battlefield
   * this turn." R433.1.b: find the difference and apply it as an increase to
   * the lower and a decrease to the higher, for the stated duration.
   */
  | { op: "swapMight"; duration: Duration; targetIndex: number; otherIndex: number }
  /** Tideturner — "Move me to its location and it to my original location." */
  | { op: "swapLocations"; targetIndex: number }
  /** Rampage — "They deal damage equal to their Mights to each other." */
  | { op: "mutualDamage"; targetIndex: number; otherIndex: number }
  /** Targon's Peak — "ready 2 runes at the end of this turn". */
  | { op: "readyRunes"; count: number }
  /** Threshold of the Gray — "the attacker and defender each [Add] [1]". */
  | { op: "addEnergyToEach"; amount: number }
  /** Seat of Power — "draw 1 for each other battlefield you or allies control". */
  | { op: "drawPerBattlefield"; excludeSource?: true }
  /** Vex, Apathetic — "They can't move it this turn." */
  | { op: "restrictMovement"; duration: Duration; targetIndex: number }
  /**
   * Thrill of the Hunt — "Banish a friendly unit, then its owner plays it to
   * any battlefield, ignoring its cost." Two choices: the unit, then where it
   * comes back. R356.1.b.1 sets both base costs to zero.
   */
  | { op: "banishThenPlay"; targetIndex: number; destinationIndex: number }
  /** R434 / R818.1.c.2 — "[Cost]: Attach this gear to a unit you control." */
  | { op: "attachSelf"; targetIndex: number }
  /**
   * Stacked Deck — "Look at the top 3 cards of your Main Deck. Put 1 into your
   * hand and recycle the rest." The choice is made on resolution, not at
   * finalization, so this enqueues a task the queue can suspend on.
   */
  | { op: "lookAtTop"; count: number; keep: number }
  /**
   * Sabotage — "Choose an opponent. They reveal their hand. Choose a non-unit
   * card from it, and recycle that card." Same shape: the choice comes after
   * the reveal.
   */
  | { op: "recycleFromOpponentHand"; exclude?: "unit" }
  /** Astral Heron — "your next card costs [2][A][A] less". */
  | { op: "discountNextCard"; reduce: Cost }
  | { op: "seq"; steps: Effect[] };

export type AbilityCost =
  | { kind: "exhaustSelf" }
  | { kind: "recycleSelf" }
  /** Emperor's Dais — "you may pay [1] and…". R383.3.b makes it a base cost. */
  | { kind: "pay"; cost: Cost };

/** Recorded from the card, but not yet enforced — that needs the chain. */
export type AbilityTiming = "reaction" | "action" | "default";

export interface ActivatedAbility {
  kind: "activated";
  timing: AbilityTiming;
  costs: AbilityCost[];
  effect: Effect;
  /**
   * R355.5 — a spell's own choices, made as it is played. Absent means the
   * ability chooses nothing, which is not the same as choosing zero things:
   * R355.8 only demands valid choices exist for what is actually asked for.
   */
  targeting?: Targeting;
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

/**
 * R355.2.b / R822.1.d — rules text that widens where a unit may be played.
 * Separate from PassiveAbility because it is read off a card in hand, which
 * the R477 layer pipeline never sees.
 */
export interface PlayPermissionAbility {
  kind: "playPermission";
  permission: PlayPermission;
}

/**
 * R812 — Noxus Hopeful's "[Legion] — I cost [2] less". Like a play permission,
 * this is read off a card in hand and so never reaches the R477 pipeline.
 */
export interface CostModifierAbility extends CostModifier {
  kind: "costModifier";
}

/**
 * R356.2 — Pyke, Dockside Butcher's "You may pay [Fury] as an additional cost
 * to play me"; Rampage's "As you play this, you may pay [Body]…". Read off the
 * card in hand, like the other two non-resolving ability kinds.
 */
export interface AdditionalCostAbility {
  kind: "additionalCost";
  /** R356.2.b.1 — the word "may". Absent makes it mandatory (R356.2.a.1). */
  optional?: true;
  cost: Cost;
}

export type Ability =
  | ActivatedAbility
  | AdditionalCostAbility
  | TriggeredAbility
  | PassiveAbility
  | PlayPermissionAbility
  | CostModifierAbility;

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
  /** R356.2.b — whether this play's optional additional cost was paid. */
  paidAdditionalCost?: boolean;
  /** Which zone a resolving spell was played from (R811.3). */
  playedFrom?: PlaySource;
}

export interface EffectOutcome {
  state: GameState;
  events: GameEvent[];
}

/**
 * Leaves a choice behind for the task queue. `execute` is synchronous and
 * cannot suspend, so an effect that needs an answer mid-resolution enqueues
 * one instead. R334.1 makes that legal: work outstanding when an item finishes
 * resolving is worked through before anything else happens.
 *
 * A step *after* one of these inside a `seq` therefore runs before the answer
 * arrives. Both cards that use it end with the choice, so it never shows.
 */
function enqueueChoice(state: GameState, task: ResolutionChoice): GameState {
  return { ...state, tasks: [...state.tasks, task] };
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

    case "draw":
      return drawCards(state, context.controller, effect.count);

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

    case "returnToHand": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }
      // R56 — it is the *owner's* hand, not the current controller's.
      const owner = ownerOf(permanent);
      const { [targetId]: _gone, ...permanents } = state.permanents;
      return {
        state: {
          ...state,
          permanents,
          players: {
            ...state.players,
            [owner]: {
              ...state.players[owner],
              hand: [...state.players[owner].hand, targetId],
            },
          },
        },
        events: [{ type: "returnedToHand", playerId: owner, cardId: targetId }],
      };
    }

    case "banish": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }
      const owner = ownerOf(permanent);
      const { [targetId]: _gone, ...permanents } = state.permanents;
      return {
        state: {
          ...state,
          permanents,
          players: {
            ...state.players,
            [owner]: {
              ...state.players[owner],
              banished: [...state.players[owner].banished, targetId],
            },
          },
        },
        events: [{ type: "banished", playerId: owner, cardId: targetId }],
      };
    }

    case "ready":
    case "buff":
    case "stun": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }

      // R415.1.c, R426.1.b.1, R423.1.a.1 — all three are no-ops on a unit that
      // is already in the target state, and R426.1.c makes that observable:
      // "if it was buffed this way" is false, so a linked effect will not fire.
      const already =
        (effect.op === "ready" && !permanent.exhausted) ||
        (effect.op === "buff" && permanent.buffed === true) ||
        (effect.op === "stun" && permanent.stunned === true);
      if (already) return { state, events: [] };

      const updated =
        effect.op === "ready"
          ? { ...permanent, exhausted: false }
          : effect.op === "buff"
            ? { ...permanent, buffed: true as const }
            : { ...permanent, stunned: true as const };

      return {
        state: { ...state, permanents: { ...state.permanents, [targetId]: updated } },
        events: [
          {
            type: effect.op === "ready" ? "objectReadied" : effect.op === "buff" ? "buffed" : "stunned",
            playerId: context.controller,
            cardId: targetId,
          },
        ],
      };
    }

    case "moveUnit": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }
      const to: Location =
        effect.to === "sourceLocation" && context.sourceLocation !== undefined
          ? context.sourceLocation
          : { kind: "base", player: controllerOf(state, targetId) };

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: { ...permanent, location: to },
          },
        },
        events: [
          {
            type: "unitMoved",
            playerId: controllerOf(state, targetId),
            cardId: targetId,
            from: permanent.location,
            to,
          },
        ],
      };
    }

    case "killSelf": {
      if (state.permanents[context.sourceId] === undefined) {
        return { state, events: [] };
      }
      return killUnits(state, [context.sourceId]);
    }

    case "gainXP": {
      const player = state.players[context.controller];
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [context.controller]: { ...player, xp: player.xp + effect.amount },
          },
        },
        events: [
          {
            type: "xpGained",
            playerId: context.controller,
            amount: effect.amount,
          },
        ],
      };
    }

    case "addEnergyToEach": {
      let current = state;
      const events: GameEvent[] = [];
      for (const playerId of ["p1", "p2"] as const) {
        current = withPool(current, playerId, (pool) =>
          creditEnergy(pool, effect.amount),
        );
        events.push({ type: "energyAdded", playerId, amount: effect.amount });
      }
      return { state: current, events };
    }

    case "swapMight": {
      const a = context.targets[effect.targetIndex];
      const b = context.targets[effect.otherIndex];
      if (a === undefined || b === undefined) return { state, events: [] };
      if (state.permanents[a] === undefined) return { state, events: [] };
      if (state.permanents[b] === undefined) return { state, events: [] };

      const mightA = mightOf(state, a);
      const mightB = mightOf(state, b);
      // R433.1.c — "If both attributes are the same numeric value, Swapping
      // has no effect." Not merely invisible: nothing is created to expire.
      if (mightA === mightB) return { state, events: [] };

      const difference = Math.abs(mightA - mightB);
      const raise = mightA < mightB ? a : b;
      const lower = mightA < mightB ? b : a;

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `swap-up-${state.modifiers.length}-${raise}`,
              targetId: raise,
              modification: {
                layer: "arithmetic",
                op: "addMight",
                amount: difference,
              },
              duration: effect.duration,
            },
            {
              id: `swap-down-${state.modifiers.length}-${lower}`,
              targetId: lower,
              modification: {
                layer: "arithmetic",
                op: "addMight",
                amount: -difference,
              },
              duration: effect.duration,
            },
          ],
        },
        events: [
          {
            type: "mightModified",
            playerId: context.controller,
            cardId: raise,
            amount: difference,
            duration: effect.duration,
          },
          {
            type: "mightModified",
            playerId: context.controller,
            cardId: lower,
            amount: -difference,
            duration: effect.duration,
          },
        ],
      };
    }

    case "swapLocations": {
      const targetId = context.targets[effect.targetIndex];
      const source = state.permanents[context.sourceId];
      if (targetId === undefined || source === undefined) {
        return { state, events: [] };
      }
      const target = state.permanents[targetId];
      if (target === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [context.sourceId]: { ...source, location: target.location },
            [targetId]: { ...target, location: source.location },
          },
        },
        events: [
          {
            type: "unitMoved",
            playerId: context.controller,
            cardId: context.sourceId,
            from: source.location,
            to: target.location,
          },
          {
            type: "unitMoved",
            playerId: controllerOf(state, targetId),
            cardId: targetId,
            from: target.location,
            to: source.location,
          },
        ],
      };
    }

    case "mutualDamage": {
      const a = context.targets[effect.targetIndex];
      const b = context.targets[effect.otherIndex];
      if (a === undefined || b === undefined) return { state, events: [] };
      if (state.permanents[a] === undefined) return { state, events: [] };
      if (state.permanents[b] === undefined) return { state, events: [] };

      // R465.2.c.1.a's principle: both amounts are read before either lands, so
      // a unit that dies still dealt its Might.
      const damageFromA = mightOf(state, a);
      const damageFromB = mightOf(state, b);
      const permanents = { ...state.permanents };
      permanents[a] = { ...permanents[a]!, damage: permanents[a]!.damage + damageFromB };
      permanents[b] = { ...permanents[b]!, damage: permanents[b]!.damage + damageFromA };

      return {
        state: { ...state, permanents },
        events: [
          {
            type: "damageDealt",
            playerId: controllerOf(state, a),
            cardId: a,
            amount: damageFromB,
          },
          {
            type: "damageDealt",
            playerId: controllerOf(state, b),
            cardId: b,
            amount: damageFromA,
          },
        ],
      };
    }

    case "readyRunes": {
      const player = state.players[context.controller];
      const runes = { ...state.runes };
      const events: GameEvent[] = [];
      let left = effect.count;

      // R414.1 — readying an already-ready rune does nothing, so the count is
      // spent on the exhausted ones in the order they were channeled.
      for (const runeId of player.runes) {
        if (left === 0) break;
        const rune = runes[runeId];
        if (rune === undefined || !rune.exhausted) continue;
        runes[runeId] = { ...rune, exhausted: false };
        events.push({
          type: "objectReadied",
          playerId: context.controller,
          cardId: runeId,
        });
        left -= 1;
      }

      return { state: { ...state, runes }, events };
    }

    case "drawPerBattlefield": {
      const count = state.battlefieldOrder.filter(
        (battlefieldId) =>
          state.battlefields[battlefieldId]?.controller === context.controller &&
          !(effect.excludeSource === true && battlefieldId === context.sourceId),
      ).length;
      if (count === 0) return { state, events: [] };
      return drawCards(state, context.controller, count);
    }

    case "restrictMovement": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `noMove-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: { layer: "ability", op: "restrictMovement" },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };
    }

    case "discountNextCard":
      return {
        state: {
          ...state,
          pendingDiscounts: [
            ...state.pendingDiscounts,
            { player: context.controller, reduce: effect.reduce },
          ],
        },
        events: [],
      };

    case "lookAtTop": {
      const player = state.players[context.controller];
      const revealed = player.mainDeck.slice(0, effect.count);
      if (revealed.length === 0) return { state, events: [] };

      return {
        state: enqueueChoice(state, {
          kind: "chooseFromRevealed",
          player: context.controller,
          legal: revealed,
          keep: Math.min(effect.keep, revealed.length),
          source: "mainDeck",
        }),
        events: [],
      };
    }

    case "recycleFromOpponentHand": {
      const opponent = context.controller === "p1" ? "p2" : "p1";
      const legal = state.players[opponent].hand.filter(
        (cardId) =>
          effect.exclude === undefined ||
          state.cards[cardId]?.type !== effect.exclude,
      );
      if (legal.length === 0) return { state, events: [] };

      return {
        state: enqueueChoice(state, {
          kind: "chooseFromRevealed",
          // R355.5 — "Choose a non-unit card from it" is the *spell's*
          // controller choosing, not the player revealing.
          player: context.controller,
          legal,
          keep: 0,
          source: "opponentHand",
        }),
        events: [],
      };
    }

    case "attachSelf": {
      const targetId = context.targets[effect.targetIndex];
      const gear = state.permanents[context.sourceId];
      if (targetId === undefined || gear === undefined) {
        return { state, events: [] };
      }
      const host = state.permanents[targetId];
      if (host === undefined) return { state, events: [] };
      // R434.1.g/h — attaching to its current Top-Most Card does nothing.
      if (gear.attachedTo === targetId) return { state, events: [] };

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            // R434.1.f — attaching elsewhere detaches from wherever it was;
            // R434.4 — its location becomes the new Top-Most Card's.
            [context.sourceId]: {
              ...gear,
              attachedTo: targetId,
              location: host.location,
            },
          },
        },
        events: [{ type: "attached", playerId: context.controller, cardId: context.sourceId, to: targetId }],
      };
    }

    case "banishThenPlay": {
      const targetId = context.targets[effect.targetIndex];
      const battlefieldId = context.targets[effect.destinationIndex];
      if (targetId === undefined || battlefieldId === undefined) {
        return { state, events: [] };
      }
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };
      if (state.battlefields[battlefieldId] === undefined) {
        return { state, events: [] };
      }

      // R427 — banished first, and R186.1 means a token banished this way
      // ceases to exist rather than coming back.
      const owner = ownerOf(permanent);
      if (state.cards[targetId]?.isToken === true) {
        const { [targetId]: _gone, ...rest } = state.permanents;
        return {
          state: { ...state, permanents: rest },
          events: [{ type: "banished", playerId: owner, cardId: targetId }],
        };
      }

      const destination: Location = { kind: "battlefield", id: battlefieldId };
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            // R359.2.c — it is played, so it enters exhausted at the chosen
            // location. Its owner plays it, so its owner controls it (R56).
            [targetId]: {
              ...permanent,
              controller: owner,
              exhausted: true,
              location: destination,
              damage: 0,
            },
          },
          playedThisTurn: {
            ...state.playedThisTurn,
            [owner]: [...state.playedThisTurn[owner], targetId],
          },
        },
        events: [
          { type: "banished", playerId: owner, cardId: targetId },
          // A real play, so R383.4.a's play effects trigger off it.
          { type: "unitPlayed", playerId: owner, cardId: targetId },
        ],
      };
    }

    case "conditional": {
      const branch = holds(state, effect.test, context)
        ? effect.then
        : effect.otherwise;
      if (branch === undefined) return { state, events: [] };
      return execute(state, branch, context);
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
