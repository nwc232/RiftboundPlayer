import { controllerOf, keywordsOf } from "./layers.js";
import { permanentsAt, sameLocation } from "./state.js";
import type { CardId, GameState, Location, PlayerId } from "./state.js";

/**
 * R355.2.b — "some Game Effects may grant players permission to play Units to
 * locations that are not normally Valid. Such locations become Valid for the
 * purposes of Playing the Unit."
 *
 * Each entry is one printed permission, not a general predicate: R822.1.d says
 * a card may *expand* Ambush's permissions, and Rengar is the card that does.
 */
export type PlayPermission =
  /** R822.1.b — [Ambush]: "a battlefield where you control Units". */
  | { kind: "whereYouHaveUnits" }
  /**
   * R822.1.d — Rengar, Trophy Hunter: "I can [Ambush] to a battlefield where
   * there are enemy units, even if you don't have units there."
   */
  | { kind: "whereEnemyUnits" }
  /**
   * Sneaky Deckhand — "You may play me to an open battlefield." The rules
   * never define "open", so it is read here as one nobody controls, which is
   * what makes the card do anything: a controlled one is already valid to its
   * controller under R355.2.a. Recorded as a deviation.
   */
  | { kind: "openBattlefield" };

function unitsAt(state: GameState, location: Location) {
  return permanentsAt(state, location).filter(
    (permanent) => state.cards[permanent.cardId]?.type === "unit",
  );
}

/**
 * Every permission a card carries. Read off printed keywords and rules text
 * rather than through the layer pipeline: a card in hand has no permanent, and
 * R711 reads anything off the board on its printed values.
 */
export function playPermissionsOf(
  state: GameState,
  cardId: CardId,
): PlayPermission[] {
  const permissions: PlayPermission[] = [];

  // R822.1.b — the keyword's own permission. R822.2 makes duplicates
  // redundant, which falls out of asking whether the keyword is present.
  if (keywordsOf(state, cardId).includes("ambush")) {
    permissions.push({ kind: "whereYouHaveUnits" });
  }

  for (const ability of state.cards[cardId]?.abilities ?? []) {
    if (ability.kind === "playPermission") {
      permissions.push(ability.permission);
    }
  }

  return permissions;
}

/** Whether one permission makes `location` valid right now. */
function grants(
  state: GameState,
  playerId: PlayerId,
  permission: PlayPermission,
  location: Location,
): boolean {
  if (location.kind !== "battlefield") return false;
  const present = unitsAt(state, location);

  switch (permission.kind) {
    case "whereYouHaveUnits":
      return present.some(
        (unit) => controllerOf(state, unit.cardId) === playerId,
      );
    case "whereEnemyUnits":
      return present.some(
        (unit) => controllerOf(state, unit.cardId) !== playerId,
      );
    case "openBattlefield":
      return state.battlefields[location.id]?.controller == null;
    default: {
      const unhandled: never = permission;
      return false;
    }
  }
}

/**
 * R355.2 — where a unit may be played. R355.2.a is the default: "the
 * controller's Base or a Battlefield the controller controls."
 */
export function validPlayLocations(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): Location[] {
  const locations: Location[] = [{ kind: "base", player: playerId }];

  for (const battlefieldId of state.battlefieldOrder) {
    const location: Location = { kind: "battlefield", id: battlefieldId };
    const controlled = state.battlefields[battlefieldId]?.controller === playerId;
    const permitted = playPermissionsOf(state, cardId).some((permission) =>
      grants(state, playerId, permission, location),
    );
    if (controlled || permitted) locations.push(location);
  }

  return locations;
}

export function isValidPlayLocation(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  destination: Location,
): boolean {
  return validPlayLocations(state, playerId, cardId).some((location) =>
    sameLocation(location, destination),
  );
}

/**
 * Whether this particular play may use Reaction timing (R813).
 *
 * Two shapes reach it. A card that has [Reaction] outright — R819.1.b's
 * [Quick-Draw] gear — is answered by the keyword alone. R822.1.b's [Ambush] is
 * conditional: "I have [Reaction] as long as I'm being played to a battlefield
 * where you control Units", so the grant is tied to *this* play and asked
 * about a destination rather than answered once. R822.3 is why: a location
 * that stops qualifying before finalization stops being valid.
 */
export function playedWithReactionTiming(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  destination: Location,
): boolean {
  const keywords = keywordsOf(state, cardId);
  // R813 — a permanent that simply *has* [Reaction] may be played at Reaction
  // timing, with no condition attached. R819.1.b's [Quick-Draw] arrives here
  // that way, because `characteristicsOf` derives the keyword from it.
  if (keywords.includes("reaction")) return true;
  if (!keywords.includes("ambush")) return false;
  return grants(state, playerId, { kind: "whereYouHaveUnits" }, destination);
}
