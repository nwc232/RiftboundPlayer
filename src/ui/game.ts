import { applyAction } from "../actions.js";
import type { Action, RejectionReason } from "../actions.js";
import { startGame } from "../deck.js";
import type { GameEvent } from "../events.js";
import { legalActions } from "../legal.js";
import { legalTargets } from "../decisions.js";
import type { TargetFilter } from "../decisions.js";
import { canPay, totals } from "../cost.js";
import { totalCostOf } from "../costing.js";
import { characteristicsOf, controllerOf } from "../layers.js";
import { matchup } from "../decks/index.js";
import { permanentsAt } from "../state.js";
import type {
  CardId,
  Cost,
  GameState,
  Location,
  PermanentState,
  PlayerId,
} from "../state.js";

export const OPPONENT: Record<PlayerId, PlayerId> = { p1: "p2", p2: "p1" };

/**
 * Who the rules currently expect to act. One person drives both seats for now,
 * so the UI follows the same order the CLI does: whoever owes a decision, then
 * the priority holder, then the one with Focus, then the turn player.
 *
 * When this becomes two windows, this stops being "who is acting" and becomes
 * "is it my turn to act" — the same question asked per viewer.
 */
export function actingPlayer(state: GameState): PlayerId {
  if (state.pending !== null) return state.pending.player;
  if (state.chain.length > 0 && state.priority !== null) return state.priority;
  if (state.showdown !== null) return state.showdown.focus;
  return state.turn.player;
}

export function newGame(seed: number): GameState {
  const started = startGame(matchup({ seed }));
  if (!started.ok) {
    throw new Error(`deck setup failed: ${JSON.stringify(started.errors)}`);
  }
  return started.state;
}

export function nameOf(state: GameState, cardId: CardId): string {
  return characteristicsOf(state, cardId).name;
}

export function unitsAt(state: GameState, location: Location): PermanentState[] {
  return permanentsAt(state, location);
}

export function controlOf(state: GameState, cardId: CardId): PlayerId {
  return controllerOf(state, cardId);
}

/** Which card an action is *about*, for grouping the move list by card. */
export function subjectOf(action: Action): CardId | undefined {
  switch (action.type) {
    case "playUnitFromHand":
    case "playSpell":
    case "standardMove":
    case "hide":
      return action.cardId;
    case "activateAbility":
      return action.sourceId;
    default:
      return undefined;
  }
}

/** A short label for a move, written the way the rules name the action. */
export function describe(state: GameState, action: Action): string {
  const label = (id: CardId) => nameOf(state, id);
  const where = (location: Location | undefined): string =>
    location === undefined
      ? "base"
      : location.kind === "base"
        ? "base"
        : label(location.id);

  switch (action.type) {
    case "playUnitFromHand":
      return `play to ${where(action.destination)}${
        action.payOptional === true ? " · pay the extra cost" : ""
      }`;
    case "playSpell":
      return (
        "cast" +
        (action.targets && action.targets.length > 0
          ? ` at ${action.targets.map(label).join(" + ")}`
          : "") +
        (action.payOptional === true ? " · pay the extra cost" : "")
      );
    case "hide":
      return `hide at ${label(action.battlefieldId)}`;
    case "activateAbility":
      return (
        abilityWording(state, action.sourceId, action.abilityIndex) +
        (action.targets && action.targets.length > 0
          ? ` at ${action.targets.map(label).join(" + ")}`
          : "")
      );
    case "standardMove":
      return `move to ${where(action.destination)}`;
    case "decide":
      if (action.perform === true) return "yes";
      if (action.perform === false) return "no";
      if ((action.targets ?? []).length === 0) {
        // The only two prompts that accept nothing, and they mean opposite
        // things: R117.1 keeps the opening hand, R436.1 keeps the top card.
        return state.pending?.prompt.kind === "predict"
          ? "recycle nothing"
          : "keep this hand";
      }
      return (action.targets ?? []).map(label).join(" + ");
    case "endTurn":
      return "end turn";
    case "passPriority":
      return "pass priority";
    case "passFocus":
      return "pass focus";
    case "drawCard":
      return "draw";
    default: {
      const unhandled: never = action;
      void unhandled;
      return "act";
    }
  }
}

/**
 * What an activated ability actually does, in words. Read off the ability's
 * own data — the cost it charges and the effect it runs — so a rune reads
 * "exhaust for 1 energy" rather than "ability 1".
 */
function abilityWording(
  state: GameState,
  sourceId: CardId,
  index: number,
): string {
  const ability = state.cards[sourceId]?.abilities[index];
  if (ability === undefined || ability.kind !== "activated") {
    return `ability ${index + 1}`;
  }

  const cost = ability.costs
    .map((each) =>
      each.kind === "exhaustSelf"
        ? "exhaust"
        : each.kind === "recycleSelf"
          ? "recycle"
          : `pay ${describeCost(each.cost)}`,
    )
    .join(" + ");

  const effect = ability.effect;
  const gain =
    effect.op === "addEnergy"
      ? `${effect.amount} energy`
      : effect.op === "addPower"
        ? `${effect.amount} ${
            effect.domain === "selfDomain"
              ? (state.cards[sourceId]?.domain ?? "power")
              : effect.domain
          } power`
        : effect.op === "attachSelf"
          ? "attach"
          : effect.op;

  return cost === "" ? gain : `${cost} for ${gain}`;
}

export function describeCost(cost: Cost): string {
  const parts: string[] = [];
  if (cost.energy > 0) parts.push(`${cost.energy} energy`);
  for (const [domain, amount] of Object.entries(cost.power)) {
    parts.push(`${amount} ${domain}`);
  }
  if (cost.anyPower > 0) parts.push(`${cost.anyPower} any`);
  return parts.length === 0 ? "nothing" : parts.join(" + ");
}

