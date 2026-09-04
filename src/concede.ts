import type { GameEvent, Progress } from "./events.js";
import type {
  BattlefieldState,
  CardId,
  CardInstance,
  GameState,
  PlayerId,
} from "./state.js";
import { ownerOf, seatOf } from "./state.js";

/**
 * R649–652 — Conceding, and the Removal of a Player.
 *
 * R650 lets a player concede at any time. What happens next depends on how
 * many are left: R651.1 ends the game when one player remains, and R651.2
 * sends everything else through R652's steps, which are written here in the
 * order the rules give them.
 *
 * A Duel therefore never reaches most of this file, which is exactly why it
 * did not exist before: with two seats a concession is "the other player
 * wins" and there is nothing to tidy up. With three, the game carries on
 * without the person who left, and every trace of them has to come off the
 * board without disturbing anyone else's.
 */

/** The card that stands in for a battlefield whose owner has gone (R652.2.a). */
function tokenBattlefield(cardId: CardId): CardInstance {
  return {
    id: cardId,
    name: "Abandoned Ground",
    type: "battlefield",
    cost: { energy: 0, power: {}, anyPower: 0 },
    keywords: [],
    // "…a token battlefield with no abilities." R652.2.c is the consequence:
    // any continuous effect it was applying stops, which happens by itself
    // once there is nothing here to apply.
    abilities: [],
    isToken: true,
    text: "The player who brought this battlefield has left the game.",
  };
}

/**
 * R650/R651 — one player concedes.
 *
 * The `winner` branch is R651.1: "If only one other player is remaining after
 * a player has conceded, the player remaining Wins." Note that it is written
 * about who *remains*, not about points — a concession hands the game over
 * regardless of the score.
 */
export function concede(state: GameState, playerId: PlayerId): Progress {
  if (state.winner !== null) return { state, events: [] };
  if (!state.turnOrder.includes(playerId)) return { state, events: [] };

  const remaining = state.turnOrder.filter((id) => id !== playerId);
  const events: GameEvent[] = [{ type: "conceded", playerId }];

  const soleSurvivor = remaining[0];
  if (remaining.length <= 1) {
    if (soleSurvivor === undefined) return { state, events };
    return {
      state: { ...state, winner: soleSurvivor },
      events: [
        ...events,
        {
          type: "gameWon",
          playerId: soleSurvivor,
          points: seatOf(state, soleSurvivor).points,
        },
      ],
    };
  }

  const removed = removePlayer(state, playerId);
  return { state: removed.state, events: [...events, ...removed.events] };
}

/**
 * R652 — the Removal of a Player, step by step. R651.3 is the standard it has
 * to meet: the removed player is "no longer being able to make choices or
 * otherwise influence the game", so anything of theirs that could still be
 * asked a question, or still be answered, has to go.
 */
