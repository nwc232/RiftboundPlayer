import { totals } from "../cost.js";
import { VICTORY_SCORE } from "../scoring.js";
import type { GameEvent } from "../events.js";
import { chainItemCardId } from "../chain.js";
import { characteristicsOf, controllerOf } from "../layers.js";
import { legalActions } from "../legal.js";
import { permanentsAt } from "../state.js";
import type { Cost, GameState, Location, PlayerId } from "../state.js";

const useColor = process.env["NO_COLOR"] === undefined;

function paint(code: string, text: string): string {
  return useColor ? `[${code}m${text}[0m` : text;
}

const dim = (t: string) => paint("2", t);
const bold = (t: string) => paint("1", t);
const cyan = (t: string) => paint("36", t);
const yellow = (t: string) => paint("33", t);
const green = (t: string) => paint("32", t);

export function formatCost(cost: Cost): string {
  const parts: string[] = [];
  if (cost.energy > 0) parts.push(`${cost.energy}e`);
  for (const [domain, count] of Object.entries(cost.power)) {
    if (count !== undefined && count > 0) parts.push(`${count} ${domain}`);
  }
  if (cost.anyPower > 0) parts.push(`${cost.anyPower} any`);
  return parts.length === 0 ? "free" : parts.join(" + ");
}

function formatPool(state: GameState, playerId: PlayerId): string {
  const pool = totals(state.players[playerId].runePool);
  const parts: string[] = [];
  if (pool.energy > 0) parts.push(`${pool.energy} energy`);
  for (const [domain, count] of Object.entries(pool.power)) {
    if (count !== undefined && count > 0) parts.push(`${count} ${domain}`);
  }
  if (pool.universalPower > 0) parts.push(`${pool.universalPower} wild`);
  return parts.length === 0 ? dim("empty") : green(parts.join(", "));
}

function cardLabel(state: GameState, cardId: string): string {
  const card = state.cards[cardId];
  if (card === undefined) return cardId;

  // Read through the layers, so a copied name and a modified Might both show.
  // Off the board this returns printed values anyway (R711).
  const now = characteristicsOf(state, cardId);
  const name =
    now.name === card.name ? card.name : `${now.name} ${dim(`(as ${card.name})`)}`;

  if (now.type !== "unit") return `${name} ${dim(`[${cardId}]`)}`;

  const printed = card.might ?? 0;
  const damage = state.permanents[cardId]?.damage ?? 0;
  const base =
    now.might === printed ? `${now.might}M` : `${now.might}M (${printed})`;
  const might = damage > 0 ? yellow(`${base} -${damage}`) : dim(base);

  return `${name} ${might} ${dim(`[${cardId}]`)}`;
}

function renderPlayer(state: GameState, playerId: PlayerId): string[] {
  const player = state.players[playerId];
  const lines: string[] = [bold(playerId.toUpperCase())];

  const hand =
    player.hand.length === 0
      ? dim("(empty)")
      : player.hand.map((id) => cardLabel(state, id)).join(", ");
  lines.push(`  hand       ${hand}`);

  const inBase = permanentsAt(state, { kind: "base", player: playerId });
  const base =
    inBase.length === 0
      ? dim("(empty)")
      : inBase
          .map((permanent) => {
            const mark = permanent.exhausted ? yellow(" exhausted") : green(" ready");
            return `${cardLabel(state, permanent.cardId)}${mark}`;
          })
          .join(", ");
  lines.push(`  base       ${base}`);

  const runes =
    player.runes.length === 0
      ? dim("(none)")
      : player.runes
          .map((id) => {
            const rune = state.runes[id];
            if (rune === undefined) return id;
            const mark = rune.exhausted ? yellow("exhausted") : green("ready");
            return `${cyan(rune.domain)} ${dim(`[${id}]`)} ${mark}`;
          })
          .join("  ");
  lines.push(`  runes      ${runes}`);

  lines.push(
    `  decks      ${dim(`main ${player.mainDeck.length}, rune ${player.runeDeck.length}`)}`,
  );
  lines.push(`  pool       ${formatPool(state, playerId)}`);
  lines.push(`  points     ${bold(String(player.points))}${dim(` / ${VICTORY_SCORE}`)}`);

  return lines;
}

export function locationName(location: Location): string {
  return location.kind === "base" ? `${location.player} base` : location.id;
}

