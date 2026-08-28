import type { GameEvent } from "./events.js";
import type { Cost, Location } from "./state.js";

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
export function locationName(location: Location): string {
  return location.kind === "base" ? `${location.player} base` : location.id;
}

export function renderEvent(event: GameEvent): string {
  switch (event.type) {
    case "cardDrawn":
      return `${event.playerId} drew ${event.cardId}`;
    case "unitPlayed":
      return `${event.playerId} played ${event.cardId}`;
    case "runeChanneled":
      return `${event.playerId} channeled ${event.cardId}`;
    case "runeRecycled":
      return `${event.playerId} recycled ${event.cardId} to the bottom of the rune deck`;
    case "energyAdded":
      return `${event.playerId} added ${event.amount} energy`;
    case "powerAdded":
      return `${event.playerId} added ${event.amount} ${event.domain} power`;
    case "costPaid":
      return `${event.playerId} paid ${formatCost(event.cost)} for ${event.cardId}`;
    case "turnBegan":
      return (`— turn ${event.turn}: ${event.playerId} —`);
    case "phaseBegan":
      return (`  ${event.phase} phase`);
    case "objectExhausted":
      return `${event.cardId} exhausts`;
    case "damageReplaced":
      return `damage to ${event.cardId} becomes ${event.to} (was ${event.from})`;
    case "healed":
      return `${event.cardId} is healed`;
    case "eventReplaced":
      return `${event.cardId} replaces ${event.subject}'s ${event.replaced}`;
    case "objectReadied":
      return `${event.playerId} readied ${event.cardId}`;
    case "poolEmptied":
      return (`  ${event.playerId} rune pool emptied`);
    case "unitMoved":
      return `${event.playerId} moved ${event.cardId} from ${locationName(event.from)} to ${locationName(event.to)}`;
    case "showdownOpened":
      return (`showdown opens at ${event.battlefieldId} — ${event.attacker} attacks and has focus`);
    case "focusPassed":
      return (`  ${event.playerId} passes`);
    case "showdownClosed":
      return (`  showdown at ${event.battlefieldId} closes`);
    case "battlefieldControlled":
      return (`${event.playerId} takes control of ${event.battlefieldId}`);
    case "battlefieldControlLost":
      return `${event.playerId} loses control of ${event.battlefieldId}`;
    case "battlefieldScored":
      return `${event.playerId} ${event.method === "conquer" ? "conquers" : "holds"} ${event.battlefieldId}`;
    case "pointGained":
      return (`${event.playerId} scores — now ${event.points} point${event.points === 1 ? "" : "s"}`);
    case "gameWon":
      return (`${event.playerId} WINS with ${event.points} points`);
    case "combatDamageDealt":
      return `combat at ${event.battlefieldId} — ${event.attacker} deals ${event.attackerMight}, defender deals ${event.defenderMight}`;
    case "unitKilled":
      return (`${event.cardId} dies (${event.playerId})`);
    case "unitRecalled":
      return `${event.cardId} is recalled to ${event.playerId} base`;
    case "damageDealt":
      return `${event.cardId} takes ${event.amount} damage`;
    case "spellPlayed":
      return (`${event.playerId} plays ${event.cardId} — it goes on the chain`);
    case "spellResolved":
      return `${event.cardId} resolves`;
    case "spellCountered":
      return (`${event.cardId} is countered`);
    case "priorityPassed":
      return (`  ${event.playerId} passes priority`);
    case "abilityTriggered":
      return (`${event.cardId} triggers — onto the chain`);
    case "triggerResolved":
      return `${event.cardId}'s trigger resolves`;
    case "decisionRequired":
      return (`${event.playerId} must decide: ${event.kind}`);
    case "targetsChosen":
      return `${event.playerId} targets ${event.targets.join(", ")}`;
    case "abilityDeclined":
      return (`  ${event.playerId} declines ${event.cardId}'s trigger`);
    case "mightModified": {
      const sign = event.amount >= 0 ? "+" : "";
      return `${event.cardId} gets ${sign}${event.amount} Might (${event.duration})`;
    }
    case "keywordGranted":
      return `${event.cardId} gains [${event.keyword}] (${event.duration})`;
    case "modifiersExpired":
      return (`  ${event.duration} effects expire`);
    case "effectScheduled":
      return (`  ${event.cardId} schedules an effect for ${event.at}`);
    case "controlTaken":
      return `${event.playerId} takes control of ${event.cardId} (${event.duration})`;
    case "mulliganed":
      return `${event.playerId} mulliganed ${event.count}`;
    case "returnedToHand":
      return `${event.cardId} returns to ${event.playerId}'s hand`;
    case "banished":
      return `${event.cardId} is banished`;
    case "buffed":
      return `${event.cardId} gets a buff`;
    case "stunned":
      return `${event.cardId} is stunned`;
    case "burnedOut":
      return (`${event.playerId} burned out — trash recycled, opponent scores`);
    case "tokenCreated":
      return `${event.playerId} creates a ${event.token} token [${event.cardId}]`;
    case "xpGained":
      return `${event.playerId} gains ${event.amount} XP`;
    case "cardHidden":
      return `${event.playerId} hides a card at ${event.battlefieldId}`;
    case "facedownRemoved":
      return `${event.cardId} is trashed from ${event.battlefieldId}'s facedown zone`;
    case "cardRecycled":
      return `${event.playerId} recycles ${event.cardId}`;
    case "attached":
      return `${event.cardId} attaches to ${event.to}`;
    case "combatOpened":
      return `combat opens at ${event.battlefieldId}`;
    case "designated":
      return `${event.cardId} is an ${event.designation}`;
    case "cardRevealed":
      return `${event.playerId} reveals ${event.cardId}`;
    case "cardDiscarded":
      return `${event.playerId} discards ${event.cardId}`;
    case "cardBurned":
      return `${event.playerId} burns ${event.cardId}`;
    case "disempowered":
      return `${event.cardId} is no longer empowered`;
    case "empowered":
      return `${event.cardId} is empowered`;
    case "combatResolved":
      return event.winner === null
        ? `combat at ${event.battlefieldId} ends with no result`
        : (`${event.winner} wins the combat at ${event.battlefieldId}`);
    default: {
      const unhandled: never = event;
      return JSON.stringify(unhandled);
    }
  }
}
