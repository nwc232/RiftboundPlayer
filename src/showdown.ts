import type { GameEvent, Progress } from "./events.js";
import { checkForWinner, score } from "./scoring.js";
import { permanentsAt } from "./state.js";
import type { CardId, GameState, PlayerId } from "./state.js";

/**
 * R341–348. A showdown is a window where players alternate with Focus. The
 * player who applied Contested gains Focus first (R345); in a combat that same
 * player is the Attacker (R464.2.c.1) and seeds the Combat Chain (R464.2.e.1).
 *
 * Only non-combat showdowns exist so far — a combat needs units from opposing
 * players at the same battlefield.
 */
export interface ShowdownState {
  battlefieldId: CardId;
  /** Whoever applied Contested. Not necessarily the turn player. */
  attacker: PlayerId;
  focus: PlayerId;
  /** R347.2.a — the showdown ends once every player has passed in sequence. */
  consecutivePasses: number;
}

function unitsAtByController(
  state: GameState,
  battlefieldId: CardId,
): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const permanent of permanentsAt(state, {
    kind: "battlefield",
    id: battlefieldId,
  })) {
    if (state.cards[permanent.cardId]?.type !== "unit") continue;
    counts.set(
      permanent.controller,
      (counts.get(permanent.controller) ?? 0) + 1,
    );
  }
  return counts;
}

/**
 * R348.2 — on closing a non-combat showdown, if exactly one player has units
 * there and doesn't already control it, they establish Control, which is a
 * Conquer if they haven't scored that battlefield this turn (R348.2.a.1).
 */
function closeShowdown(state: GameState): Progress {
  const showdown = state.showdown;
  if (showdown === null) {
    return { state, events: [] };
  }

  const battlefield = state.battlefields[showdown.battlefieldId];
  const cleared: GameState = { ...state, showdown: null };
  const events: GameEvent[] = [
    { type: "showdownClosed", battlefieldId: showdown.battlefieldId },
  ];

  if (battlefield === undefined) {
    return { state: cleared, events };
  }

  const counts = unitsAtByController(cleared, showdown.battlefieldId);
  const holders = [...counts.keys()];
  const soleHolder = holders.length === 1 ? holders[0] : undefined;

  if (soleHolder === undefined || battlefield.controller === soleHolder) {
    // Nobody establishes control; contested simply lifts.
    return {
      state: {
        ...cleared,
        battlefields: {
          ...cleared.battlefields,
          [showdown.battlefieldId]: { ...battlefield, contestedBy: null },
        },
      },
      events,
    };
  }

  const controlled: GameState = {
    ...cleared,
    battlefields: {
      ...cleared.battlefields,
      [showdown.battlefieldId]: {
        ...battlefield,
        controller: soleHolder,
        contestedBy: null,
      },
    },
  };
  events.push({
    type: "battlefieldControlled",
    playerId: soleHolder,
    battlefieldId: showdown.battlefieldId,
  });

  const scored = score(controlled, soleHolder, showdown.battlefieldId, "conquer");
  return { state: scored.state, events: [...events, ...scored.events] };
}

/** R347 — the player with Focus passes. Two passes in sequence close it. */
export function passFocus(state: GameState, playerId: PlayerId): Progress {
  const showdown = state.showdown;
  if (showdown === null || showdown.focus !== playerId) {
    return { state, events: [] };
  }

  const consecutivePasses = showdown.consecutivePasses + 1;
  const events: GameEvent[] = [{ type: "focusPassed", playerId }];

  if (consecutivePasses >= 2) {
    const closed = closeShowdown(state);
    return { state: closed.state, events: [...events, ...closed.events] };
  }

  return {
    state: {
      ...state,
      showdown: {
        ...showdown,
        focus: playerId === "p1" ? "p2" : "p1",
        consecutivePasses,
      },
    },
    events,
  };
}

/**
 * A minimal Cleanup (R318/R323). Only the parts this slice needs: check for a
 * winner, open a showdown at a contested battlefield, and drop control of a
 * battlefield where the controller has no units left (R190.4.c).
 *
 * Combat staging (R323.9) is absent until combat exists.
 */
export function runCleanup(state: GameState): Progress {
  let current = state;
  const events: GameEvent[] = [];

  const won = checkForWinner(current);
  current = won.state;
  events.push(...won.events);
  if (current.winner !== null) {
    return { state: current, events };
  }

  // R190.4.c — a controller with no units there loses control in the cleanup.
  for (const battlefieldId of current.battlefieldOrder) {
    const battlefield = current.battlefields[battlefieldId];
    if (battlefield?.controller == null) continue;
    const counts = unitsAtByController(current, battlefieldId);
    if ((counts.get(battlefield.controller) ?? 0) === 0) {
      current = {
        ...current,
        battlefields: {
          ...current.battlefields,
          [battlefieldId]: { ...battlefield, controller: null },
        },
      };
      events.push({
        type: "battlefieldControlLost",
        playerId: battlefield.controller,
        battlefieldId,
      });
    }
  }

  // R344.2 — a contested battlefield opens a showdown in the next cleanup.
  if (current.showdown === null) {
    for (const battlefieldId of current.battlefieldOrder) {
      const battlefield = current.battlefields[battlefieldId];
      const contestedBy = battlefield?.contestedBy;
      if (contestedBy == null) continue;

      current = {
        ...current,
        showdown: {
          battlefieldId,
          attacker: contestedBy,
          // R345 — the player who applied Contested gains Focus.
          focus: contestedBy,
          consecutivePasses: 0,
        },
      };
      events.push({
        type: "showdownOpened",
        battlefieldId,
        attacker: contestedBy,
      });
      break;
    }
  }

  return { state: current, events };
}