export function removePlayer(state: GameState, gone: PlayerId): Progress {
  const events: GameEvent[] = [];
  let current = state;

  // R652.1 — "Banish all permanents, runes, and facedown cards they currently
  // control and all permanents, runes, and facedown cards they own." Both
  // clauses matter: a permanent of someone else's that they had taken control
  // of goes too, and R652.3 keeps it in the game only because its *owner* is
  // still playing.
  const permanents: GameState["permanents"] = {};
  const banishedBy: Partial<Record<PlayerId, CardId[]>> = {};
  for (const [cardId, permanent] of Object.entries(state.permanents)) {
    const owner = ownerOf(permanent);
    if (permanent.controller !== gone && owner !== gone) {
      permanents[cardId] = permanent;
      continue;
    }
    events.push({ type: "banished", playerId: owner, cardId });
    if (owner === gone) continue;
    banishedBy[owner] = [...(banishedBy[owner] ?? []), cardId];
  }

  // A rune's owner is the seat whose `runes` list holds it — `RuneState` is
  // the board object, not the ownership record.
  const theirRunes = new Set(seatOf(state, gone).runes);
  const runes: GameState["runes"] = {};
  for (const [runeId, rune] of Object.entries(state.runes)) {
    if (!theirRunes.has(runeId)) runes[runeId] = rune;
  }

  const facedown: GameState["facedown"] = {};
  for (const [battlefieldId, entry] of Object.entries(state.facedown)) {
    if (entry.controller !== gone) facedown[battlefieldId] = entry;
  }

  // R652.2 — "Remove the Battlefield they contributed to the game if it is in
  // use", and R652.2.a replaces it with a blank token in the same place.
  // R652.2.b is why the id is kept rather than minted afresh: "Any units or
  // hidden cards there do not move and are otherwise unaffected", and both
  // `PermanentState.location` and the facedown zone are keyed by that id.
  const battlefields: Record<CardId, BattlefieldState> = { ...state.battlefields };
  const cards: Record<CardId, CardInstance> = { ...state.cards };
  for (const [battlefieldId, battlefield] of Object.entries(battlefields)) {
    if (battlefield.owner !== gone) continue;
    cards[battlefieldId] = tokenBattlefield(battlefieldId);
    const { owner: _left, ...rest } = battlefield;
    battlefields[battlefieldId] = rest;
    events.push({ type: "battlefieldReplaced", battlefieldId });
  }

  // R652.3 — "Remove all cards they own from the game." Their zones go with
  // their seat; this is the registry, which outlives any zone.
  const theirs = new Set<CardId>();
  for (const [cardId, card] of Object.entries(state.cards)) {
    if (battlefields[cardId] !== undefined) continue;
    if (cardOwner(state, cardId) === gone) theirs.add(cardId);
    void card;
  }
  for (const cardId of theirs) delete cards[cardId];

  // R652.4 — "Counter all spells and abilities of all types controlled by the
  // player that has conceded."
  const chain = state.chain.filter((item) => item.controller !== gone);
  for (const item of state.chain) {
    if (item.controller === gone) {
      events.push({
        type: "spellCountered",
        playerId: gone,
        cardId: chainSourceOf(item),
      });
    }
  }

  const turnOrder = state.turnOrder.filter((id) => id !== gone);
  const { [gone]: _seat, ...rest } = state.players;
  const players: GameState["players"] = rest;
  const { [gone]: _played, ...playedThisTurn } = state.playedThisTurn;

  for (const [owner, ids] of Object.entries(banishedBy) as [
    PlayerId,
    CardId[],
  ][]) {
    const seat = players[owner];
    if (seat === undefined) continue;
    players[owner] = { ...seat, banished: [...seat.banished, ...ids] };
  }

  current = {
    ...state,
    turnOrder,
    players,
    playedThisTurn,
    cards,
    permanents,
    runes,
    facedown,
    battlefields,
    chain,
    // R651.3 — they can no longer make choices, so a question addressed to
    // them is withdrawn rather than left for nobody to answer.
    pending: state.pending?.player === gone ? null : state.pending,
    // Nor can the queue keep work that only they could do.
    tasks: state.tasks.filter((task) => !belongsTo(task, gone)),
    modifiers: state.modifiers.filter((modifier) => modifier.targetId !== gone),
    delayed: state.delayed.filter((entry) => entry.controller !== gone),
  };

  // R652.5 — proceed with the game. Each of the three handoffs is written as
  // "the next Player in order", which `turnOrder` now no longer contains them
  // in, so "next" is read off the seat they used to sit after.
  const at = state.turnOrder.indexOf(gone);
  const next = turnOrder[at % turnOrder.length]!;

  // R652.5.a.1 — "If the removed player was the Turn Player, play proceeds in
  // Turn Order to the next available player in order."
  if (current.turn.player === gone) {
    current = { ...current, turn: { ...current.turn, player: next } };
    events.push({ type: "turnBegan", playerId: next, turn: current.turn.number });
  }

  // R652.5.b — Focus. R652.5.b.2: if their leaving means everyone has passed,
  // the showdown is over, which `passFocus`'s own counter already decides —
  // so the count comes down with the seat.
  if (current.showdown !== null) {
    const showdown = current.showdown;
    current = {
      ...current,
      showdown: {
        ...showdown,
        focus: showdown.focus === gone ? next : showdown.focus,
        consecutivePasses: Math.min(
          showdown.consecutivePasses,
          turnOrder.length,
        ),
      },
    };
  }

  // R652.5.c — Priority, the same shape as Focus. R652.5.c.2's "all Players
  // have passed" is the same count against a smaller table.
  if (current.priority !== null) {
    current = {
      ...current,
      priority: current.priority === gone ? next : current.priority,
      priorityPasses: Math.min(current.priorityPasses, turnOrder.length),
    };
  }

  events.push({ type: "playerRemoved", playerId: gone });
  return { state: current, events };
}

/**
 * Who owns a card, for R652.3. Ids are stamped with the seat that brought
 * them (`instantiate(list, seat)`), which is the only record of ownership for
 * a card that is not on the board — one sitting in a hand, a deck or a trash.
 */
function cardOwner(state: GameState, cardId: CardId): PlayerId | undefined {
  for (const id of state.turnOrder) {
    const seat = state.players[id];
    if (seat === undefined) continue;
    if (
      seat.mainDeck.includes(cardId) ||
      seat.hand.includes(cardId) ||
      seat.trash.includes(cardId) ||
      seat.banished.includes(cardId) ||
      seat.runeDeck.includes(cardId) ||
      seat.runes.includes(cardId) ||
      seat.legend === cardId ||
      seat.champion === cardId
    ) {
      return id;
    }
  }
  const permanent = state.permanents[cardId];
  return permanent === undefined ? undefined : ownerOf(permanent);
}

function chainSourceOf(item: GameState["chain"][number]): CardId {
  return item.kind === "spell" ? item.cardId : item.sourceId;
}

/** A queued task only the removed player could carry out. */
function belongsTo(task: GameState["tasks"][number], gone: PlayerId): boolean {
  if ("player" in task && task.player === gone) return true;
  if ("assigning" in task && task.assigning === gone) return true;
  if ("attacker" in task && task.attacker === gone) return true;
  if (task.kind === "resumeEffect" && task.context.controller === gone) {
    return true;
  }
  return false;
}
