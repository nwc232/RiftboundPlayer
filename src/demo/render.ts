import { totals } from "../cost.js";
import type { GameEvent } from "../events.js";
import type { Cost, GameState, PlayerId } from "../state.js";

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
  const cost = card.type === "unit" ? dim(` (${formatCost(card.cost)})`) : "";
  return `${card.name}${cost} ${dim(`[${cardId}]`)}`;
}

function renderPlayer(state: GameState, playerId: PlayerId): string[] {
  const player = state.players[playerId];
  const lines: string[] = [bold(playerId.toUpperCase())];

  const hand =
    player.hand.length === 0
      ? dim("(empty)")
      : player.hand.map((id) => cardLabel(state, id)).join(", ");
  lines.push(`  hand       ${hand}`);

  const base =
    player.base.length === 0
      ? dim("(empty)")
      : player.base
          .map((id) => {
            const exhausted = state.permanents[id]?.exhausted ?? false;
            const mark = exhausted ? yellow(" exhausted") : green(" ready");
            return `${cardLabel(state, id)}${mark}`;
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

  return lines;
}

export function renderState(state: GameState): string {
  const header = bold(
    `turn ${state.turn.number}  ${state.turn.player}  ${state.turn.phase} phase`,
  );
  return [
    "",
    header,
    "",
    ...renderPlayer(state, "p1"),
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

  for (const sourceId of [...player.runes, ...player.base]) {
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
