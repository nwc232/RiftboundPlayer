import { controllerOf, mightOf } from "./layers.js";
import { permanentsAt, playedBy, seatOf } from "./state.js";
import type {
  CardId,
  CardType,
  GameState,
  Location,
  PlayerId,
  PlaySource,
} from "./state.js";

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
  | { kind: "legion" }
  /**
   * R205 — "the later instruction checks whether the game action was
   * performed, not whether a cost was paid". Pyke, Dockside Butcher's "if you
   * paid the additional cost"; Rampage's the same.
   */
  | { kind: "paidAdditionalCost" }
  /** R728 — "[Level N]" and anything else gated on a player's XP. */
  | { kind: "hasXP"; atLeast: number }
  /**
   * R441.1.b / R827.1.c.1 — "an Empowered Game Object can not be Empowered",
   * which the [Empower] keyword spells out as "Play only if not Empowered".
   */
  | { kind: "notEmpowered" }
  /** Helm of Suppression — "if this is [Empowered], they cost [2] more instead". */
  | { kind: "empowered" }
  /** Mystic Vortex — "during showdowns here"; Vex, Cheerless — "while I'm in combat". */
  | { kind: "inShowdown"; here?: true }
  /**
   * R424.1.a.1 — "other cards … can reference the act of being Revealed".
   * "Then if you revealed a Bird, Cat, Dog, or Poro, do this: …" asks by tag;
   * "if it's a unit" asks by type. Both read the cards revealed so far by the
   * spell that is resolving (R424.1.a.3).
   */
  | { kind: "revealed"; type?: CardType; tag?: string }
  /**
   * Back Off — "If you played this from your hand, draw 1"; Evelynn,
   * Entrancing — "When you play me from face down". R811.3 is what makes the
   * question worth asking: a [Hidden] card may always be played normally
   * instead, so the same card arrives by two routes.
   */
  | { kind: "playedFrom"; zone: PlaySource }
  /** Evelynn, Entrancing — "…on your turn". */
  | { kind: "yourTurn" }
  /**
   * Evelynn, Entrancing — "when you play me from face down **on your turn**".
   * R383.2.a.1 allows a whole conditional statement, not just one clause.
   */
  | { kind: "all"; of: Condition[] }
  /** Xin Zhao, Vigilant — "if you have two or more other units in your base". */
  | { kind: "controlsOtherUnits"; atLeast: number };

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
  /**
   * R356.2.b — set while resolving a spell that was played with its optional
   * additional cost paid. A unit records it on its permanent instead, because
   * its play effect triggers after the card has already entered.
   */
  paidAdditionalCost?: boolean;
  /** Which zone a resolving spell was played from; units record it on the permanent. */
  playedFrom?: PlaySource;
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

    case "paidAdditionalCost":
      return (
        context.paidAdditionalCost ??
        state.permanents[context.sourceId]?.paidAdditionalCost === true
      );

    case "playedFrom": {
      const zone =
        context.playedFrom ?? state.permanents[context.sourceId]?.playedFrom;
      return zone === condition.zone;
    }

    case "yourTurn":
      return state.turn.player === context.controller;

    case "all":
      return condition.of.every((each) => holds(state, each, context));

    case "controlsOtherUnits": {
      const count = Object.values(state.permanents).filter(
        (permanent) =>
          permanent.cardId !== context.sourceId &&
          state.cards[permanent.cardId]?.type === "unit" &&
          controllerOf(state, permanent.cardId) === context.controller,
      ).length;
      return count >= condition.atLeast;
    }

    case "hasXP":
      return seatOf(state, context.controller).xp >= condition.atLeast;

    // R441.1.b — asked of the ability's own source, which is what R827.1.b.1
    // means by "the source game object is not a target of the Empower ability".
    case "revealed":
      return state.revealed.some((cardId) => {
        const card = state.cards[cardId];
        if (card === undefined) return false;
        if (condition.type !== undefined && card.type !== condition.type) {
          return false;
        }
        return (
          condition.tag === undefined ||
          (card.tags ?? []).includes(condition.tag)
        );
      });

    case "empowered":
      return (
        state.permanents[context.sourceId]?.empowered === true ||
        // R107.4.c — the Legend's status lives on the player, having no
        // permanent of its own.
        (seatOf(state, context.controller).legend === context.sourceId &&
          seatOf(state, context.controller).legendEmpowered === true)
      );

    case "inShowdown": {
      if (state.showdown === null) return false;
      if (condition.here !== true) return true;
      // "Here" for a battlefield is itself; for a unit, where it stands.
      const where = locationOf(state, context.sourceId, context);
      return (
        state.showdown.battlefieldId === context.sourceId ||
        (where?.kind === "battlefield" &&
          where.id === state.showdown.battlefieldId)
      );
    }

    // R827.1.c.1's "Play only if not Empowered", which is the gate on the
    // [Empower] ability itself. Reads the Legend's status too, or a Legend
    // could Empower itself a second time.
    case "notEmpowered":
      return !holds(state, { kind: "empowered" }, context);

    case "legion":
      // R812.2 — one other card satisfies every Legion ability at once, which
      // is exactly "is there any card here that isn't me".
      return playedBy(state, context.controller).some(
        (cardId) => cardId !== context.sourceId,
      );

    default: {
      const unhandled: never = condition;
      return false;
    }
  }
}
