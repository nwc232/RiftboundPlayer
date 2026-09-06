import type { GameEvent } from "./events.js";
import type { CardId, CardInstance, Cost, Location } from "./state.js";
import { isHiddenCard } from "./view.js";

/**
 * One sentence per event, in plain text. This is domain wording, not
 * presentation: the same sentence serves the CLI (which paints it) and the
 * browser (which styles it), so it lives here rather than in either.
 *
 * Nothing here touches `process` or the DOM, which is what lets the UI import
 * it — the engine's core has no Node-only dependencies and this keeps it so.
 */
/** A cost in words: "3e + 1 fury", or "free". */
export function formatCost(cost: Cost): string {
  const parts: string[] = [];
  if (cost.energy > 0) parts.push(`${cost.energy}e`);
  for (const [domain, count] of Object.entries(cost.power)) {
    if (count !== undefined && count > 0) parts.push(`${count} ${domain}`);
  }
  if (cost.anyPower > 0) parts.push(`${cost.anyPower} any`);
  return parts.length === 0 ? "free" : parts.join(" + ");
}

/** Where something is, named the way a player would say it. */
export function locationName(
  location: Location,
  cards?: Record<CardId, CardInstance>,
): string {
  if (location.kind === "base") return `${location.player} base`;
  return cards?.[location.id]?.name ?? location.id;
}

/**
 * One event, in a sentence.
 *
 * `cards` is the registry, so the log can say "Vex, Gloomist" where it used to
 * say "p1-gloomist". Optional because the engine's own tests read the log
 * without a board, and because an id is a worse sentence rather than a wrong
 * one — but a player should never be shown one.
 */
