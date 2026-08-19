import type { GameEvent, Progress } from "./events.js";
import { score } from "./scoring.js";
import { permanentsAt } from "./state.js";
import type { CardId, GameState, PermanentState, PlayerId } from "./state.js";

/**
 * Printed Might. Assault (+X while attacking) and Shield (+X while defending)
 * are not applied yet — those are arithmetic-layer modifiers (R477.3) and need
 * the layer system, so combat currently fights on printed values only.
 */
export function mightOf(state: GameState, cardId: CardId): number {
  return state.cards[cardId]?.might ?? 0;
}

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

/**
 * R465.2.c.6–8 — Tank must be assigned damage first, Backline last. Units with
 * neither sit in between. Order within a band is the assigning player's choice;
 * we keep board order, which is one of the legal choices.
 */
function assignmentOrder(
  state: GameState,
  units: PermanentState[],
): PermanentState[] {
  const band = (permanent: PermanentState): number => {
    const keywords = state.cards[permanent.cardId]?.keywords ?? [];
    if (keywords.includes("tank")) return 0;
    if (keywords.includes("backline")) return 2;
    return 1;
  };
  return [...units].sort((a, b) => band(a) - band(b));
}

/**
 * R465.2.c — assign `total` damage across `targets`, giving each exactly lethal
 * before moving on (R465.2.c.3) and never over-assigning while other units
 * remain unassigned (R465.2.c.4). Leftover damage, once everything has lethal,
 * piles onto the last unit.
 */
export function assignDamage(
  state: GameState,
  total: number,
  targets: PermanentState[],
): Map<CardId, number> {
  const order = assignmentOrder(state, targets);
  const assigned = new Map<CardId, number>();
  let remaining = total;

  for (const permanent of order) {
    if (remaining <= 0) break;
    const needed = lethalRemaining(state, permanent);
    const amount = Math.min(needed, remaining);
    assigned.set(permanent.cardId, amount);
    remaining -= amount;
  }

  const last = order[order.length - 1];
  if (remaining > 0 && last !== undefined) {
    assigned.set(last.cardId, (assigned.get(last.cardId) ?? 0) + remaining);
  }

  return assigned;
}

/** R428 — killed permanents go straight to the trash from the board. */
export function killUnits(state: GameState, cardIds: CardId[]): Progress {
  if (cardIds.length === 0) return { state, events: [] };

  const permanents = { ...state.permanents };
  const players = { ...state.players };
  const events: GameEvent[] = [];

  for (const cardId of cardIds) {
    const permanent = permanents[cardId];
    if (permanent === undefined) continue;
    delete permanents[cardId];
    // Owner isn't tracked separately from controller yet; R56 sends a card to
    // its owner's trash, which matters once control-stealing effects exist.
    const owner = permanent.controller;
    players[owner] = {
      ...players[owner],
      trash: [...players[owner].trash, cardId],
    };
    events.push({ type: "unitKilled", playerId: owner, cardId });
  }

  return { state: { ...state, permanents, players }, events };
}

/**
 * R428.1.a.2 — a unit with lethal damage marked on it dies in the cleanup,
 * whether the damage came from combat or from a spell.
 */
export function killLethalUnits(state: GameState): Progress {
  const dying = Object.values(state.permanents)
    .filter(
      (permanent) =>
        permanent.damage > 0 &&
        permanent.damage >= mightOf(state, permanent.cardId),
    )
    .map((permanent) => permanent.cardId);
  return killUnits(state, dying);
}

/** R466.1.a.1 — the combat cleanup heals every unit. */
function healAllUnits(state: GameState): GameState {
  const permanents = { ...state.permanents };
  for (const [cardId, permanent] of Object.entries(permanents)) {
    if (permanent.damage > 0) {
      permanents[cardId] = { ...permanent, damage: 0 };
    }
  }
  return { ...state, permanents };
}

/**
 * Runs the Combat Damage Step (R465) and the Resolution Step (R466) for a
 * combat at `battlefieldId`.
 *
 * Damage assignment is computed rather than asked for. The constraints in
 * R465.2.c are all enforced, so the result is always a legal assignment — but
 * the player isn't yet offered the choice between equally legal orderings.
 */
export function resolveCombat(
  state: GameState,
  battlefieldId: CardId,
  attacker: PlayerId,
): Progress {
  const defender: PlayerId = attacker === "p1" ? "p2" : "p1";
  const events: GameEvent[] = [];

  const attackers = unitsAt(state, battlefieldId).filter(
    (unit) => unit.controller === attacker,
  );
  const defenders = unitsAt(state, battlefieldId).filter(
    (unit) => unit.controller === defender,
  );

  const attackerMight = attackers.reduce(
    (sum, unit) => sum + mightOf(state, unit.cardId),
    0,
  );
  const defenderMight = defenders.reduce(
    (sum, unit) => sum + mightOf(state, unit.cardId),
    0,
  );

  events.push({
    type: "combatDamageDealt",
    battlefieldId,
    attacker,
    attackerMight,
    defenderMight,
  });

  // R465.2.c — the attacker assigns first, but all damage is dealt at once
  // (R465.2.c.1.a), so both assignments read the same pre-damage board.
  const toDefenders = assignDamage(state, attackerMight, defenders);
  const toAttackers = assignDamage(state, defenderMight, attackers);

  const permanents = { ...state.permanents };
  for (const [cardId, amount] of [...toDefenders, ...toAttackers]) {
    const permanent = permanents[cardId];
    if (permanent === undefined) continue;
    permanents[cardId] = { ...permanent, damage: permanent.damage + amount };
  }
  let current: GameState = { ...state, permanents };

  // Units with lethal damage die in the cleanup that follows.
  const killed = killLethalUnits(current);
  current = killed.state;
  events.push(...killed.events);

  // R466.1.a.1 then R466.1.a.2, in that order.
  current = healAllUnits(current);

  const survivingAttackers = unitsAt(current, battlefieldId).filter(
    (unit) => unit.controller === attacker,
  );
  const survivingDefenders = unitsAt(current, battlefieldId).filter(
    (unit) => unit.controller === defender,
  );

  // R466.1.a.2 — a repelled attack goes home. Recall is not a move (R456).
  if (survivingDefenders.length > 0 && survivingAttackers.length > 0) {
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

  return { state: current, events };
}
