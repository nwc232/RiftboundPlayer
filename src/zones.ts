import type { AbilityCost } from "./abilities.js";
import type { GameEvent } from "./events.js";
import { flowCostsOf } from "./costing.js";
import { resourcePartOf } from "./layers.js";
import {
  clearFacedown,
  facedownAt,
  playableFromFacedown,
  revealFacedown,
} from "./hidden.js";
import type {
  CardId,
  Cost,
  GameState,
  Location,
  PlayerId,
  PlaySource,
} from "./state.js";

/**
 * R354.1 — a card is played from its controller's hand by default. Four rules
 * widen that, and each widens it differently:
 *
 * - **Champion Zone** (R108.3.d) changes only where the card comes from.
 * - **Facedown Zone** (R811.1.b) grants [Reaction], zeroes the base cost, and
 *   R811.1.d.1 fixes the destination to the battlefield it was hidden at.
 * - **Trash**, via [Flow] (R829.1.b), replaces the base cost outright
 *   (R829.1.c.1) and redirects the card on its way off the chain
 *   (R829.1.b.1).
 *
 * Naming the differences in one shape is what keeps the play paths from
 * growing a branch per zone at every step — which is what they had, three
 * ternaries deep, before the trash was a fourth.
 */
export interface PlayZone {
  source: PlaySource;
  /** R811.1.b — the *zone* grants [Reaction], on top of the card's keywords. */
  grantsReaction?: true;
  /** R356.1.b — "ignoring its base cost", which R356.2 can still raise. */
  ignoreBaseCost?: true;
  /**
   * R829.1.c.1 — a cost that *replaces* the base cost during finalization,
   * rather than being added to it or zeroing it.
   */
  alternateCost?: Cost;
  /**
   * R829.1.c.2 — a Flow cost "may include both resource costs and non-resource
   * costs". The resource half is `alternateCost`; these are the rest, paid as
   * the card is played the way any other ability cost is.
   */
  extraCosts?: AbilityCost[];
  /** R811.1.d.1 — "A hidden permanent must be played to that battlefield." */
  destination?: Location;
  /**
   * R829.1.b.1 — when the finalized chain item leaves the chain, banish it
   * rather than trashing it. Recorded on the play because it belongs to *this*
   * play: the same card played from hand next turn does no such thing.
   */
  banishOnLeave?: true;
}

/**
 * Every way `cardId` could be played right now, most-ordinary first. A card is
 * in exactly one zone, so this is usually zero or one entry — R829.1.c.3 is
 * the exception, where a spell with several [Flow] costs offers one entry per
 * cost and "its controller may choose which cost to apply as they play it".
 */
export function playZonesFor(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): PlayZone[] {
  const player = state.players[playerId];

  if (player.hand.includes(cardId)) return [{ source: "hand" }];

  // R108.3.d — the Chosen Champion is played from the Champion Zone "following
  // the same rules as any other card": an always-available extra card rather
  // than an inert marker.
  if (player.champion === cardId) return [{ source: "champion" }];

  const hiddenAt = playableFromFacedown(state, playerId, cardId);
  if (hiddenAt !== undefined) {
    return [
      {
        source: "facedown",
        grantsReaction: true,
        ignoreBaseCost: true,
        destination: { kind: "battlefield", id: hiddenAt },
      },
    ];
  }

  // R829.1.b — "You may play this from your trash for its flow cost. Then
  // banish it." R829.1.b.2 is the limit of what the keyword changes: the zone,
  // and nothing about timing or any other permission.
  if (player.trash.includes(cardId)) {
    return flowCostsOf(state, cardId, playerId).map((costs) => ({
      source: "trash" as const,
      alternateCost: resourcePartOf(costs),
      extraCosts: costs.filter((each) => each.kind !== "pay"),
      banishOnLeave: true as const,
    }));
  }

  return [];
}

/**
 * Takes the card out of the zone it was played from. R359.1 moves it to the
 * chain either way; this is only the half that empties the zone behind it.
 *
 * Returns events as well as state because of R421.4: leaving a Facedown Zone
 * is a zone change, and "if a facedown card would change zones … its owner
 * reveals it to all players".
 */
export function leaveZone(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  zone: PlayZone,
): { state: GameState; events: GameEvent[] } {
  const player = state.players[playerId];
  const plain = (next: GameState) => ({ state: next, events: [] });

  switch (zone.source) {
    case "hand": {
      const index = player.hand.indexOf(cardId);
      if (index === -1) return plain(state);
      return plain({
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            hand: [
              ...player.hand.slice(0, index),
              ...player.hand.slice(index + 1),
            ],
          },
        },
      });
    }
    // R108.3.c — the Champion Zone cannot be refilled by normal means, so it
    // empties for good once the champion is played.
    case "champion":
      return plain({
        ...state,
        players: { ...state.players, [playerId]: { ...player, champion: null } },
      });
    case "facedown": {
      const battlefieldId = facedownAt(state, cardId);
      if (battlefieldId === undefined) return plain(state);
      // R421.4 — it is leaving the Facedown Zone, so its owner reveals it.
      // The reveal is a consequence of the move rather than a permission for
      // it: Noxus Saboteur can stop the disclosure and cannot stop the play.
      const shown = revealFacedown(state, cardId, battlefieldId, playerId);
      return {
        state: clearFacedown(shown.state, battlefieldId),
        events: shown.events,
      };
    }
    case "trash":
      return plain({
        ...state,
        players: {
          ...state.players,
          [playerId]: {
            ...player,
            trash: player.trash.filter((id) => id !== cardId),
          },
        },
      });
    default: {
      const unhandled: never = zone.source;
      void unhandled;
      return plain(state);
    }
  }
}
