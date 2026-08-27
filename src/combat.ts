import type { GameEvent, Progress } from "./events.js";
import {
  abilitiesOf,
  controllerOf,
  dealsCombatDamage,
  expireModifiers,
  keywordsOf,
  mightOf,
} from "./layers.js";
// A cycle: abilities.ts imports `killUnits` back from here. ESM allows it
// because neither side calls the other during module initialization, and
// tests/combat.test.ts imports both orders to keep that true.
import { execute } from "./abilities.js";
import { deathReplacementsFor } from "./replacements.js";
import type { ApplicableReplacement } from "./replacements.js";
import { score } from "./scoring.js";
import { ownerOf, permanentsAt } from "./state.js";
import type {
  CardId,
  Designation,
  GameState,
  PermanentState,
  PlayerId,
} from "./state.js";

export { mightOf };

/** R142.4.b — lethal is a non-zero amount at or above the unit's Might. */
export function lethalRemaining(
  state: GameState,
  permanent: PermanentState,
): number {
  return Math.max(1, mightOf(state, permanent.cardId) - permanent.damage);
}

export function unitsAt(
  state: GameState,
  battlefieldId: CardId,
): PermanentState[] {
  return permanentsAt(state, { kind: "battlefield", id: battlefieldId }).filter(
    (permanent) => state.cards[permanent.cardId]?.type === "unit",
  );
}

/** True once units controlled by opposing players share a battlefield. */
export function isCombatAt(state: GameState, battlefieldId: CardId): boolean {
  const controllers = new Set(
    unitsAt(state, battlefieldId).map((unit) => unit.controller),
  );
  return controllers.size >= 2;
}

/** One unit's share of a player's summed Might, before any of it is dealt. */
export interface Assignment {
  cardId: CardId;
  amount: number;
}

/**
 * R465.2.c.6 — Tank must be assigned damage first, Backline last. Read through
 * the layers, so a Tank granted by another card counts the same as a printed
 * one (R815.3 makes having Tank a characteristic).
 */
function bandOf(state: GameState, permanent: PermanentState): number {
  const keywords = keywordsOf(state, permanent.cardId);
  if (keywords.includes("tank")) return 0;
  if (keywords.includes("backline")) return 2;
  return 1;
}

/**
 * R465.2.c.7 — the units that may legally be assigned damage next: everything
 * still unassigned in the highest-priority band that has anyone left in it.
 * Within a band the order is the assigning player's free choice, which is
 * exactly the choice the engine has to offer them.
 */
export function nextAssignable(
  state: GameState,
  targets: PermanentState[],
  assigned: Assignment[],
): PermanentState[] {
  const done = new Set(assigned.map((entry) => entry.cardId));
  const left = targets.filter((target) => !done.has(target.cardId));
  if (left.length === 0) return [];

  const top = Math.min(...left.map((target) => bandOf(state, target)));
  return left.filter((target) => bandOf(state, target) === top);
}

/**
 * R465.2.c.3 — exactly lethal before moving on; R465.2.c.4 — never more than
 * that while other units remain unassigned. Once nothing else is left to
 * assign to, the final unit absorbs whatever damage is still in hand.
 */
export function amountFor(
  state: GameState,
  permanent: PermanentState,
  remaining: number,
  isLastUnassigned: boolean,
): number {
  if (isLastUnassigned) return remaining;
  return Math.min(lethalRemaining(state, permanent), remaining);
}

/**
 * One legal assignment of `total` across `targets`, always taking the first
 * legal unit at each step. Used where no player choice is offered — either
 * because only one unit is assignable or as a canonical reference ordering.
 */
export function assignDamage(
  state: GameState,
  total: number,
  targets: PermanentState[],
): Map<CardId, number> {
  const assigned: Assignment[] = [];
  let remaining = total;

  while (remaining > 0) {
    const legal = nextAssignable(state, targets, assigned);
    const next = legal[0];
    if (next === undefined) break;

    const amount = amountFor(
      state,
      next,
      remaining,
      assigned.length + 1 === targets.length,
    );
    assigned.push({ cardId: next.cardId, amount });
    remaining -= amount;
  }

  return new Map(assigned.map((entry) => [entry.cardId, entry.amount]));
}

/**
 * R323.2 — units at the battlefield a combat is happening at take their
 * controller's designation; units anywhere else lose theirs (R323.2.c). Assault
 * and Shield key off this, not off "a combat is happening somewhere".
 */