function renderBattlefields(state: GameState): string[] {
  const lines: string[] = [bold("BATTLEFIELDS")];

  for (const id of state.battlefieldOrder) {
    const battlefield = state.battlefields[id];
    if (battlefield === undefined) continue;
    const card = state.cards[id];
    const occupants = permanentsAt(state, { kind: "battlefield", id });
    const who =
      occupants.length === 0
        ? dim("(empty)")
        : occupants
            .map(
              (p) =>
                `${cardLabel(state, p.cardId)} ${dim(`(${controllerOf(state, p.cardId)})`)}`,
            )
            .join(", ");
    const status = battlefield.contestedBy !== null
      ? yellow(` contested by ${battlefield.contestedBy}`)
      : battlefield.controller === null
        ? dim(" uncontrolled")
        : green(` controlled by ${battlefield.controller}`);
    lines.push(`  ${card?.name ?? id} ${dim(`[${id}]`)}${status}`);
    lines.push(`    ${who}`);
  }

  return lines;
}

export function renderState(state: GameState): string {
  const showdown = state.showdown;
  const chainLine =
    state.chain.length === 0
      ? []
      : [
          bold("CHAIN") + dim("  (newest resolves first)"),
          ...[...state.chain].reverse().map((item, i) => {
            const id = chainItemCardId(item);
            const name = state.cards[id]?.name ?? id;
            const label = item.kind === "trigger" ? `${name} (trigger)` : name;
            const targets =
              item.targets.length === 0
                ? ""
                : dim(` → ${item.targets.join(", ")}`);
            return `  ${state.chain.length - i}. ${label} ${dim(`(${item.controller})`)}${targets}`;
          }),
          "",
        ];
  const pendingLine =
    state.pending === null
      ? []
      : [
          yellow(
            `awaiting ${state.pending.player}: ${state.pending.prompt.kind}` +
              (state.pending.prompt.kind === "mulligan"
                ? ` — set aside up to ${state.pending.prompt.max}: ` +
                  `${state.pending.prompt.legal.join(", ")}`
                : state.pending.prompt.kind === "chooseStagedBattlefield"
                ? ` — open a showdown at: ${state.pending.prompt.legal.join(", ")}`
                : state.pending.prompt.kind === "assignCombatDamage"
                ? ` — ${state.pending.prompt.remaining} Might left, ` +
                  `assign next to: ${state.pending.prompt.legal.join(", ")}`
                : state.pending.prompt.kind === "chooseTargets"
                  ? ` — legal: ${state.pending.prompt.legal.join(", ") || "(none)"}`
                      : ""),
          ),
          "",
        ];
  const header = bold(
    state.winner !== null
      ? `game over — ${state.winner} wins`
      : showdown !== null
        ? `turn ${state.turn.number}  showdown at ${showdown.battlefieldId}  focus: ${showdown.focus}`
        : state.chain.length > 0
          ? `turn ${state.turn.number}  chain up  priority: ${state.priority}`
          : `turn ${state.turn.number}  ${state.turn.player}  ${state.turn.phase} phase`,
  );
  return [
    "",
    header,
    "",
    ...pendingLine,
    ...chainLine,
    ...renderPlayer(state, "p1"),
    "",
    ...renderBattlefields(state),
    "",
    ...renderPlayer(state, "p2"),
    "",
  ].join("\n");
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
      return bold(`— turn ${event.turn}: ${event.playerId} —`);
    case "phaseBegan":
      return dim(`  ${event.phase} phase`);
    case "objectReadied":
      return `${event.playerId} readied ${event.cardId}`;
    case "poolEmptied":
      return dim(`  ${event.playerId} rune pool emptied`);
    case "unitMoved":
      return `${event.playerId} moved ${event.cardId} from ${locationName(event.from)} to ${locationName(event.to)}`;
    case "showdownOpened":
      return bold(`showdown opens at ${event.battlefieldId} — ${event.attacker} attacks and has focus`);
    case "focusPassed":
      return dim(`  ${event.playerId} passes`);
    case "showdownClosed":
      return dim(`  showdown at ${event.battlefieldId} closes`);
    case "battlefieldControlled":
      return green(`${event.playerId} takes control of ${event.battlefieldId}`);
    case "battlefieldControlLost":
      return `${event.playerId} loses control of ${event.battlefieldId}`;
    case "battlefieldScored":
      return `${event.playerId} ${event.method === "conquer" ? "conquers" : "holds"} ${event.battlefieldId}`;
    case "pointGained":
      return green(`${event.playerId} scores — now ${event.points} point${event.points === 1 ? "" : "s"}`);
    case "gameWon":
      return bold(`${event.playerId} WINS with ${event.points} points`);
    case "combatDamageDealt":
      return `combat at ${event.battlefieldId} — ${event.attacker} deals ${event.attackerMight}, defender deals ${event.defenderMight}`;
    case "unitKilled":
      return yellow(`${event.cardId} dies (${event.playerId})`);
    case "unitRecalled":
      return `${event.cardId} is recalled to ${event.playerId} base`;
    case "damageDealt":
      return `${event.cardId} takes ${event.amount} damage`;
    case "spellPlayed":
      return bold(`${event.playerId} plays ${event.cardId} — it goes on the chain`);
    case "spellResolved":
      return `${event.cardId} resolves`;
    case "spellCountered":
      return yellow(`${event.cardId} is countered`);
    case "priorityPassed":
      return dim(`  ${event.playerId} passes priority`);
    case "abilityTriggered":
      return bold(`${event.cardId} triggers — onto the chain`);
    case "triggerResolved":
      return `${event.cardId}'s trigger resolves`;
    case "decisionRequired":
      return bold(`${event.playerId} must decide: ${event.kind}`);
    case "targetsChosen":
      return `${event.playerId} targets ${event.targets.join(", ")}`;
    case "abilityDeclined":
      return dim(`  ${event.playerId} declines ${event.cardId}'s trigger`);
    case "mightModified": {
      const sign = event.amount >= 0 ? "+" : "";
      return `${event.cardId} gets ${sign}${event.amount} Might (${event.duration})`;
    }
    case "keywordGranted":
      return `${event.cardId} gains [${event.keyword}] (${event.duration})`;
    case "modifiersExpired":
      return dim(`  ${event.duration} effects expire`);
    case "effectScheduled":
      return dim(`  ${event.cardId} schedules an effect for ${event.at}`);
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
      return bold(`${event.playerId} burned out — trash recycled, opponent scores`);
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
    case "combatResolved":
      return event.winner === null
        ? `combat at ${event.battlefieldId} ends with no result`
        : bold(`${event.winner} wins the combat at ${event.battlefieldId}`);
    default: {
      const unhandled: never = event;
      return JSON.stringify(unhandled);
    }
  }
}