/**
 * How many cards a prompt wants. R117.1's mulligan takes "up to two" and
 * Stacked Deck keeps one of three; everything else takes exactly one, which is
 * why most clicks can answer immediately and those two cannot.
 */
export function promptArity(state: GameState): { min: number; max: number } {
  const prompt = state.pending?.prompt;
  if (prompt === undefined) return { min: 0, max: 0 };
  switch (prompt.kind) {
    case "mulligan":
      return { min: 0, max: prompt.max };
    case "chooseFromRevealed":
      return { min: Math.max(1, prompt.keep), max: Math.max(1, prompt.keep) };
    // R372 wants the whole order, and the staging list keeps click order.
    // R436.1.a wants the same for the cards a Predict put back on top.
    case "orderDamage":
    case "orderPredicted":
      return { min: prompt.legal.length, max: prompt.legal.length };
    // R436.1 — Recycle "any number", so keeping every card is a real answer.
    case "predict":
      return { min: 0, max: prompt.legal.length };
    default:
      return { min: 1, max: 1 };
  }
}

export interface Move {
  action: Action;
  label: string;
  /** The card the move is about, if any — what it gets grouped under. */
  subject: CardId | undefined;
}

/** Every legal move for the acting player, already labelled. */
export function movesFor(state: GameState, playerId: PlayerId): Move[] {
  return legalActions(state, playerId).map((action) => ({
    action,
    label: describe(state, action),
    subject: subjectOf(action),
  }));
}

export interface MoveGroup {
  /** Null for moves that belong to no card — end turn, pass. */
  cardId: CardId | null;
  heading: string;
  moves: Move[];
}

/**
 * Moves grouped by the card they act on. Grouping rather than requiring a
 * selection first: a player who cannot see what any card does has no way to
 * discover that runes are what fills the pool.
 */
export function groupMoves(state: GameState, moves: Move[]): MoveGroup[] {
  const groups: MoveGroup[] = [];
  const index = new Map<string, MoveGroup>();

  for (const move of moves) {
    const key = move.subject ?? "";
    let group = index.get(key);
    if (group === undefined) {
      group = {
        cardId: move.subject ?? null,
        heading: move.subject === undefined ? "anytime" : nameOf(state, move.subject),
        moves: [],
      };
      index.set(key, group);
      groups.push(group);
    }
    group.moves.push(move);
  }

  // Card moves first; the always-available ones sit at the bottom out of the way.
  return [
    ...groups.filter((group) => group.cardId !== null),
    ...groups.filter((group) => group.cardId === null),
  ];
}

/** A target filter in words, for explaining what a card is looking for. */
function describeFilter(filter: TargetFilter): string {
  const parts = [
    filter.controller === "friendly"
      ? "friendly"
      : filter.controller === "enemy"
        ? "enemy"
        : "",
    filter.type === "spellOnChain"
      ? "spell on the chain"
      : filter.type === "battlefield"
        ? "battlefield"
        : "unit",
    filter.location === "battlefield" ? "at a battlefield" : "",
    filter.atSource === true ? "here" : "",
    filter.awayFromSource === true ? "somewhere else" : "",
    filter.excludeSource === true ? "other than itself" : "",
    filter.maxMight !== undefined ? `with ${filter.maxMight} Might or less` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Why a card in hand cannot be played right now. Two answers cover almost
 * every case: you cannot pay for it, or R355.8's "valid choices must be made
 * for all targets" cannot be satisfied. Anything else is visible on the board.
 */
export function whyNotPlayable(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): string | null {
  const player = state.players[playerId];
  if (!player.hand.includes(cardId) && player.champion !== cardId) return null;

  const card = state.cards[cardId];
  if (card === undefined) return null;

  const cost = totalCostOf(state, playerId, cardId);
  if (!canPay(player.runePool, cost, { kind: "playCard", cardType: card.type })) {
    const pool = totals(player.runePool);
    const held = [
      pool.energy > 0 ? `${pool.energy} energy` : "",
      ...Object.entries(pool.power).map(([domain, n]) => `${n} ${domain}`),
      pool.universalPower > 0 ? `${pool.universalPower} any` : "",
    ].filter(Boolean);

    return (
      `costs ${describeCost(cost)} — your pool holds ` +
      (held.length === 0 ? "nothing" : held.join(" + ")) +
      ". Exhaust or recycle a rune to fill it."
    );
  }

  // R355.8 — "In order to put a spell or ability on the chain, valid choices
  // must be made for all targets."
  const ability = card.abilities.find(
    (each) => each.kind === "activated" || each.kind === "triggered",
  );
  for (const filter of ability?.targeting?.filters ?? []) {
    if (legalTargets(state, playerId, filter, cardId).length === 0) {
      return `needs a ${describeFilter(filter)} to choose, and there is none (R355.8).`;
    }
  }

  return null;
}

/** What a card costs right now, for showing on the card itself. */
export function costLabel(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
): string | undefined {
  const card = state.cards[cardId];
  if (card === undefined || card.type === "rune" || card.type === "legend") {
    return undefined;
  }
  const cost = totalCostOf(state, playerId, cardId);
  return cost.energy === 0 &&
    cost.anyPower === 0 &&
    Object.keys(cost.power).length === 0
    ? undefined
    : describeCost(cost);
}

export interface Dispatch {
  state: GameState;
  events: GameEvent[];
  rejected?: RejectionReason;
}

export function dispatch(state: GameState, action: Action): Dispatch {
  const result = applyAction(state, action);
  return result.ok
    ? { state: result.state, events: result.events }
    : { state, events: [], rejected: result.reason };
}