export function assignDesignations(
  state: GameState,
  battlefieldId: CardId,
  attacker: PlayerId,
): Progress {
  const permanents: Record<CardId, PermanentState> = {};
  const events: GameEvent[] = [];

  for (const [cardId, permanent] of Object.entries(state.permanents)) {
    const here =
      permanent.location.kind === "battlefield" &&
      permanent.location.id === battlefieldId;

    if (here && state.cards[cardId]?.type === "unit") {
      const designation: Designation =
        controllerOf(state, cardId) === attacker ? "attacker" : "defender";
      permanents[cardId] = { ...permanent, designation };
      // R323.2.a/b only *gain* a designation a unit doesn't already have, and
      // R464.2.e watches that gaining. Re-affirming one it already holds is not
      // an event, so "when I attack" cannot fire twice for the same combat.
      if (permanent.designation !== designation) {
        events.push({
          type: "designated",
          playerId: permanent.controller,
          cardId,
          designation,
        });
      }
    } else {
      const { designation: _cleared, ...rest } = permanent;
      permanents[cardId] = rest;
    }
  }

  return { state: { ...state, permanents }, events };
}

/** R466.7.a — combat ends, and every designation goes with it. */
export function clearDesignations(state: GameState): GameState {
  const permanents: Record<CardId, PermanentState> = {};
  for (const [cardId, permanent] of Object.entries(state.permanents)) {
    const { designation: _cleared, ...rest } = permanent;
    permanents[cardId] = rest;
  }
  return { ...state, permanents };
}

/** R465.2.a/b — each side's summed Might, read before any damage is dealt. */
export function combatSides(
  state: GameState,
  battlefieldId: CardId,
  attacker: PlayerId,
): {
  attackers: PermanentState[];
  defenders: PermanentState[];
  attackerMight: number;
  defenderMight: number;
} {
  const defender: PlayerId = attacker === "p1" ? "p2" : "p1";
  const present = unitsAt(state, battlefieldId);
  const attackers = present.filter(
    (unit) => controllerOf(state, unit.cardId) === attacker,
  );
  const defenders = present.filter(
    (unit) => controllerOf(state, unit.cardId) === defender,
  );
  // R423.1.b — a Stunned unit "does not contribute its might to damage in the
  // combat damage step", and Vilemaw silences an enemy the same way. R423.1.c
  // keeps full Might for lethal purposes, so this is deliberately only about
  // the sum, not about `mightOf`.
  const sum = (units: PermanentState[]) =>
    units.reduce(
      (total, unit) =>
        total +
        (dealsCombatDamage(state, unit.cardId) ? mightOf(state, unit.cardId) : 0),
      0,
    );

  return {
    attackers,
    defenders,
    attackerMight: sum(attackers),
    defenderMight: sum(defenders),
  };
}

/**
 * R465.2.c.1.a / R465.2.d — assigning is not dealing. Both players assign
 * against the same pre-damage board, and only then is all of it dealt at once.
 */
export function dealAssigned(state: GameState, assigned: Assignment[]): Progress {
  const permanents = { ...state.permanents };
  const events: GameEvent[] = [];

  for (const { cardId, amount } of assigned) {
    const permanent = permanents[cardId];
    if (permanent === undefined) continue;
    permanents[cardId] = { ...permanent, damage: permanent.damage + amount };
    events.push({
      type: "damageDealt",
      playerId: permanent.controller,
      cardId,
      amount,
    });
  }

  return { state: { ...state, permanents }, events };
}

/** R428 — killed permanents go straight to the trash from the board. */
export interface KillOutcome extends Progress {
  /**
   * R372 — more than one replacement applies to this death and "the controller
   * of the object being acted on determines the order". Nothing has been
   * killed yet; the caller asks, then calls back with the answer.
   */
  choice?: { cardId: CardId; options: ApplicableReplacement[] };
}

/**
 * R428 — killed permanents go straight to the trash from the board, unless a
 * replacement effect intercedes first (R369). R370.1.c applies replacements
 * "before any qualifying event has actually occurred", so this checks *before*
 * the loop below moves anything.
 *
 * R373 treats each simultaneous death separately, which is why the check is
 * per card rather than for the batch.
 */
export function killUnits(
  state: GameState,
  cardIds: CardId[],
  /** Replacements already chosen for a death, by card id (R372's answer). */
  chosen: Record<CardId, CardId> = {},
): KillOutcome {
  if (cardIds.length === 0) return { state, events: [] };

  for (const cardId of cardIds) {
    if (state.permanents[cardId] === undefined) continue;
    const options = deathReplacementsFor(state, cardId);
    if (options.length === 0) continue;

    const pick =
      options.length === 1
        ? options[0]!
        : options.find((option) => option.sourceId === chosen[cardId]);

    // R372 — a genuine choice of order, so the controller of the dying unit is
    // asked. Only raised when the answer could differ.
    if (pick === undefined) {
      return {
        state,
        events: [],
        choice: { cardId, options },
      };
    }

    return applyDeathReplacement(state, cardId, pick, cardIds, chosen);
  }

  return killOutright(state, cardIds);
}

