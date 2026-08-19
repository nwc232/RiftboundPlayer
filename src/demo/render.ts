import { totals } from "../cost.js";
import { VICTORY_SCORE } from "../scoring.js";
import type { GameEvent } from "../events.js";
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
  if (card.type !== "unit") return `${card.name} ${dim(`[${cardId}]`)}`;

  const damage = state.permanents[cardId]?.damage ?? 0;
  const might =
    damage > 0
      ? yellow(`${card.might ?? 0}M -${damage}`)
      : dim(`${card.might ?? 0}M`);
  return `${card.name} ${might} ${dim(`[${cardId}]`)}`;
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
            .map((p) => `${cardLabel(state, p.cardId)} ${dim(`(${p.controller})`)}`)
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
            const name = state.cards[item.cardId]?.name ?? item.cardId;
            const targets =
              item.targets.length === 0
                ? ""
                : dim(` → ${item.targets.join(", ")}`);
            return `  ${state.chain.length - i}. ${name} ${dim(`(${item.controller})`)}${targets}`;
          }),
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
    default: {
      const unhandled: never = event;
      return JSON.stringify(unhandled);
    }
  }
}

/** Everything the player could legally do right now, as typeable commands. */
export function renderAvailableAbilities(state: GameState): string[] {
  const player = state.players.p1;
  const lines: string[] = [];

  const sources = [
    ...player.runes,
    ...permanentsAt(state, { kind: "base", player: "p1" }).map((p) => p.cardId),
  ];
  for (const sourceId of sources) {
    const card = state.cards[sourceId];
    if (card === undefined) continue;
    card.abilities.forEach((ability, index) => {
      const effect =
        ability.effect.op === "addEnergy"
          ? `add ${ability.effect.amount} energy`
          : ability.effect.op === "addPower"
            ? `add ${ability.effect.amount} ${ability.effect.domain === "selfDomain" ? card.domain : ability.effect.domain} power`
            : ability.effect.op;
      const costs = ability.costs.map((c) => c.kind).join(" + ");
      lines.push(
        `  use ${sourceId} ${index}  ${dim("—")} ${card.name}: ${costs} → ${effect}`,
      );
    });
  }

  return lines;
}
