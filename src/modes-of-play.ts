import type { PlayerId } from "./state.js";
import { SEATS } from "./state.js";

/**
 * R481–489 — the Modes of Play.
 *
 * R483 lists what a mode must define, and this is that list with the parts the
 * engine can act on. The parts it cannot are deliberately absent: R483.5's
 * Setup and R483.4.a's deckbuilding implications belong to whatever seats the
 * players, and "best of 1" versus "best of 3" is `match.ts`'s business rather
 * than a game's.
 *
 * 2v2 (R489) is not here. It is fully specified — R489.8.a–i leaves nothing
 * open — but teams touch scoring, targeting, priority and movement, and none
 * of that is built. See ROADMAP §6e.
 */
export type ModeId = "duel" | "skirmish" | "war";

export interface ModeOfPlay {
  id: ModeId;
  /** The name the rules give it, for anything that shows one. */
  name: string;
  /** R483.1 — how many people are playing. */
  players: number;
  /** R483.3 — the point total a player must reach to win. */
  victoryScore: number;
  /** R483.4 — how many battlefields are in play. */
  battlefields: number;
  /**
   * R488.4.b — "The player who is taking the first turn removes their
   * Battlefields." True for every mode but War, where four players would
   * otherwise put four battlefields on a three-battlefield table.
   */
  firstPlayerPresentsBattlefield: boolean;
  /**
   * R487.7 / R488.7 — "The player going first does not draw a card during
   * their first Draw Phase of the game." R485.7's Duel has no such clause:
   * with two players, going first is worth less.
   */
  firstPlayerSkipsFirstDraw: boolean;
}

export const DUEL: ModeOfPlay = {
  id: "duel",
  name: "1v1 (Duel)",
  players: 2,
  victoryScore: 8,
  battlefields: 2,
  firstPlayerPresentsBattlefield: true,
  firstPlayerSkipsFirstDraw: false,
};

export const SKIRMISH: ModeOfPlay = {
  id: "skirmish",
  name: "FFA3 (Skirmish)",
  players: 3,
  victoryScore: 8,
  battlefields: 3,
  firstPlayerPresentsBattlefield: true,
  firstPlayerSkipsFirstDraw: true,
};

export const WAR: ModeOfPlay = {
  id: "war",
  name: "FFA4 (War)",
  players: 4,
  victoryScore: 8,
  battlefields: 3,
  // R488.4.b — four players, three battlefields, so the first player brings
  // none. R488.5 has everyone else present one of their three.
  firstPlayerPresentsBattlefield: false,
  firstPlayerSkipsFirstDraw: true,
};

export const MODES: readonly ModeOfPlay[] = [DUEL, SKIRMISH, WAR];

export function modeById(id: ModeId): ModeOfPlay {
  const found = MODES.find((mode) => mode.id === id);
  if (found === undefined) throw new Error(`no mode ${id}`);
  return found;
}

/**
 * The mode that seats this many players. R485 and R486 both seat two and agree
 * on everything a *game* cares about — R486's differences are all between
 * games — so a Match's games are Duels here.
 */
export function modeFor(players: number): ModeOfPlay {
  const found = MODES.find((mode) => mode.players === players);
  if (found === undefined) {
    throw new Error(`no sanctioned mode seats ${players} players`);
  }
  return found;
}

/** R115.1 — the seats a mode uses, in turn order, before it is shuffled. */
export function seatsFor(mode: ModeOfPlay): PlayerId[] {
  return SEATS.slice(0, mode.players);
}