/**
 * R370.1.b — the qualifying event is replaced by the game actions the
 * replacement describes. The unit does not die: R370.1.a.1 makes that the same
 * as the kill never having happened, so no death trigger fires for it.
 *
 * Chained replacements — one applying to what another replaced — are R370.2
 * and R373.2's territory and are deferred; see the survey.
 */
function applyDeathReplacement(
  state: GameState,
  cardId: CardId,
  pick: ApplicableReplacement,
  batch: CardId[],
  chosen: Record<CardId, CardId>,
): KillOutcome {
  const outcome = execute(state, pick.instead, {
    controller: pick.controller,
    sourceId: pick.sourceId,
    // "it" — the unit whose death was replaced.
    targets: [cardId],
  });

  const tallied: GameState = {
    ...outcome.state,
    // R371.1 — the allowance is spent whether or not anything visible changed.
    triggeredThisTurn: {
      ...outcome.state.triggeredThisTurn,
      [pick.tally]: (outcome.state.triggeredThisTurn[pick.tally] ?? 0) + 1,
    },
  };

  const events: GameEvent[] = [
    {
      type: "eventReplaced",
      playerId: pick.controller,
      cardId: pick.sourceId,
      subject: cardId,
      replaced: "death",
    },
    ...outcome.events,
  ];

  // The rest of the batch still dies (R373 — each event is separate).
  const rest = killUnits(
    tallied,
    batch.filter((id) => id !== cardId),
    chosen,
  );
  return {
    ...rest,
    state: rest.state,
    events: [...events, ...rest.events],
  };
}

function killOutright(state: GameState, cardIds: CardId[]): Progress {
  const permanents = { ...state.permanents };
  const players = { ...state.players };
  const events: GameEvent[] = [];

  const cards = { ...state.cards };

  for (const cardId of cardIds) {
    const permanent = permanents[cardId];
    if (permanent === undefined) continue;
    delete permanents[cardId];

    // R56 — a killed card goes to its *owner's* trash, not its controller's.
    const owner = ownerOf(permanent);

    if (state.cards[cardId]?.isToken === true) {
      // R186.1 — a token put into any non-board zone besides the chain ceases
      // to exist immediately, so it never reaches a trash to be recurred from.
      // Its definition stays in `state.cards`, which is a registry rather than
      // a zone: R808.1.d.2 queues a death trigger *before* the card moves, and
      // a copied Deathknell has to be readable to resolve at all.
      void cards;
    } else {
      players[owner] = {
        ...players[owner],
        trash: [...players[owner].trash, cardId],
      };
    }
    // R323.4/R808.1.d.3 — note location and attributes before the card leaves
    // the board. Read from `state`, which this loop never mutates, so units
    // dying together all see the same pre-death board: R323.4's step 3a runs
    // before any of 3b's kills.
    events.push({
      type: "unitKilled",
      playerId: owner,
      cardId,
      location: permanent.location,
      might: mightOf(state, cardId),
      abilities: abilitiesOf(state, cardId),
    });
  }

  return { state: { ...state, permanents, players, cards }, events };
}

/**
 * R428.1.a.2 — a unit with lethal damage marked on it dies in the cleanup,
 * whether the damage came from combat or from a spell.
 */
export function killLethalUnits(
  state: GameState,
  chosen: Record<CardId, CardId> = {},
): KillOutcome {
  return killUnits(state, lethallyDamaged(state), chosen);
}

/** R428.1.a.2's list — everything currently carrying lethal damage. */
function lethallyDamaged(state: GameState): CardId[] {
  return Object.values(state.permanents)
    .filter(
      (permanent) =>
        permanent.damage > 0 &&
        permanent.damage >= mightOf(state, permanent.cardId),
    )
    .map((permanent) => permanent.cardId);
}

/**
 * R372's question, asked before anything is killed: is there a death that more
 * than one replacement could intercede in, which the controller has not yet
 * ordered? Tasks call this so they can suspend and ask — `execute` cannot.
 */
export function ambiguousDeath(
  state: GameState,
  chosen: Record<CardId, CardId>,
): { cardId: CardId; options: ApplicableReplacement[] } | undefined {
  for (const cardId of lethallyDamaged(state)) {
    if (chosen[cardId] !== undefined) continue;
    const options = deathReplacementsFor(state, cardId);
    if (options.length > 1) return { cardId, options };
  }
  return undefined;
}

