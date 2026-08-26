import { applyAction } from "../actions.js";
import type { Action, RejectionReason } from "../actions.js";
import { startGame } from "../deck.js";
import type { GameEvent } from "../events.js";
import { legalActions } from "../legal.js";
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
      return (action.targets ?? []).length === 0
        ? "keep this hand"
        : (action.targets ?? []).map(label).join(" + ");
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
    default:
      return { min: 1, max: 1 };
  }
}

export interface Move {
  action: Action;
  label: string;
}

/** Every legal move for the acting player, already labelled. */
export function movesFor(state: GameState, playerId: PlayerId): Move[] {
  return legalActions(state, playerId).map((action) => ({
    action,
    label: describe(state, action),
  }));
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
