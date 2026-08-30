import { applyAction } from "./actions.js";
import type { Action } from "./actions.js";
import { modeCountOf } from "./actions.js";
import { modeOf } from "./abilities.js";
import type { ActivatedAbility } from "./abilities.js";
import {
  choicePoolFor,
  choosingCostsOf,
  flowCostsOf,
  repeatCostsOf,
} from "./costing.js";
import type { PlayZone } from "./zones.js";
import { playZonesFor } from "./zones.js";
import { legalTargets } from "./decisions.js";
import { abilitiesOf } from "./layers.js";
import type { TargetFilter } from "./decisions.js";
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

/**
 * The filters a card's own rules text names, if any (R355.5). Read off the
 * printed card, because it is still in hand.
 */
function filtersOf(
  state: GameState,
  cardId: CardId,
  mode = 0,
): TargetFilter[] {
  const ability = state.cards[cardId]?.abilities.find(
    (each) => each.kind === "activated" || each.kind === "triggered",
  );
  if (ability === undefined) return [];
  if (ability.kind !== "activated" && ability.kind !== "triggered") return [];
  return modeOf(ability, mode).targeting?.filters ?? [];
}

/**
 * Every tuple of targets a card could legally be pointed at: one choice per
 * filter, in the order the card names them, never reusing an object. A spell
 * that names two things has to be offered as a pair — offering each half alone
 * would mean it never appeared at all.
 */
function targetTuples(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  mode = 0,
): CardId[][] {
  const filters = filtersOf(state, cardId, mode);
  if (filters.length === 0) return [[]];

  let tuples: CardId[][] = [[]];
  for (const filter of filters) {
    const legal = legalTargets(state, playerId, filter, cardId);
    tuples = tuples.flatMap((prefix) =>
      legal
        .filter((id) => !prefix.includes(id))
        .map((id) => [...prefix, id]),
    );
    if (tuples.length === 0) break;
  }
  return tuples;
}

/**
 * How many target tuples a repeated spell will have its executions enumerated
 * independently for. R820.2.a lets each execution choose freely, so k
 * executions over n tuples is n^k answers. Past the bound every execution is
 * offered the same choice as the first, which keeps the *spell* discoverable
 * even where the full space of choices is not. Nothing stops `applyAction`
 * accepting any legal combination the UI builds.
 */
const REPEAT_TUPLE_MAX = 64;

/**
 * Every combination of arms a play could take. `count` of 0 means the card is
 * not modal, which still has exactly one way to be played.
 */
function modeChoices(count: number, executions: number): number[][] {
  if (count === 0) return [Array.from({ length: executions }, () => 0)];
  let out: number[][] = [[]];
  for (let run = 0; run < executions; run += 1) {
    out = out.flatMap((prefix) =>
      Array.from({ length: count }, (_, mode) => [...prefix, mode]),
    );
  }
  return out;
}

/**
 * R820.2 — with [Repeat] paid, the choices for every execution are made as the
 * spell is played, so one action carries them all: one tuple per execution,
 * laid end to end. The tuples are per *mode*, because two arms of the same
 * card can want different things.
 */
function repeatedTargetTuples(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  modes: number[],
): CardId[][] {
  const perRun = modes.map((mode) =>
    targetTuples(state, playerId, cardId, mode),
  );
  const first = perRun[0] ?? [[]];
  if (perRun.length <= 1) return first;

  const total = perRun.reduce((product, each) => product * each.length, 1);
  if (total > REPEAT_TUPLE_MAX) {
    // Past the bound every execution repeats the first one's choice, which
    // only works when the arms want the same things; otherwise the first
    // tuple alone is offered and the rest is left to the UI.
    return perRun.every((each) => each.length === first.length)
      ? first.map((tuple) =>
          Array.from({ length: perRun.length }, () => tuple).flat(),
        )
      : [perRun.flatMap((each) => each[0] ?? [])];
  }

  let out = first;
  for (const next of perRun.slice(1)) {
    out = out.flatMap((prefix) => next.map((tuple) => [...prefix, ...tuple]));
  }
  return out;
}

