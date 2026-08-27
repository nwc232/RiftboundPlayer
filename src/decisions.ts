import { chainItemCardId } from "./chain.js";
import { characteristicsOf, controllerOf, mightOf } from "./layers.js";
import { sameLocation } from "./state.js";
import type { CardId, GameState, PlayerId } from "./state.js";

/**
 * A choice the engine is waiting on. While one is outstanding nothing else may
 * proceed — R329.2 keeps a chain item Pending until its choices are made, and
 * R320.1 stops items finalizing or resolving in the meantime.
 */
export interface PendingDecision {
  player: PlayerId;
  prompt: DecisionPrompt;
}

export type DecisionPrompt =
  /**
   * R383.3.a — "you may" as the *first* clause makes performing the ability
   * itself optional, decided at finalization. Declining removes it from the
   * chain entirely (R383.3.a.2); it counts as never having triggered.
   */
  | { kind: "confirmOptional"; chainIndex: number }
  /**
   * R355.5 / R402.2 — targets are chosen as the item finalizes, not on
   * resolution. Asked one at a time, because R811.1.d.2.a and cards like
   * Star-Crossed ("a friendly unit *and* an enemy unit") judge each target
   * separately: `index` says which of the ability's filters is being answered.
   */
  | {
      kind: "chooseTargets";
      chainIndex: number;
      index: number;
      remaining: number;
      legal: CardId[];
    }
  /**
   * R117 — the setup Mulligan: set aside up to two cards, draw that many, then
   * recycle the ones set aside. Answering with none is a legal "keep".
   */
  | { kind: "mulligan"; max: number; legal: CardId[] }
  /**
   * R323.12/13 — when more than one showdown or combat is staged, the Turn
   * Player chooses which battlefield opens. Only raised when there is a genuine
   * choice; a single staged battlefield opens without asking.
   */
  | { kind: "chooseStagedBattlefield"; legal: CardId[] }
  /**
   * R465.2.c — which unit to assign combat damage to next. The amount is not
   * asked for: c.3 forces exactly lethal and c.4 forbids more while other units
   * are unassigned, so choosing the unit determines the number. Only raised
   * when more than one unit is legally assignable (R465.2.c.7).
   */
  /**
   * A choice made while an effect resolves: Stacked Deck's "put 1 into your
   * hand and recycle the rest", Sabotage's "choose a non-unit card from it".
   * `keep` is how many of `legal` are being asked for.
   */
  | { kind: "chooseFromRevealed"; legal: CardId[]; keep: number }
  /**
   * R436.1 — a Predict: which of the revealed cards to Recycle. Unlike
   * `chooseFromRevealed` the count is not fixed — "any number" includes none,
   * so an empty answer means "keep them all on top".
   */
  | { kind: "predict"; legal: CardId[] }
  /**
   * R436.1.a — the cards a Predict kept go back on top "in any order".
   * Answered with all of them, top first, because the order is the answer.
   */
  | { kind: "orderPredicted"; legal: CardId[] }
  /**
   * R372 — several replacement effects apply to one event, and "the controller
   * of the object being acted on determines the order the Replacement Effects
   * will apply". `subject` is what was about to happen to; `legal` is the
   * sources to pick from.
   */
  | { kind: "orderReplacements"; subject: CardId; legal: CardId[] }
  /**
   * R372 for damage. Answered with *every* source in the order they should
   * apply, because the order changes the number: the rules' example has
   * prevent-then-double landing differently from double-then-prevent.
   */
  | { kind: "orderDamage"; subject: CardId; amount: number; legal: CardId[] }
  | {
      kind: "assignCombatDamage";
      battlefieldId: CardId;
      /** Summed Might still to be assigned. */
      remaining: number;
      legal: CardId[];
    };

/**
 * R355.5 — what an ability chooses as it finalizes. One filter per target, so
 * "a friendly unit and an enemy unit" is two entries rather than a count: the
 * two are not interchangeable and R811.1.d.2.a judges each separately.
 */
