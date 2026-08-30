import { spend } from "./cost.js";
import type { GameEvent } from "./events.js";
import { keywordsOf } from "./layers.js";
import type {
  CardId,
  FacedownCard,
  GameState,
  Location,
  PlayerId,
} from "./state.js";

/**
 * R811.1.b — the Hide cost is "[A]": one Power of any domain. R811.3 leaves the
 * card's own cost alone; hiding is an alternative to playing it, not a discount.
 */
export const HIDE_COST = { energy: 0, power: {}, anyPower: 1 } as const;

export type HideRejection =
  | "cardNotFound"
  | "notHidden"
  | "notInHand"
  | "notYourTurn"
  | "wrongPhase"
  | "notOpenState"
  | "battlefieldNotControlled"
  | "facedownZoneOccupied"
  | "cannotAffordCost";

export interface HideOutcome {
  state: GameState;
  events: GameEvent[];
}

/**
 * R421 — Hide places a card facedown at a battlefield you control. R811.1.c.2
 * is why this is not part of playing a card: hiding does not open a chain, so
 * it resolves immediately and the opponent never gets a window on it.
 */
export function hide(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  battlefieldId: CardId,
): HideOutcome | HideRejection {
  const player = state.players[playerId];
  const card = state.cards[cardId];

  if (card === undefined) return "cardNotFound";
  // R811.1.a — the keyword is the prerequisite for the action (R811.1).
  if (!keywordsOf(state, cardId).includes("hidden")) return "notHidden";

  // R811.1.b — "while this card is in your hand or in your Champion Zone".
  const fromChampionZone = player.champion === cardId;
  if (!player.hand.includes(cardId) && !fromChampionZone) return "notInHand";

  // R811.1.b — "on your turn during an Open State".
  if (state.turn.player !== playerId) return "notYourTurn";
  if (state.turn.phase !== "main") return "wrongPhase";
  if (state.showdown !== null || state.chain.length > 0) return "notOpenState";

  // R107.3.c — the controller of the card must control the battlefield.
  if (state.battlefields[battlefieldId]?.controller !== playerId) {
    return "battlefieldNotControlled";
  }
  // R107.3.b / R811.1.b — "that doesn't already have a facedown card hidden there".
  if (state.facedown[battlefieldId] !== undefined) return "facedownZoneOccupied";

  const remainingPool = spend(player.runePool, HIDE_COST, {
    kind: "hide",
    inShowdown: state.showdown !== null,
  });
  if (remainingPool === undefined) return "cannotAffordCost";

  const facedown: FacedownCard = {
    cardId,
    controller: playerId,
    hiddenOnTurn: state.turn.number,
  };

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          hand: player.hand.filter((id) => id !== cardId),
          ...(fromChampionZone ? { champion: null } : {}),
          runePool: remainingPool,
        },
      },
      facedown: { ...state.facedown, [battlefieldId]: facedown },
    },
    events: [
      { type: "costPaid", playerId, cardId, cost: HIDE_COST },
      { type: "cardHidden", playerId, cardId, battlefieldId },
    ],
  };
}

/** Which battlefield, if any, has `cardId` facedown at it. */
export function facedownAt(
  state: GameState,
  cardId: CardId,
): CardId | undefined {
  return Object.keys(state.facedown).find(
    (battlefieldId) => state.facedown[battlefieldId]?.cardId === cardId,
  );
}

/**
 * R811.1.b — "Beginning on the next turn, this gains [Reaction] and you may
 * play this, ignoring its base cost." The turn it was hidden on is the one turn
 * it cannot be played, whoever's turn it is now.
 */
export function playableFromFacedown(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): CardId | undefined {
  const battlefieldId = facedownAt(state, cardId);
  if (battlefieldId === undefined) return undefined;

  const entry = state.facedown[battlefieldId];
  if (entry === undefined || entry.controller !== playerId) return undefined;
  if (state.turn.number <= entry.hiddenOnTurn) return undefined;

  return battlefieldId;
}

/** R811.1.d.1 — "A hidden permanent must be played to that battlefield." */
export function forcedDestination(battlefieldId: CardId): Location {
  return { kind: "battlefield", id: battlefieldId };
}

/** Takes the card out of its zone, leaving the rest of the state alone. */
export function clearFacedown(
  state: GameState,
  battlefieldId: CardId,
): GameState {
  const { [battlefieldId]: _gone, ...rest } = state.facedown;
  return { ...state, facedown: rest };
}

/**
 * R323.7 — "Remove all Hidden cards from all Battlefields that are not
 * controlled by the same player and place them in their owner's Trash."
 * R107.3.d says the same thing from the zone's side: losing control of the
 * battlefield costs you what you hid there.
 */
export function sweepFacedown(state: GameState): HideOutcome {
  let current = state;
  const events: GameEvent[] = [];

  for (const [battlefieldId, entry] of Object.entries(state.facedown)) {
    if (state.battlefields[battlefieldId]?.controller === entry.controller) {
      continue;
    }
    const owner = state.players[entry.controller];
    current = {
      ...clearFacedown(current, battlefieldId),
      players: {
        ...current.players,
        [entry.controller]: {
          ...owner,
          trash: [...owner.trash, entry.cardId],
        },
      },
    };
    events.push({
      type: "facedownRemoved",
      playerId: entry.controller,
      cardId: entry.cardId,
      battlefieldId,
    });
  }

  return { state: current, events };
}
