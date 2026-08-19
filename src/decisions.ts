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
}

export function legalTargets(
  state: GameState,
  controller: PlayerId,
  filter: TargetFilter,
): CardId[] {
  return Object.values(state.permanents)
    .filter((permanent) => {
      if (state.cards[permanent.cardId]?.type !== filter.type) return false;

      if (filter.controller === "enemy" && permanent.controller === controller) {
        return false;
      }
      if (
        filter.controller === "friendly" &&
        permanent.controller !== controller
      ) {
        return false;
      }
      if (
        filter.location === "battlefield" &&
        permanent.location.kind !== "battlefield"
      ) {
        return false;
      }
      return true;
    })
    .map((permanent) => permanent.cardId);
}