/** Everything the player could legally do right now, as typeable commands. */
/**
 * Everything p1 may legally do, as typeable commands. Driven by the engine's
 * own `legalActions` rather than a second guess at the rules, so the list can
 * never offer something the dispatcher would then reject.
 */
export function renderAvailableAbilities(
  state: GameState,
  playerId: PlayerId = "p1",
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  const label = (cardId: string) => state.cards[cardId]?.name ?? cardId;

  for (const action of legalActions(state, playerId)) {
    let command: string;
    let note = "";

    switch (action.type) {
      case "playUnitFromHand":
        command = `play ${action.cardId} ${locationName(
          action.destination ?? { kind: "base", player: action.playerId },
        )}${action.payOptional === true ? " +cost" : ""}`;
        note = label(action.cardId);
        break;
      case "playSpell":
        command =
          `cast ${action.cardId}` +
          (action.targets === undefined || action.targets.length === 0
            ? ""
            : ` ${action.targets.join(" ")}`) +
          (action.payOptional === true ? " +cost" : "");
        note = label(action.cardId);
        break;
      case "hide":
        command = `hide ${action.cardId} ${action.battlefieldId}`;
        note = label(action.cardId);
        break;
      case "activateAbility":
        command =
          `use ${action.sourceId} ${action.abilityIndex}` +
          (action.targets === undefined || action.targets.length === 0
            ? ""
            : ` ${action.targets.join(" ")}`);
        note = label(action.sourceId);
        break;
      case "standardMove":
        command = `move ${action.cardId} ${locationName(action.destination)}`;
        note = label(action.cardId);
        break;
      case "decide":
        command =
          action.perform === true
            ? "yes"
            : action.perform === false
              ? "no"
              : `choose ${(action.targets ?? []).join(" ") || "(keep)"}`;
        break;
      case "passPriority":
      case "passFocus":
        command = "pass";
        break;
      case "endTurn":
        command = "end";
        break;
      default:
        continue;
    }

    if (seen.has(command)) continue;
    seen.add(command);
    lines.push(`  ${command}${note === "" ? "" : `  ${dim("—")} ${note}`}`);
  }

  return lines;
}
