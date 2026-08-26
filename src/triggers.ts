import type { Ability, Effect } from "./abilities.js";
import type { ChainItem } from "./chain.js";
import type { Targeting } from "./decisions.js";
import { abilitiesOf, controllerOf } from "./layers.js";
import { holds } from "./conditions.js";
import type { Condition } from "./conditions.js";
import type { GameEvent } from "./events.js";
import type { ScoreMethod } from "./scoring.js";
import type { Phase } from "./turn.js";
import type {
  CardId,
  Designation,
  GameState,
  Location,
  PlayerId,
} from "./state.js";

/**
 * Who a trigger is watching, relative to its own source. Riftbound's card text
 * makes this distinction with pronouns — "when you play me" is `self`, "when
 * you play a unit" is `friendly`, "when an opponent plays a unit" is `enemy` —
 * so the subject is a field rather than a different condition per phrasing.
 *
 * `friendly` includes the source itself. No card so far says "another", and
 * R383 gives no general rule excluding the source, so narrowing waits for a
 * card that actually asks for it.
 */
export type TriggerSubject = "self" | "friendly" | "enemy";

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
  | { on: "unitPlayed"; subject: TriggerSubject }
  | { on: "spellPlayed"; subject: TriggerSubject }
  | { on: "permanentKilled"; subject: TriggerSubject }
  /**
   * R471.2 — Score abilities trigger "at the Battlefield that Scored", so
   * `here` covers both the battlefield card itself and a unit standing on it.
   * A Legend scores nothing "here" (R107.4.b: the Legend Zone is not a
   * location), which is what `controller` is for — Gloomist's "when you hold".
   */
  | {
      on: "battlefieldScored";
      subject: "here" | "controller";
      method?: ScoreMethod;
    }
  /** R816.1.c — "the controller of the permanent's Beginning Phase starting". */
  | { on: "phaseBegan"; phase: Phase; subject: "controller" }
  /**
   * R464.2.c.3/R464.2.e — "when I attack" / "when I defend", watching the
   * moment a designation is gained. Omitting `designation` covers Kha'Zix's
   * "when I attack or defend".
   */
  | { on: "designated"; subject: "self"; designation?: Designation }
  /**
   * R466.3 — "when I win a combat". R466.3.c passes the controller's result
   * down to their units, so this is "my controller won, and I am still here".
   */
  | { on: "combatWon"; subject: "self" }
  /** R420 — "when I move to a battlefield" (Irresistible Faefolk). */
  | { on: "unitMoved"; subject: TriggerSubject; to?: "battlefield" };

export interface TriggeredAbility {
  kind: "triggered";
  trigger: TriggerCondition;
  /**
   * R383.2.a.1 — "any additional conditional statement immediately after the
   * Condition must be true in order for the Condition to be fulfilled. Such a
   * conditional statement is part of the Trigger Condition and not the Effect."
   *
   * So "when X, if Y, do Z" is this, and "when X, do Z if Y" is a `conditional`
   * inside the effect. Position in the printed text is what separates them, and
   * the difference is observable: this is checked once, when the trigger would
   * fire, and never again — the Sona example says that if she is removed in
   * reaction to the ability, "it will still resolve".
   */
  requires?: Condition;
  effect: Effect;
  /**
   * R383.3.a — "you may" as the *first* clause of the effect makes performing
   * the ability itself optional, decided at finalization. A "you may" later in
   * the text is decided on resolution instead and is not this flag.
   */
  optional?: boolean;
  /** R355.5 — declared here, chosen by the controller as the trigger finalizes. */
  targeting?: Targeting;
}

/**
 * Whether an event about `eventCardId`, caused by `eventPlayer`, is the one
 * this subject watches. `self` is about identity; the other two are about
 * whose card it was, which is how the card text reads.
 */
function subjectMatches(
  subject: TriggerSubject,
  eventCardId: CardId,
  eventPlayer: PlayerId,
  sourceId: CardId,
  controller: PlayerId,
): boolean {
  switch (subject) {
    case "self":
      return eventCardId === sourceId;
    case "friendly":
      return eventPlayer === controller;
    case "enemy":
      return eventPlayer !== controller;
    default: {
      const unhandled: never = subject;
      return false;
    }
  }
}