export function renderEvent(
  event: GameEvent,
  cards?: Record<CardId, CardInstance>,
): string {
  /**
   * R107 — a card the reader is not entitled to see arrives from `eventsFor`
   * as a stand-in, so the sentence has to name it as one. "p2 drew a card" is
   * the whole of what an opponent's draw is allowed to say.
   */
  const named = (cardId: string) =>
    isHiddenCard(cardId) ? "a card" : (cards?.[cardId]?.name ?? cardId);

  switch (event.type) {
    case "cardDrawn":
      return `${event.playerId} drew ${named(event.cardId)}`;
    // R194.3.a — a card moved the finish line.
    case "victoryScoreRaised":
      return `the points needed to win went up by ${event.by}`;
    // R716 — an Equipment comes off its unit.
    case "detached":
      return `${named(event.cardId)} was detached from ${named(event.fromCardId)}`;
    // R149.3 — a loose gear left at a battlefield goes home.
    case "gearRecalled":
      return `${named(event.cardId)} was recalled to ${event.playerId}'s base`;
    // R650/R652 — a player leaves the game in progress.
    case "conceded":
      return `${event.playerId} conceded`;
    case "playerRemoved":
      return `${event.playerId} was removed from the game`;
    // R652.2.a — their battlefield stands, blank, with whatever is on it.
    case "battlefieldReplaced":
      return `${named(event.battlefieldId)} was replaced with a token battlefield`;
    // R487.7/R488.7 — going first costs you your first draw.
    case "drawSkipped":
      return `${event.playerId} skipped their first draw (going first)`;
    case "unitPlayed":
      return `${event.playerId} played ${named(event.cardId)}`;
    case "runeChanneled":
      return `${event.playerId} channeled ${named(event.cardId)}`;
    case "runeRecycled":
      return `${event.playerId} recycled ${named(event.cardId)} to the bottom of the rune deck`;
    case "energyAdded":
      return `${event.playerId} added ${event.amount} energy`;
    case "powerAdded":
      return `${event.playerId} added ${event.amount} ${event.domain} power`;
    case "costPaid":
      return `${event.playerId} paid ${formatCost(event.cost)} for ${named(event.cardId)}`;
    case "turnBegan":
      return (`— turn ${event.turn}: ${event.playerId} —`);
    case "phaseBegan":
      return (`  ${event.phase} phase`);
    case "objectExhausted":
      return `${named(event.cardId)} exhausts`;
    case "damageReplaced":
      return `damage to ${named(event.cardId)} becomes ${event.to} (was ${event.from})`;
    case "healed":
      return `${named(event.cardId)} is healed`;
    case "eventReplaced":
      return `${named(event.cardId)} replaces ${event.subject}'s ${event.replaced}`;
    case "objectReadied":
      return `${event.playerId} readied ${named(event.cardId)}`;
    case "poolEmptied":
      return (`  ${event.playerId} rune pool emptied`);
    case "unitMoved":
      return `${event.playerId} moved ${named(event.cardId)} from ${locationName(event.from, cards)} to ${locationName(event.to, cards)}`;
    case "showdownOpened":
      return (`showdown opens at ${named(event.battlefieldId)} — ${event.attacker} attacks and has focus`);
    case "focusPassed":
      return (`  ${event.playerId} passes`);
    case "showdownClosed":
      return (`  showdown at ${named(event.battlefieldId)} closes`);
    case "battlefieldControlled":
      return (`${event.playerId} takes control of ${named(event.battlefieldId)}`);
    case "battlefieldControlLost":
      return `${event.playerId} loses control of ${named(event.battlefieldId)}`;
    case "battlefieldScored":
      return `${event.playerId} ${event.method === "conquer" ? "conquers" : "holds"} ${named(event.battlefieldId)}`;
    case "pointGained":
      return (`${event.playerId} scores — now ${event.points} point${event.points === 1 ? "" : "s"}`);
    case "gameWon":
      return (`${event.playerId} WINS with ${event.points} points`);
    case "combatDamageDealt":
      return `combat at ${named(event.battlefieldId)} — ${event.attacker} deals ${event.attackerMight}, defender deals ${event.defenderMight}`;
    case "unitKilled":
      return (`${named(event.cardId)} dies (${event.playerId})`);
    case "unitRecalled":
      return `${named(event.cardId)} is recalled to ${event.playerId} base`;
    case "damageDealt":
      return `${named(event.cardId)} takes ${event.amount} damage`;
    case "spellPlayed":
      return (`${event.playerId} plays ${named(event.cardId)} — it goes on the chain`);
    case "spellResolved":
      return `${named(event.cardId)} resolves`;
    case "spellCountered":
      return (`${named(event.cardId)} is countered`);
    case "priorityPassed":
      return (`  ${event.playerId} passes priority`);
    case "abilityTriggered":
      return (`${named(event.cardId)} triggers — onto the chain`);
    case "triggerResolved":
      return `${named(event.cardId)}'s trigger resolves`;
    case "decisionRequired":
      return (`${event.playerId} must decide: ${event.kind}`);
    case "targetsChosen":
      return `${event.playerId} targets ${event.targets.join(", ")}`;
    case "abilityDeclined":
      return (`  ${event.playerId} declines ${named(event.cardId)}'s trigger`);
    case "mightModified": {
      const sign = event.amount >= 0 ? "+" : "";
      return `${named(event.cardId)} gets ${sign}${event.amount} Might (${event.duration})`;
    }
    case "keywordGranted":
      return `${named(event.cardId)} gains [${event.keyword}] (${event.duration})`;
    case "modifiersExpired":
      return (`  ${event.duration} effects expire`);
    case "effectScheduled":
      return (`  ${named(event.cardId)} schedules an effect for ${event.at}`);
    case "controlTaken":
      return `${event.playerId} takes control of ${named(event.cardId)} (${event.duration})`;
    case "mulliganed":
      return `${event.playerId} mulliganed ${event.count}`;
    case "returnedToHand":
      return `${named(event.cardId)} returns to ${event.playerId}'s hand`;
    case "banished":
      return `${named(event.cardId)} is banished`;
    case "buffed":
      return `${named(event.cardId)} gets a buff`;
    case "stunned":
      return `${named(event.cardId)} is stunned`;
    case "burnedOut":
      return (`${event.playerId} burned out — trash recycled, opponent scores`);
    case "tokenCreated":
      return `${event.playerId} creates a ${event.token} token [${named(event.cardId)}]`;
    case "xpGained":
      return `${event.playerId} gains ${event.amount} XP`;
    case "cardHidden":
      return `${event.playerId} hides a card at ${named(event.battlefieldId)}`;
    case "facedownRemoved":
      return `${named(event.cardId)} is trashed from ${named(event.battlefieldId)}'s facedown zone`;
    case "cardRecycled":
      return `${event.playerId} recycles ${named(event.cardId)}`;
    case "attached":
      return `${named(event.cardId)} attaches to ${event.to}`;
    case "combatOpened":
      return `combat opens at ${named(event.battlefieldId)}`;
    case "designated":
      return `${named(event.cardId)} is an ${event.designation}`;
    case "cardRevealed":
      return `${event.playerId} reveals ${named(event.cardId)}`;
    case "cardDiscarded":
      return `${event.playerId} discards ${named(event.cardId)}`;
    case "cardBurned":
      return `${event.playerId} burns ${named(event.cardId)}`;
    case "disempowered":
      return `${named(event.cardId)} is no longer empowered`;
    case "empowered":
      return `${named(event.cardId)} is empowered`;
    case "combatResolved":
      return event.winner === null
        ? `combat at ${named(event.battlefieldId)} ends with no result`
        : (`${event.winner} wins the combat at ${named(event.battlefieldId)}`);
    default: {
      const unhandled: never = event;
      return JSON.stringify(unhandled);
    }
  }
}
