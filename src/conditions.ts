import { controllerOf, mightOf } from "./layers.js";
import { permanentsAt } from "./state.js";
import type { CardId, GameState, Location, PlayerId } from "./state.js";

/**
 * A yes/no question a card asks about the board. Deliberately a short list of
 * concrete questions rather than an expression language: every entry here is
 * one a printed card actually asks, and the card is named beside it.
 */
export type Condition =
  /** Vex, Apathetic — "while I'm at a battlefield"; Sona, Harmonious — "if I'm at a battlefield". */
  | { kind: "sourceAtBattlefield" }
  /** Kinkou Initiate — "if your other units have total Might 5 or more". */
  | { kind: "totalMight"; of: "otherFriendlyUnits"; atLeast: number }
  /**
   * En Garde — "if it is the only unit you control there" (`target`,
   * `friendly`); Kha'Zix, Mutating Horror — "if an enemy unit is alone here"
   * (`source`, `enemy`).
   */
  | {
      kind: "aloneThere";
      subject: "source" | "target";
      units: "friendly" | "enemy";
      targetIndex?: number;
    }
  /**
   * R812.1.c — [Legion]: "as long as a card different than the one with the
   * Legion ability has been Finalized by you on the same turn". Noxus Hopeful.
   */
  | { kind: "legion" };

/**
 * What a condition is asked *about*. `EffectContext` satisfies this
 * structurally, so an effect can pass itself straight through; a trigger gate
 * builds one with no targets, because targets are chosen later (R355.5).
 */
export interface ConditionContext {
  controller: PlayerId;
  sourceId: CardId;
  targets: CardId[];
  /** Where the source stood when it triggered, if it has since left (R323.4). */
  sourceLocation?: Location;
}

function locationOf(
  state: GameState,
  cardId: CardId,
  context: ConditionContext,
): Location | undefined {
  const live = state.permanents[cardId]?.location;
  if (live !== undefined) return live;
  return cardId === context.sourceId ? context.sourceLocation : undefined;
}

function unitsAtLocation(state: GameState, location: Location) {
  return permanentsAt(state, location).filter(
    (permanent) => state.cards[permanent.cardId]?.type === "unit",
  );
}

export function holds(
  state: GameState,
  condition: Condition,
  context: ConditionContext,
): boolean {
  switch (condition.kind) {
    case "sourceAtBattlefield": {
      const location = locationOf(state, context.sourceId, context);
      return location?.kind === "battlefield";
    }

    case "totalMight": {
      const total = Object.values(state.permanents)
        .filter(
          (permanent) =>
            permanent.cardId !== context.sourceId &&
            state.cards[permanent.cardId]?.type === "unit" &&
            controllerOf(state, permanent.cardId) === context.controller,
        )
        .reduce((sum, permanent) => sum + mightOf(state, permanent.cardId), 0);
      return total >= condition.atLeast;
    }

    case "aloneThere": {
      const subjectId =
        condition.subject === "source"
          ? context.sourceId
          : context.targets[condition.targetIndex ?? 0];
      if (subjectId === undefined) return false;

      const location = locationOf(state, subjectId, context);
      if (location === undefined) return false;

      const matching = unitsAtLocation(state, location).filter((permanent) => {
        const friendly =
          controllerOf(state, permanent.cardId) === context.controller;
        return condition.units === "friendly" ? friendly : !friendly;
      });
      return matching.length === 1;
    }

    case "legion":
      // R812.2 — one other card satisfies every Legion ability at once, which
      // is exactly "is there any card here that isn't me".
      return state.playedThisTurn[context.controller].some(
        (cardId) => cardId !== context.sourceId,
      );

    default: {
      const unhandled: never = condition;
      return false;
    }
  }
}