/** Every subset of `ids` up to `max` in size, including the empty one. */
function subsets<T>(ids: T[], max: number): T[][] {
  let out: T[][] = [[]];
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

/**
 * How long a list this will enumerate every ordering of. A prompt answered
 * with a whole order has n! answers, so it needs a bound; past it the only
 * candidate offered is the order the prompt already lists them in. The UI
 * never relies on this — it stages clicks and sends the order the player
 * built — so the bound only limits what the CLI and the tests can discover.
 */
const ORDER_ENUMERATION_MAX = 4;

/** Every ordering of `ids`, or just `ids` itself once that gets too long. */
function orderings(ids: CardId[]): CardId[][] {
  if (ids.length > ORDER_ENUMERATION_MAX) return [ids];
  if (ids.length <= 1) return [ids];
  return ids.flatMap((id, i) =>
    orderings([...ids.slice(0, i), ...ids.slice(i + 1)]).map((rest) => [
      id,
      ...rest,
    ]),
  );
}

/**
 * How many answers one choosing cost is enumerated with. "Kill any number of
 * friendly units" has 2^n of them, and each one multiplies every other choice
 * on the play, so a wide board needs a bound. The UI never relies on this — it
 * stages the clicks and sends what the player built — so this only limits what
 * the CLI and the tests can discover.
 */
const COST_CHOICE_MAX = 32;

/**
 * R355.1 — every way this play could answer its choosing costs, as one entry
 * per cost in `choosingCostsOf`'s order.
 *
 * The pool is read from the state as it stands *before* the play, so a
 * "discard 1" cost is offered the card being played. `applyAction` computes
 * the same pool after R354 step 1 has emptied its zone and refuses that one —
 * which is the point of filtering candidates through it rather than second-
 * guessing here.
 */
function costChoiceTuples(
  state: GameState,
  playerId: PlayerId,
  cardId: CardId,
  options: { zone?: PlayZone; payOptional?: boolean; payRepeats?: number[] },
): CardId[][][] {
  const costs = choosingCostsOf(state, playerId, cardId, options);
  if (costs.length === 0) return [[]];

  let out: CardId[][][] = [[]];
  for (const cost of costs) {
    const pool = choicePoolFor(state, playerId, cost, cardId);
    // R355.8 — "any number" includes none, so the empty subset is an answer;
    // a stated count admits only the subsets of exactly that size.
    const answers = (
      cost.count === "any"
        ? subsets(pool, pool.length)
        : subsets(pool, cost.count).filter((each) => each.length === cost.count)
    ).slice(0, COST_CHOICE_MAX);
    out = out.flatMap((prefix) => answers.map((answer) => [...prefix, answer]));
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
      // R372/R436.1.a — answered with the whole list in the order it should
      // apply, so a single id is never a legal answer. Enumerating one id at a
      // time offered nothing `applyAction` would accept, which left the CLI
      // with no move at all once two damage replacements met on one unit.
      case "orderDamage":
      case "orderPredicted":
        return orderings(prompt.legal).map((targets) => ({
          type: "decide",
          playerId,
          targets,
        }));
      // R436.1 — "Recycle any number", so every subset is an answer and the
      // empty one means "keep them all".
      case "predict":
        return subsets(prompt.legal, prompt.legal.length).map((targets) => ({
          type: "decide",
          playerId,
          targets,
        }));
      // A mode index rather than a card, but the same shape of answer.
      case "chooseMode":
        return prompt.legal.map((mode) => ({
          type: "decide",
          playerId,
          targets: [String(mode)],
        }));
      case "orderReplacements":
      case "chooseFromRevealed":
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
  // R829.1.b — and a spell in the trash with [Flow] is playable from there.
  const playable = [
    ...held,
    ...Object.values(state.facedown)
      .filter((entry) => entry.controller === playerId)
      .map((entry) => entry.cardId),
    ...player.trash.filter(
      (cardId) => flowCostsOf(state, cardId, playerId).length > 0,
    ),
  ];

  // R421 — Hide, offered for every held card against every battlefield. The
  // prerequisites are left to `applyAction`, like everything else here.
  for (const cardId of held) {
    for (const battlefieldId of state.battlefieldOrder) {
      out.push({ type: "hide", playerId, cardId, battlefieldId });
    }
  }

  // R355.1.a — paying an optional additional cost is a choice made while
  // playing, so each play is offered both ways and `applyAction` prices them.
  for (const cardId of playable) {
    for (const payOptional of [false, true]) {
      const unitZone = playZonesFor(state, playerId, cardId)[0];
      for (const costChoices of costChoiceTuples(state, playerId, cardId, {
        ...(unitZone === undefined ? {} : { zone: unitZone }),
        payOptional,
      })) {
        for (const destination of locations(state, playerId)) {
          out.push({
            type: "playUnitFromHand",
            playerId,
            cardId,
            destination,
            payOptional,
            costChoices,
          });
        }
      }
      // R820.1.c.2 — each [Repeat] cost is paid or not on its own, so every
      // subset of them is a different play at a different price.
      const repeats = repeatCostsOf(state, cardId, playerId).map(
        (_, index) => index,
      );
      // R829.1.c.3 — and a spell with several [Flow] costs is several plays.
      const zones = Math.max(1, playZonesFor(state, playerId, cardId).length);
      // "Choose one —": every arm is a different play, and with [Repeat] every
      // *combination* of arms is (R820.2.a).
      const modeCount = modeCountOf(state, cardId);
      for (let playFrom = 0; playFrom < zones; playFrom += 1) {
        for (const payRepeats of subsets(repeats, repeats.length)) {
          const executions = 1 + payRepeats.length;
          for (const modes of modeChoices(modeCount, executions)) {
            const spellZone = playZonesFor(state, playerId, cardId)[playFrom];
            const costTuples = costChoiceTuples(state, playerId, cardId, {
              ...(spellZone === undefined ? {} : { zone: spellZone }),
              payOptional,
              payRepeats,
            });
            for (const chosen of repeatedTargetTuples(
              state,
              playerId,
              cardId,
              modes,
            )) {
              for (const costChoices of costTuples) {
                out.push({
                  type: "playSpell",
                  playerId,
                  cardId,
                  targets: chosen,
                  payOptional,
                  payRepeats,
                  playFrom,
                  costChoices,
                  ...(modeCount > 0 ? { modes } : {}),
                });
              }
            }
          }
        }
      }
    }
  }

  // Anything on the board or among this player's runes may have an ability.
  const sources = [
    ...Object.keys(state.permanents),
    ...player.runes,
  ];
  for (const sourceId of sources) {
    // Read through the layers, not off the printed card: `activateAbility`
    // indexes `abilitiesOf`, so anything else here would disagree with it. It
    // did — a keyword that expands into an *activated* ability ([Empower]) was
    // playable but never offered, and a copied one indexed the wrong ability.
    const abilities = abilitiesOf(state, sourceId);
    abilities.forEach((ability, abilityIndex) => {
      if (ability.kind !== "activated") return;
      // "Choose one —": one offer per arm, each with its own choices.
      const arms = ability.modes?.map((_, index) => index) ?? [0];
      // R355.1 — an ability's choosing costs are answered as it is activated,
      // the same way a played card's are. Its costs are its own, so the list is
      // `ability.costs` rather than a play's assembled one.
      const costTuples = abilityCostChoiceTuples(state, playerId, sourceId, ability);
      for (const mode of arms) {
        const filters = modeOf(ability, mode).targeting?.filters ?? [];
        const modeField = ability.modes !== undefined ? { mode } : {};
        if (filters.length === 0) {
          for (const costChoices of costTuples) {
            out.push({
              type: "activateAbility",
              playerId,
              sourceId,
              abilityIndex,
              costChoices,
              ...modeField,
            });
          }
          continue;
        }
        for (const chosen of abilityTargetTuples(
          state,
          playerId,
          sourceId,
          ability,
          mode,
        )) {
          for (const costChoices of costTuples) {
            out.push({
              type: "activateAbility",
              playerId,
              sourceId,
              abilityIndex,
              targets: chosen,
              costChoices,
              ...modeField,
            });
          }
        }
      }
    });
  }

  for (const cardId of Object.keys(state.permanents)) {
    for (const destination of locations(state, playerId)) {
      out.push({ type: "standardMove", playerId, cardId, destination });
    }
  }

  return out;
}

/**
 * Every way an activated ability could answer its own choosing costs. The same
 * shape as `costChoiceTuples`, over the ability's printed cost list rather than
 * over the ordered costs a *play* assembles from four rules.
 */
function abilityCostChoiceTuples(
  state: GameState,
  playerId: PlayerId,
  sourceId: CardId,
  ability: ActivatedAbility,
): CardId[][][] {
  let out: CardId[][][] = [[]];
  for (const cost of ability.costs) {
    if (cost.kind !== "chosen") continue;
    const pool = choicePoolFor(state, playerId, cost, sourceId);
    const answers = (
      cost.count === "any"
        ? subsets(pool, pool.length)
        : subsets(pool, cost.count).filter((each) => each.length === cost.count)
    ).slice(0, COST_CHOICE_MAX);
    out = out.flatMap((prefix) => answers.map((answer) => [...prefix, answer]));
  }
  return out;
}

/**
 * The tuples an *activated* ability's chosen arm could take. Separate from
 * `targetTuples`, which reads a card's first ability off the printed card: an
 * ability being offered here is already in hand, mode and all.
 */
function abilityTargetTuples(
  state: GameState,
  playerId: PlayerId,
  sourceId: CardId,
  ability: ActivatedAbility,
  mode: number,
): CardId[][] {
  const filters = modeOf(ability, mode).targeting?.filters ?? [];
  if (filters.length === 0) return [[]];

  let tuples: CardId[][] = [[]];
  for (const filter of filters) {
    const legal = legalTargets(state, playerId, filter, sourceId);
    tuples = tuples.flatMap((prefix) =>
      legal.filter((id) => !prefix.includes(id)).map((id) => [...prefix, id]),
    );
    if (tuples.length === 0) break;
  }
  return tuples;
}