/** Where a source stands right now, or undefined if it is not on the board. */
function locationOf(state: GameState, sourceId: CardId): Location | undefined {
  return state.permanents[sourceId]?.location;
}

function atBattlefield(
  state: GameState,
  sourceId: CardId,
  battlefieldId: CardId,
): boolean {
  const location = locationOf(state, sourceId);
  return location?.kind === "battlefield" && location.id === battlefieldId;
}

function matches(
  state: GameState,
  condition: TriggerCondition,
  event: GameEvent,
  sourceId: CardId,
  controller: PlayerId,
): boolean {
  switch (condition.on) {
    case "unitPlayed":
      return (
        event.type === "unitPlayed" &&
        subjectMatches(
          condition.subject,
          event.cardId,
          event.playerId,
          sourceId,
          controller,
        )
      );
    case "spellPlayed":
      return (
        event.type === "spellPlayed" &&
        subjectMatches(
          condition.subject,
          event.cardId,
          event.playerId,
          sourceId,
          controller,
        )
      );
    case "permanentKilled":
      return (
        event.type === "unitKilled" &&
        subjectMatches(
          condition.subject,
          event.cardId,
          event.playerId,
          sourceId,
          controller,
        )
      );
    case "battlefieldScored":
      if (
        event.type !== "battlefieldScored" ||
        event.playerId !== controller ||
        (condition.method !== undefined && condition.method !== event.method)
      ) {
        return false;
      }
      // R471.2 — the battlefield that scored, or anything standing on it.
      return (
        condition.subject === "controller" ||
        event.battlefieldId === sourceId ||
        atBattlefield(state, sourceId, event.battlefieldId)
      );
    case "phaseBegan":
      return (
        event.type === "phaseBegan" &&
        event.phase === condition.phase &&
        event.playerId === controller
      );
    case "designated":
      return (
        event.type === "designated" &&
        event.cardId === sourceId &&
        (condition.designation === undefined ||
          condition.designation === event.designation)
      );
    case "combatWon":
      return (
        event.type === "combatResolved" &&
        event.winner === controller &&
        atBattlefield(state, sourceId, event.battlefieldId)
      );
    case "unitMoved":
      return (
        event.type === "unitMoved" &&
        (condition.to === undefined || event.to.kind === condition.to) &&
        subjectMatches(
          condition.subject,
          event.cardId,
          event.playerId,
          sourceId,
          controller,
        )
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
 * Everything that could be watching. Permanents, battlefields and each player's
 * Champion Legend are the live sources; a killed permanent is included via the
 * event itself, because R428.1.a.1.b puts a death trigger on the chain even
 * though its source has already left the board.
 */
function triggerSources(state: GameState, events: GameEvent[]): TriggerSource[] {
  const sources: TriggerSource[] = Object.values(state.permanents).map(
    (permanent) => ({
      sourceId: permanent.cardId,
      controller: controllerOf(state, permanent.cardId),
    }),
  );

  // R107.4.c — the Champion Legend in the Legend Zone is a Game Object, and it
  // never leaves (R107.4.d), so its abilities are always watching. It is not a
  // permanent, so its controller is the player whose zone it sits in rather
  // than anything `controllerOf` could tell us.
  for (const player of Object.values(state.players)) {
    if (player.legend !== null) {
      sources.push({ sourceId: player.legend, controller: player.id });
    }
  }

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
        matches(state, ability.trigger, event, sourceId, controller),
      );
      if (!fired) return;

      // R383.2.a.1 — the gate is part of the Condition, so a false one means
      // the ability never triggered at all rather than resolving to nothing.
      if (
        ability.requires !== undefined &&
        !holds(state, ability.requires, {
          controller,
          sourceId,
          // Targets are chosen at finalization (R355.5), so a gate can only ask
          // about the source and the board.
          targets: [],
          ...(location !== undefined ? { sourceLocation: location } : {}),
        })
      ) {
        return;
      }

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
