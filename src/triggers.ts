import type { Ability, Effect } from "./abilities.js";
import type { ChainItem } from "./chain.js";
import type { TargetFilter } from "./decisions.js";
import { abilitiesOf, controllerOf } from "./layers.js";
import type { GameEvent } from "./events.js";
import type { ScoreMethod } from "./scoring.js";
import type { Phase } from "./turn.js";
import type { CardId, GameState, Location, PlayerId } from "./state.js";

/**
 * R383 — a triggered ability is a Condition plus an Effect. The condition is
 * an event paired with a subject, not a bare keyword: "when I enter" and "when
 * another unit enters" share an event and differ only in who they watch.
 *
 * Note "as" is deliberately absent. R369.1 makes "as X happens" a replacement
 * effect, which modifies the event rather than firing after it — a different
 * mechanism, not a spelling of this one.
 */
export type TriggerCondition =
  | { on: "unitPlayed"; subject: "self" }
  | { on: "permanentKilled"; subject: "self" }
  | { on: "battlefieldScored"; subject: "here"; method?: ScoreMethod }
  /** R816.1.c — "the controller of the permanent's Beginning Phase starting". */
  | { on: "phaseBegan"; phase: Phase; subject: "controller" };

export interface TriggeredAbility {
  kind: "triggered";
  trigger: TriggerCondition;
  effect: Effect;
  /**
   * R383.3.a — "you may" as the *first* clause of the effect makes performing
   * the ability itself optional, decided at finalization. A "you may" later in
   * the text is decided on resolution instead and is not this flag.
   */
  optional?: boolean;
  /** R355.5 — declared here, chosen by the controller as the trigger finalizes. */
  targeting?: { count: number; filter: TargetFilter };
}

function matches(
  condition: TriggerCondition,
  event: GameEvent,
  sourceId: CardId,
  controller: PlayerId,
): boolean {
  switch (condition.on) {
    case "unitPlayed":
      return event.type === "unitPlayed" && event.cardId === sourceId;
    case "permanentKilled":
      return event.type === "unitKilled" && event.cardId === sourceId;
    case "battlefieldScored":
      return (
        event.type === "battlefieldScored" &&
        event.battlefieldId === sourceId &&
        (condition.method === undefined || condition.method === event.method)
      );
    case "phaseBegan":
      return (
        event.type === "phaseBegan" &&
        event.phase === condition.phase &&
        event.playerId === controller
      );
    default: {
      const unhandled: never = condition;
      return false;
    }
  }
}

interface TriggerSource {
  sourceId: CardId;
  controller: PlayerId;
  /** Only for a source that has already left the board — see R323.4. */
  location?: Location;
  might?: number;
  /** Noted before the kill, so a copy's rules text is still readable. */
  abilities?: Ability[];
}

/**
 * Everything that could be watching. Permanents and battlefields are the live
 * sources; a killed permanent is included via the event itself, because
 * R428.1.a.1.b puts a death trigger on the chain even though its source has
 * already left the board.
 */
function triggerSources(state: GameState, events: GameEvent[]): TriggerSource[] {
  const sources: TriggerSource[] = Object.values(state.permanents).map(
    (permanent) => ({
      sourceId: permanent.cardId,
      controller: controllerOf(state, permanent.cardId),
    }),
  );

  for (const battlefieldId of state.battlefieldOrder) {
    const controller = state.battlefields[battlefieldId]?.controller;
    // R190.6.d — with no controller, "you" refers to nobody and the ability's
    // instructions are ignored, so an uncontrolled battlefield watches nothing.
    if (controller != null) {
      sources.push({ sourceId: battlefieldId, controller });
    }
  }

  for (const event of events) {
    if (event.type === "unitKilled") {
      sources.push({
        sourceId: event.cardId,
        controller: event.playerId,
        location: event.location,
        might: event.might,
        abilities: event.abilities,
      });
    }
  }

  return sources;
}

/**
 * Scans `events` for anything that fires a triggered ability, returning the
 * resulting chain items in the order they should be added.
 *
 * R383.3.d.1 — when several trigger at once, the turn player adds theirs first,
 * then the other player. Order within one player's own set is that player's
 * choice; board order is used, which is one of the legal orderings.
 */
export function collectTriggers(
  state: GameState,
  events: GameEvent[],
): ChainItem[] {
  const found: { controller: PlayerId; item: ChainItem }[] = [];

  for (const {
    sourceId,
    controller,
    location,
    might,
    abilities,
  } of triggerSources(state, events)) {
    // A killed source uses the rules text noted before it left the board;
    // anything still there is read live through the layers.
    (abilities ?? abilitiesOf(state, sourceId)).forEach((ability) => {
      if (ability.kind !== "triggered") return;
      const fired = events.some((event) =>
        matches(ability.trigger, event, sourceId, controller),
      );
      if (!fired) return;

      found.push({
        controller,
        item: {
          kind: "trigger",
          sourceId,
          ability,
          controller,
          targets: [],
          ...(location !== undefined ? { sourceLocation: location } : {}),
          ...(might !== undefined ? { sourceMight: might } : {}),
        },
      });
    });
  }

  const turnPlayer = state.turn.player;
  return [
    ...found.filter((f) => f.controller === turnPlayer).map((f) => f.item),
    ...found.filter((f) => f.controller !== turnPlayer).map((f) => f.item),
  ];
}