/** R466.1.a.1 — the combat cleanup heals every unit. */
export function healAllUnits(state: GameState): GameState {
  const permanents = { ...state.permanents };
  for (const [cardId, permanent] of Object.entries(permanents)) {
    if (permanent.damage > 0) {
      permanents[cardId] = { ...permanent, damage: 0 };
    }
  }
  return { ...state, permanents };
}

/**
 * R466 — the Resolution Step, run once combat damage has been dealt: deaths,
 * then the combat cleanup's inserted heal and recall, then the combat result
 * and control.
 */
export function resolveCombatAftermath(
  state: GameState,
  battlefieldId: CardId,
  attacker: PlayerId,
  chosen: Record<CardId, CardId> = {},
): Progress {
  const defender: PlayerId = attacker === "p1" ? "p2" : "p1";
  const events: GameEvent[] = [];
  let current: GameState = state;

  // Units with lethal damage die in the cleanup that follows. Designations are
  // still in place here, so a Shielded defender's Might counts for survival.
  const killed = killLethalUnits(current, chosen);
  current = killed.state;
  events.push(...killed.events);

  // R466.1.a.1 then R466.1.a.2, in that order.
  current = healAllUnits(current);

  const survivingAttackers = unitsAt(current, battlefieldId).filter(
    (unit) => controllerOf(current, unit.cardId) === attacker,
  );
  const survivingDefenders = unitsAt(current, battlefieldId).filter(
    (unit) => controllerOf(current, unit.cardId) === defender,
  );

  // R466.1.a.2 — a repelled attack goes home. Recall is not a move (R456).
  const repelled =
    survivingDefenders.length > 0 && survivingAttackers.length > 0;
  if (repelled) {
    const recalled = { ...current.permanents };
    for (const unit of survivingAttackers) {
      recalled[unit.cardId] = {
        ...unit,
        location: { kind: "base", player: attacker },
      };
      events.push({
        type: "unitRecalled",
        playerId: attacker,
        cardId: unit.cardId,
      });
    }
    current = { ...current, permanents: recalled };
  }

  // R466.3 — the Combat Result, its own step after the Combat Cleanup. A player
  // won if they held a designation and are the only one with units still here
  // (R466.3.a); R466.3.c passes that result down to their units, which is what
  // Nidalee's "I win if I remain after combat" means. R466.3.d makes a repel
  // No Result, so a repelled attacker has neither won nor lost.
  const stillHere = unitsAt(current, battlefieldId);
  const attackersLeft = stillHere.some(
    (unit) => controllerOf(current, unit.cardId) === attacker,
  );
  const defendersLeft = stillHere.some(
    (unit) => controllerOf(current, unit.cardId) === defender,
  );
  const winner: PlayerId | null = repelled
    ? null
    : attackersLeft && !defendersLeft
      ? attacker
      : defendersLeft && !attackersLeft
        ? defender
        : null;
  events.push({
    type: "combatResolved",
    battlefieldId,
    winner,
    loser: winner === null ? null : winner === attacker ? defender : attacker,
  });

  // R466.5 — whoever is left establishes control; it need not be the attacker.
  const remaining = unitsAt(current, battlefieldId);
  const holders = new Set(remaining.map((unit) => unit.controller));
  const battlefield = current.battlefields[battlefieldId];

  if (battlefield !== undefined) {
    const soleHolder = holders.size === 1 ? [...holders][0] : undefined;

    if (soleHolder !== undefined && battlefield.controller !== soleHolder) {
      current = {
        ...current,
        battlefields: {
          ...current.battlefields,
          [battlefieldId]: {
            ...battlefield,
            controller: soleHolder,
            contestedBy: null,
          },
        },
      };
      events.push({
        type: "battlefieldControlled",
        playerId: soleHolder,
        battlefieldId,
      });
      const scored = score(current, soleHolder, battlefieldId, "conquer");
      current = scored.state;
      events.push(...scored.events);
    } else {
      // R466.5.b — nobody left means the battlefield goes uncontrolled.
      current = {
        ...current,
        battlefields: {
          ...current.battlefields,
          [battlefieldId]: {
            ...battlefield,
            controller: holders.size === 0 ? null : battlefield.controller,
            contestedBy: null,
          },
        },
      };
    }
  }

  // R466.7 — combat ends. R466.7.a removes every designation and R466.7.c
  // expires "this combat" effects, both simultaneously.
  const ended = expireModifiers(clearDesignations(current), "thisCombat");
  if (ended.modifiers.length !== current.modifiers.length) {
    events.push({ type: "modifiersExpired", duration: "thisCombat" });
  }
  return { state: ended, events };
}
