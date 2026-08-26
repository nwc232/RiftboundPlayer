import { controllerOf, mightOf } from "./layers.js";
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
  /** R355.5 / R402.2 — targets are chosen as the item finalizes, not on resolution. */
  | { kind: "chooseTargets"; chainIndex: number; count: number; legal: CardId[] }
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
  | {
      kind: "assignCombatDamage";
      battlefieldId: CardId;
      /** Summed Might still to be assigned. */
      remaining: number;
      legal: CardId[];
    };

/** What a targeted ability will accept. Deliberately small; grows with cards. */
export interface TargetFilter {
  type: "unit";
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
}

export function legalTargets(
  state: GameState,
  controller: PlayerId,
  filter: TargetFilter,
  /** The ability's source, for the filters that are relative to it. */
  sourceId?: CardId,
): CardId[] {
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
      return true;
    })
    .map((permanent) => permanent.cardId);
}