export interface Targeting {
  filters: TargetFilter[];
}

/** What a targeted ability will accept. Deliberately small; grows with cards. */
export interface TargetFilter {
  /**
   * R355.6 — a permanent on the board, an item still on the chain, or a
   * battlefield (Thrill of the Hunt names one as a destination).
   */
  type: "unit" | "spellOnChain" | "battlefield";
  /** Relative to the ability's controller. */
  controller?: "enemy" | "friendly";
  location?: "battlefield";
  /**
   * "*another* friendly unit" — Pit Rookie, First Mate. R355.5 never excludes
   * the source by default, so the word "another" is what turns this on.
   */
  excludeSource?: true;
  /** Gust — "a unit at a battlefield with 3 [M] or less". */
  maxMight?: number;
  /** Evelynn, Entrancing — "an enemy unit at a *different* location". */
  awayFromSource?: true;
  /** Abandoned Hall — "a unit they control **here**". */
  atSource?: true;
  /** Defy — "a spell that costs no more than [4] and no more than [A]". */
  maxEnergy?: number;
  maxPower?: number;
}

export function legalTargets(
  state: GameState,
  controller: PlayerId,
  filter: TargetFilter,
  /** The ability's source, for the filters that are relative to it. */
  sourceId?: CardId,
): CardId[] {
  // A spell on the chain is not a permanent, so it is a different search: only
  // the controller filter means anything for one.
  if (filter.type === "spellOnChain") {
    return state.chain
      .filter((item) => {
        if (item.kind !== "spell") return false;
        if (filter.controller === "enemy" && item.controller === controller) {
          return false;
        }
        if (filter.controller === "friendly" && item.controller !== controller) {
          return false;
        }
        return true;
      })
      .filter((item) => {
        // Defy's ceilings, read from the card's current cost (R356.1.c keeps
        // "base cost" separate, and Defy asks what it *costs*).
        const cost = characteristicsOf(state, chainItemCardId(item)).cost;
        if (filter.maxEnergy !== undefined && cost.energy > filter.maxEnergy) {
          return false;
        }
        if (filter.maxPower !== undefined) {
          const power =
            cost.anyPower +
            Object.values(cost.power).reduce((sum, n) => sum + n, 0);
          if (power > filter.maxPower) return false;
        }
        return true;
      })
      .map((item) => chainItemCardId(item));
  }

  if (filter.type === "battlefield") {
    return state.battlefieldOrder.filter((battlefieldId) => {
      const its = state.battlefields[battlefieldId]?.controller;
      if (filter.controller === "friendly" && its !== controller) return false;
      if (filter.controller === "enemy" && its === controller) return false;
      return true;
    });
  }

  const here =
    sourceId === undefined ? undefined : state.permanents[sourceId]?.location;

  return Object.values(state.permanents)
    .filter((permanent) => {
      if (state.cards[permanent.cardId]?.type !== filter.type) return false;
      if (filter.excludeSource === true && permanent.cardId === sourceId) {
        return false;
      }

      const its = controllerOf(state, permanent.cardId);
      if (filter.controller === "enemy" && its === controller) return false;
      if (filter.controller === "friendly" && its !== controller) return false;
      if (
        filter.location === "battlefield" &&
        permanent.location.kind !== "battlefield"
      ) {
        return false;
      }
      // Read through the layers: Gust asks what a unit's Might *is*, which an
      // anthem or a buff has already had its say in (R477.3).
      if (
        filter.maxMight !== undefined &&
        mightOf(state, permanent.cardId) > filter.maxMight
      ) {
        return false;
      }
      // A source that is nowhere has no location to differ from, so nothing
      // qualifies rather than everything.
      if (filter.awayFromSource === true) {
        if (here === undefined) return false;
        if (sameLocation(here, permanent.location)) return false;
      }
      if (filter.atSource === true) {
        if (here === undefined) return false;
        if (!sameLocation(here, permanent.location)) return false;
      }
      return true;
    })
    .map((permanent) => permanent.cardId);
}
