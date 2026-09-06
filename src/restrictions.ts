import type { BoardRestriction } from "./abilities.js";
import { holds } from "./conditions.js";
import { controllerOf } from "./layers.js";
import { isSeated, sameLocation } from "./state.js";
import type { CardId, GameState, Location, PlayerId } from "./state.js";

/**
 * The "can't" rules whose subject is not a permanent — a player, a
 * battlefield, or a spell on the chain.
 *
 * `layers.ts` answers the other half, for subjects that *are* permanents. The
 * split is R711's line rather than a convenience: a permanent goes through the
 * layer pipeline, and everything else has to have the board swept for it when
 * the question is asked, exactly as `costAurasFor` does for a card in a hand.
 *
 * Every reader here takes the same shape — find the auras, filter them by whom
 * they name and where they reach, ask whether any of them bites. A restriction
 * never loosens another, so "some" is always the right quantifier.
 */

interface AuraSource {
  restriction: BoardRestriction;
  /** Null for an uncontrolled battlefield — see R190.6.d. */
  controller: PlayerId | null;
  location: Location | undefined;
}

/**
 * Every restriction aura on the board, with where it is and whose it is.
 *
 * Unlike `boardAuraSources`, an *uncontrolled* battlefield is included.
 * R190.6.d ignores a battlefield's instructions when they say "you" and nobody
 * holds it — but Rockfall Path's "Units can't be played here" says no such
 * thing, and an aura naming a side is filtered out below on its own.
 */
function auras(state: GameState, what: BoardRestriction["what"]): AuraSource[] {
  const found: AuraSource[] = [];

  // Brynhir, Lilting Lullaby — the durational half. Its `targetId` *is* the
  // restricted player, so it names no side: reading it as `affects: friendly`
  // over that player makes it answer `reaches` unchanged.
  for (const modifier of state.modifiers) {
    if (modifier.modification.op !== "restrictPlayer") continue;
    if (modifier.modification.restriction.what !== what) continue;
    if (!isSeated(state, modifier.targetId)) continue;
    found.push({
      restriction: {
        ...modifier.modification.restriction,
        affects: "friendly",
      },
      controller: modifier.targetId,
      location: undefined,
    });
  }

  const consider = (
    sourceId: CardId,
    controller: PlayerId | null,
    location: Location | undefined,
  ) => {
    for (const ability of state.cards[sourceId]?.abilities ?? []) {
      if (ability.kind !== "restrictionAura") continue;
      if (ability.what !== what) continue;
      // An aura that names a side needs a side to be relative to.
      if (ability.affects !== "any" && controller === null) continue;
      if (
        ability.when !== undefined &&
        !holds(state, ability.when, {
          controller: controller ?? "p1",
          sourceId,
          targets: [],
        })
      ) {
        continue;
      }
      found.push({ restriction: ability, controller, location });
    }
  };

  for (const permanent of Object.values(state.permanents)) {
    consider(
      permanent.cardId,
      controllerOf(state, permanent.cardId),
      permanent.location,
    );
  }
  for (const player of Object.values(state.players)) {
    if (player.legend !== null) consider(player.legend, player.id, undefined);
  }
  for (const battlefieldId of state.battlefieldOrder) {
    consider(battlefieldId, state.battlefields[battlefieldId]?.controller ?? null, {
      kind: "battlefield",
      id: battlefieldId,
    });
  }

  return found;
}

/** Whether an aura naming a side reaches `playerId`. */
function reaches(source: AuraSource, playerId: PlayerId): boolean {
  const mine = source.controller === playerId;
  if (source.restriction.affects === "friendly") return mine;
  if (source.restriction.affects === "enemy") return !mine;
  return true;
}

/**
 * "…*here*" — the aura only reaches its own battlefield. A source that is
 * nowhere reaches nothing rather than everything, the same reading
 * `awayFromSource` takes in `legalTargets`.
 */
function coversLocation(source: AuraSource, location: Location | undefined): boolean {
  if (source.restriction.here !== true) return true;
  if (source.location === undefined || location === undefined) return false;
  return sameLocation(source.location, location);
}

/**
 * Tianna Crownguard — "While I'm at a battlefield, opponents can't score
 * points." Forgotten Monument — "Players can't score here until their third
 * turn."
 *
 * R470 makes scoring the usual consequence of holding a battlefield, so this
 * is asked of the battlefield being scored rather than of the player alone.
 */
export function cannotScore(
  state: GameState,
  playerId: PlayerId,
  battlefieldId: CardId,
): boolean {
  const location: Location = { kind: "battlefield", id: battlefieldId };
  return auras(state, "score").some((source) => {
    if (!reaches(source, playerId)) return false;
    if (!coversLocation(source, location)) return false;
    // "until their *third* turn" counts that player's own turns, which is what
    // `turn.number` tracks — both players share the count, so the third turn
    // of the game is not the third turn of the player who went second.
    if (source.restriction.untilTurn !== undefined) {
      return state.turn.number < source.restriction.untilTurn;
    }
    return true;
  });
}

/**
 * Brynhir Thundersong — "opponents can't play cards this turn"; Lilting
 * Lullaby — "its controller can't play spells this turn"; Fallen Feline —
 * "opponents can't play spells with that name"; Mageseeker Warden —
 * "opponents can only play units to their base"; Rockfall Path — "Units can't
 * be played here".
 *
 * One question, because they differ only in what they name: the player, the
 * card, and the destination are all qualifiers on the same restriction.
 */
export function cannotPlay(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  destination?: Location,
): boolean {
  const card = state.cards[cardId];
  if (card === undefined) return false;

  return auras(state, "play").some((source) => {
    if (!reaches(source, playerId)) return false;

    const match = source.restriction.match;
    if (match?.type !== undefined && card.type !== match.type) return false;
    if (match?.name !== undefined && card.name !== match.name) return false;

    // "…can only play units to their base" forbids everywhere *but* the base,
    // which is the one qualifier that inverts rather than narrows.
    if (source.restriction.exceptToBase === true) {
      return destination !== undefined && destination.kind !== "base";
    }
    // Rockfall Path restricts a destination; Brynhir restricts the play
    // outright. With no destination in hand the narrower one does not answer.
    return coversLocation(source, destination);
  });
}

/**
 * Mel, Newly Awakened — "your spells and abilities can't be countered".
 *
 * Decree of Rage's printed "This can't be countered" is the [Uncounterable]
 * keyword instead, read straight off the card: R711 leaves a spell on the
 * chain on its printed values, and a keyword is one.
 */
export function cannotBeCountered(
  state: GameState,
  cardId: CardId,
  controller: PlayerId,
): boolean {
  return auras(state, "beCountered").some((source) =>
    reaches(source, controller),
  );
}

/**
 * Noxus Saboteur — "Your opponents' [Hidden] cards can't be revealed here."
 *
 * R421.4 is the whole of what this can forbid: nothing else in the pool
 * reveals a facedown card. Scuttle Crab's "you can look at their facedown
 * cards" is not a reveal — R424.2.b says showing Private information "does
 * not count as revealing and does not trigger any effects that trigger when
 * cards are revealed" — and Monster Harpoon only reaches your own.
 *
 * `playerId` is whose facedown card it is, which is what "your opponents'"
 * names.
 */
export function cannotBeRevealed(
  state: GameState,
  playerId: PlayerId,
  battlefieldId: CardId,
): boolean {
  const location: Location = { kind: "battlefield", id: battlefieldId };
  return auras(state, "beRevealed").some(
    (source) => reaches(source, playerId) && coversLocation(source, location),
  );
}
