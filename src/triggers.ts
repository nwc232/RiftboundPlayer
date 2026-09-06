import type { Ability, AbilityCost, Effect } from "./abilities.js";
import type { ChainItem } from "./chain.js";
import type { Targeting } from "./decisions.js";
import { abilitiesOf, controllerOf } from "./layers.js";
import { holds } from "./conditions.js";
import type { Condition } from "./conditions.js";
import type { Mode } from "./abilities.js";
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
export type TriggerSubject = "self" | "friendly" | "enemy" | "any";

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
  /**
   * `here` and `nonToken` are Star Spring's — "the first time a player plays a
   * non-token unit **here** each turn". They narrow which plays count, not who
   * is watching, so they sit beside the subject rather than replacing it.
   */
  | { on: "unitPlayed"; subject: TriggerSubject; here?: true; nonToken?: true }
  | { on: "spellPlayed"; subject: TriggerSubject }
  /**
   * Astral Heron — "when you play your **first card** each turn". A card is
   * either, so this watches both events rather than making the card carry two
   * abilities that would each get their own once-per-turn allowance.
   */
  | { on: "cardPlayed"; subject: TriggerSubject }
  /**
   * R464.2 — Threshold of the Gray's "When combat starts here". Combat opening
   * is its own moment, distinct from the designations it hands out.
   */
  | { on: "combatStarted"; subject: "here" }
  | { on: "permanentKilled"; subject: TriggerSubject }
  /**
   * R827.2.a — becoming Empowered "is an event other Game Effects and
   * Triggered Abilities can reference". R828.1.d singles this one out: an
   * Empowered ability that is itself a "when I become Empowered" trigger is
   * active in time to fire on the very event that switched it on.
   */
  | { on: "empowered"; subject: TriggerSubject }
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
  | {
      on: "unitMoved";
      subject: TriggerSubject;
      to?: "battlefield";
      /**
       * Back-Alley Bar — "when a unit moves **from here**". The battlefield
       * watching its own space as an *origin* rather than a destination, which
       * is the mirror of `here` on the conditions that watch arrivals.
       */
      from?: "here";
    };

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
  /** Ignored when `modes` is present — the chosen mode supplies it instead. */
  effect: Effect;
  /**
   * Minah Swiftfoot — "when I move to a battlefield, choose one — …". Chosen
   * as the trigger finalizes, before its targets, because which targets it
   * even wants depends on the mode.
   */
  modes?: Mode[];
  /** Aphelios — "choose one that hasn't been chosen this turn". */
  distinctModes?: true;
  /**
   * R383.3.a — "you may" as the *first* clause of the effect makes performing
   * the ability itself optional, decided at finalization. A "you may" later in
   * the text is decided on resolution instead and is not this flag.
   */
  optional?: boolean;
  /** R355.5 — declared here, chosen by the controller as the trigger finalizes. */
  targeting?: Targeting;
  /**
   * Vex, Apathetic — "When an opponent plays a unit …, [Stun] **it**." The
   * object is named by the trigger's own condition, so there is nothing to
   * choose: it is not a target, and R355.5's choice step never happens.
   */
  targetsSubject?: true;
  /**
   * R383.3.b — "If a Triggered Ability contains a cost within instructions at
   * the beginning of the effect or immediately following the 'you may'…, that
   * cost is treated as the base cost of the Triggered Ability." R383.3.b.1:
   * it "must be paid in order to finalize the Triggered Ability to the Chain",
   * so an unpayable one takes the trigger back off.
   */
  costs?: AbilityCost[];
  /**
   * R383.3.e — "once each turn". R383.3.e.1: once performed that many times it
   * does not trigger at all, rather than triggering and doing nothing.
   */
  oncePerTurn?: true;
  /**
   * Abandoned Hall — "When a player plays a spell, **they** may give a unit
   * **they** control here +1 [M]." The ability's controller is the player who
   * caused the event, not the battlefield's controller, and every "you" in the
   * effect follows it.
   */
  controllerIsEventPlayer?: true;
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
    // Abandoned Hall and Star Spring watch *a player*, either one.
    case "any":
      return true;
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

/**
 * The battlefield an event happened at, when it names one. This is what an
 * ability's "there" resolves to — Deceiver's "when you conquer or hold … play
 * a Reflection token there". Distinct from the source's own location, which is
 * what "here" resolves to and which a Legend does not have (R107.4.b).
 */
function locationNamedBy(event: GameEvent): Location | undefined {
  if ("battlefieldId" in event) {
    return { kind: "battlefield", id: event.battlefieldId };
  }
  // R323.4 — a death notes where it stood, so "there" still means something
  // for an ability watching one.
  if (event.type === "unitKilled") return event.location;
  // R359.3.f.3 — "information a trigger reads off its condition is noted when
  // the condition is fulfilled". Irresistible Faefolk's "when I move to a
  // battlefield, you may move an enemy unit to *that* battlefield" names the
  // move's destination, and it means that battlefield whatever becomes of the
  // Faefolk afterwards — bounced to hand by Gust before the trigger resolved,
  // it used to mean nothing at all.
  if (event.type === "unitMoved" && event.to.kind === "battlefield") {
    return event.to;
  }
  return undefined;
}

