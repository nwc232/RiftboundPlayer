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

import { formatCost, locationName, renderEvent } from "../event-text.js";

export { formatCost, locationName, renderEvent };

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

  // R355.1 — a cost that names something is answered in the same command, so
  // two plays that differ only in what they kill have to print differently or
  // the dedup below collapses them into one typeable line.
  const paid = (costChoices: string[][] | undefined) =>
    (costChoices ?? []).map((choice) => ` pay:${choice.join(",")}`).join("");

  for (const action of legalActions(state, playerId)) {
    let command: string;
    let note = "";

    switch (action.type) {
      case "playUnitFromHand":
        command = `play ${action.cardId} ${locationName(
          action.destination ?? { kind: "base", player: action.playerId },
        )}${action.payOptional === true ? " +cost" : ""}${paid(
          action.costChoices,
        )}`;
        note = label(action.cardId);
        break;
      case "playSpell":
        command =
          `cast ${action.cardId}` +
          (action.targets === undefined || action.targets.length === 0
            ? ""
            : ` ${action.targets.join(" ")}`) +
          (action.payOptional === true ? " +cost" : "") +
          paid(action.costChoices);
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
            : ` ${action.targets.join(" ")}`) +
          paid(action.costChoices);
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
