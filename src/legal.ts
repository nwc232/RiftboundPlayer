import { applyAction } from "./actions.js";
import type { Action } from "./actions.js";
import { MULLIGAN_MAX } from "./tasks.js";
import type { CardId, GameState, Location, PlayerId } from "./state.js";

/**
 * Everything `playerId` may legally do right now.
 *
 * Legality is decided by running each candidate through `applyAction` rather
 * than by re-deriving the rules here. That is the point: a second copy of the
 * legality rules would drift from the first, and the two would disagree about
 * an edge case exactly when it mattered. Candidates are cheap to generate and
 * `applyAction` is pure, so asking it is both correct by construction and free
 * of a maintenance burden.
 *
 * A UI needs this because it has to know what is clickable *before* the click;
 * discovering legality from a rejection only works once you have already acted.
 */
export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  return candidates(state, playerId).filter(
    (action) => applyAction(state, action).ok,
  );
}

/** Every location a permanent could be asked to go to. */
function locations(state: GameState, playerId: PlayerId): Location[] {
  return [
    { kind: "base", player: playerId },
    ...state.battlefieldOrder.map(
      (id): Location => ({ kind: "battlefield", id }),
    ),
  ];
}

/** Ids a spell might be asked to target: everything on the board or the chain. */
function targetable(state: GameState): CardId[] {
  return [
    ...Object.keys(state.permanents),
    ...state.chain.map((item) =>
      item.kind === "spell" ? item.cardId : item.sourceId,
    ),
  ];
}

/** Every subset of `ids` up to `max` in size, including the empty one. */
function subsets(ids: CardId[], max: number): CardId[][] {
  let out: CardId[][] = [[]];
  for (let size = 1; size <= max; size += 1) {
    const previous = out.filter((s) => s.length === size - 1);
    for (const base of previous) {
      const from = base.length === 0 ? 0 : ids.indexOf(base[base.length - 1]!) + 1;
      for (let i = from; i < ids.length; i += 1) {
        out = [...out, [...base, ids[i]!]];
      }
    }
  }
  return out;
}

function candidates(state: GameState, playerId: PlayerId): Action[] {
  // R320.1 — while a decision is outstanding, answering it is the only move.
  const pending = state.pending;
  if (pending !== null) {
    if (pending.player !== playerId) return [];
    const { prompt } = pending;

    switch (prompt.kind) {
      case "confirmOptional":
        return [
          { type: "decide", playerId, perform: true },
          { type: "decide", playerId, perform: false },
        ];
      case "mulligan":
        // Bounded by R117.1's "up to two", so this stays small.
        return subsets(prompt.legal, Math.min(prompt.max, MULLIGAN_MAX)).map(
          (targets) => ({ type: "decide", playerId, targets }),
        );
      case "chooseTargets":
        // Only single-target abilities exist so far; a wider count would need
        // combinations here the way the mulligan does.
        return prompt.legal.map((id) => ({
          type: "decide",
          playerId,
          targets: [id],
        }));
      case "assignCombatDamage":
      case "chooseStagedBattlefield":
        return prompt.legal.map((id) => ({
          type: "decide",
          playerId,
          targets: [id],
        }));
      default: {
        const unhandled: never = prompt;
        return [];
      }
    }
  }

  const player = state.players[playerId];
  const out: Action[] = [
    { type: "passPriority", playerId },
    { type: "passFocus", playerId },
    { type: "endTurn", playerId },
  ];

  // R108.3.d — the Chosen Champion is playable from its zone alongside the hand.
  const held = [
    ...player.hand,
    ...(player.champion === null ? [] : [player.champion]),
  ];
  // R811.1.b — and a card facedown at a battlefield is playable from there.
  const playable = [
    ...held,
    ...Object.values(state.facedown)
      .filter((entry) => entry.controller === playerId)
      .map((entry) => entry.cardId),
  ];

  // R421 — Hide, offered for every held card against every battlefield. The
  // prerequisites are left to `applyAction`, like everything else here.
  for (const cardId of held) {
    for (const battlefieldId of state.battlefieldOrder) {
      out.push({ type: "hide", playerId, cardId, battlefieldId });
    }
  }

  const targets = targetable(state);

  // R355.1.a — paying an optional additional cost is a choice made while
  // playing, so each play is offered both ways and `applyAction` prices them.
  for (const cardId of playable) {
    for (const payOptional of [false, true]) {
      for (const destination of locations(state, playerId)) {
        out.push({
          type: "playUnitFromHand",
          playerId,
          cardId,
          destination,
          payOptional,
        });
      }
      out.push({ type: "playSpell", playerId, cardId, payOptional });
      for (const target of targets) {
        out.push({
          type: "playSpell",
          playerId,
          cardId,
          targets: [target],
          payOptional,
        });
      }
    }
  }

  // Anything on the board or among this player's runes may have an ability.
  const sources = [
    ...Object.keys(state.permanents),
    ...player.runes,
  ];
  for (const sourceId of sources) {
    const abilities = state.cards[sourceId]?.abilities ?? [];
    abilities.forEach((_, abilityIndex) => {
      out.push({ type: "activateAbility", playerId, sourceId, abilityIndex });
    });
  }

  for (const cardId of Object.keys(state.permanents)) {
    for (const destination of locations(state, playerId)) {
      out.push({ type: "standardMove", playerId, cardId, destination });
    }
  }

  return out;
}