function matches(
  state: GameState,
  condition: TriggerCondition,
  event: GameEvent,
  sourceId: CardId,
  controller: PlayerId,
): boolean {
  switch (condition.on) {
    case "unitPlayed": {
      if (event.type !== "unitPlayed") return false;
      // R185.1 — "token" is intrinsic, so this is a property of the card.
      if (condition.nonToken === true && state.cards[event.cardId]?.isToken) {
        return false;
      }
      // "here" is about where the *played* unit landed, not where its
      // controller is: the battlefield is watching its own space.
      if (condition.here === true && !atBattlefield(state, event.cardId, sourceId)) {
        return false;
      }
      return subjectMatches(
        condition.subject,
        event.cardId,
        event.playerId,
        sourceId,
        controller,
      );
    }
    case "empowered":
      return (
        event.type === "empowered" &&
        subjectMatches(
          condition.subject,
          event.cardId,
          event.playerId,
          sourceId,
          controller,
        )
      );

    case "cardPlayed":
      return (
        (event.type === "unitPlayed" || event.type === "spellPlayed") &&
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
    case "combatStarted":
      return (
        event.type === "combatOpened" && event.battlefieldId === sourceId
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
        // "from here" is about where the move *started*, so it is read off the
        // event rather than off where the unit stands now.
        (condition.from !== "here" ||
          (event.from.kind === "battlefield" && event.from.id === sourceId)) &&
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

/** What an event is *about*, for a trigger whose effect says "it". */
function subjectOf(event: GameEvent): (CardId | undefined)[] {
  return "cardId" in event ? [event.cardId] : [];
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
export interface TriggerHarvest {
  items: ChainItem[];
  /** R383.3.e.1 — updated counts for anything that triggers "each turn". */
  triggeredThisTurn: GameState["triggeredThisTurn"];
}

export function collectTriggers(state: GameState, events: GameEvent[]): ChainItem[] {
  return harvestTriggers(state, events).items;
}

export function harvestTriggers(
  state: GameState,
  events: GameEvent[],
): TriggerHarvest {
  const found: { controller: PlayerId; item: ChainItem }[] = [];
  const counts = { ...state.triggeredThisTurn };

  for (const {
    sourceId,
    controller,
    location,
    might,
    abilities,
  } of triggerSources(state, events)) {
    // A killed source uses the rules text noted before it left the board;
    // anything still there is read live through the layers.
    (abilities ?? abilitiesOf(state, sourceId)).forEach((ability, index) => {
      if (ability.kind !== "triggered") return;
      const inciting = events.find((event) =>
        matches(state, ability.trigger, event, sourceId, controller),
      );
      if (inciting === undefined) return;

      // R383.3.e.1 — already performed its allowance this turn, so it "does
      // not trigger" rather than triggering and doing nothing.
      const tally = `${sourceId}#${index}`;
      if (ability.oncePerTurn === true && (counts[tally] ?? 0) >= 1) return;

      // Abandoned Hall's "when a player plays a spell, **they** may…" — the
      // ability belongs to whoever acted, and every "you" in it follows.
      const actor =
        ability.controllerIsEventPlayer === true && "playerId" in inciting
          ? inciting.playerId
          : controller;

      // R383.2.a.1 — the gate is part of the Condition, so a false one means
      // the ability never triggered at all rather than resolving to nothing.
      if (
        ability.requires !== undefined &&
        !holds(state, ability.requires, {
          controller: actor,
          sourceId,
          // Targets are chosen at finalization (R355.5), so a gate can only ask
          // about the source and the board.
          targets: [],
          ...(location !== undefined ? { sourceLocation: location } : {}),
        })
      ) {
        return;
      }

      if (ability.oncePerTurn === true) counts[tally] = (counts[tally] ?? 0) + 1;

      // "There" — the battlefield the inciting event names, for the abilities
      // whose effect points at it rather than at their own source.
      const eventLocation = locationNamedBy(inciting);
      // R359.3.f.3 — information a trigger reads off its condition is noted
      // when the condition is fulfilled, not when the ability resolves. Where
      // a unit moved *from* is gone by then.
      const moveEndpoints =
        inciting.type === "unitMoved" ? [inciting.from, inciting.to] : undefined;

      found.push({
        controller: actor,
        item: {
          kind: "trigger",
          sourceId,
          ability,
          controller: actor,
          targets:
            ability.targetsSubject === true
              ? subjectOf(inciting).filter((id) => id !== undefined)
              : [],
          ...(location !== undefined ? { sourceLocation: location } : {}),
          ...(eventLocation !== undefined ? { eventLocation } : {}),
          ...(moveEndpoints !== undefined ? { moveEndpoints } : {}),
          ...(might !== undefined ? { sourceMight: might } : {}),
        },
      });
    });
  }

  const turnPlayer = state.turn.player;
  return {
    items: [
      ...found.filter((f) => f.controller === turnPlayer).map((f) => f.item),
      ...found.filter((f) => f.controller !== turnPlayer).map((f) => f.item),
    ],
    triggeredThisTurn: counts,
  };
}
