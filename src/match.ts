import type { Deck, GameSetup } from "./deck.js";
import type { CardId } from "./state.js";

/**
 * R486 — 1v1 (Match), the second sanctioned Mode of Play.
 *
 * A Match is a sequence of Duels, and every rule it adds is about which
 * battlefield each player may present next. The engine underneath is
 * untouched: a game of a Match *is* a game of a Duel (R486.1–.3 repeat R485's
 * two players and Victory Score of 8), so this file never reaches into
 * `GameState`. It holds the bookkeeping between games and hands back a
 * `GameSetup`.
 *
 * Everything derivable is derived rather than stored — which battlefields are
 * removed, how many wins each player has — so the record of games played is
 * the single source of truth and cannot drift from its own summary.
 */

/** R486.6 / R486.6.a — a Match is best of three, or best of five. */
export type BestOf = 3 | 5;

/**
 * R486.1 — "2 Players". A Match is a 1v1 mode by definition, so its records
 * are keyed by the two seats a Duel uses rather than by every seat the engine
 * can hold. A three-player Match is not a thing the rules describe.
 */
export type DuelSeat = "p1" | "p2";

export interface GameRecord {
  /** The battlefield each player presented for that game (R486.5). */
  presented: Record<DuelSeat, CardId>;
  /**
   * R486.5.a — `null` is a real outcome, not a missing one: "If no player won
   * a game, the battlefields presented for that game may be reused." Our
   * engine always produces a winner, but the Match rules do not assume it.
   */
  winner: DuelSeat | null;
}

export interface MatchState {
  bestOf: BestOf;
  /** R486.4.a — the three each player brought, in deck order. */
  pools: Record<DuelSeat, CardId[]>;
  /** Completed games, oldest first. */
  games: GameRecord[];
}

export type PresentError =
  | "matchOver"
  | "notInPool"
  | "removedFromMatch"
  | "notYetPresentedAll"
  | "presentedTwice";

const PLAYERS: readonly DuelSeat[] = ["p1", "p2"];

export function startMatch(
  decks: Record<DuelSeat, Deck>,
  bestOf: BestOf = 3,
): MatchState {
  return {
    bestOf,
    pools: { p1: [...decks.p1.battlefields], p2: [...decks.p2.battlefields] },
    games: [],
  };
}

/** R486.6 — two game wins takes a best of three; three takes a best of five. */
export function winsNeeded(match: MatchState): number {
  return match.bestOf === 3 ? 2 : 3;
}

export function gameWins(match: MatchState, player: DuelSeat): number {
  return match.games.filter((game) => game.winner === player).length;
}

/** The player who has taken the Match, or `null` while it is still on. */
export function matchWinner(match: MatchState): DuelSeat | null {
  const needed = winsNeeded(match);
  return PLAYERS.find((player) => gameWins(match, player) >= needed) ?? null;
}

/**
 * R486.5 — "if a player won, the Battlefields that were used are to be removed
 * and not selected again for this Match". Both battlefields go, not just the
 * winner's: the rule is about the pair that were in play. R486.5.a exempts a
 * game nobody won.
 */
export function removedFrom(match: MatchState, player: DuelSeat): CardId[] {
  return match.games
    .filter((game) => game.winner !== null)
    .map((game) => game.presented[player]);
}

function timesPresented(
  match: MatchState,
  player: DuelSeat,
  battlefield: CardId,
): number {
  return match.games.filter((game) => game.presented[player] === battlefield)
    .length;
}

/**
 * R486.6.a.1 — the gate on reusing a removed battlefield: "Players may only
 * re-use a battlefield in this way if they have already presented each of
 * their battlefields at least once during the match."
 */
function hasPresentedAll(match: MatchState, player: DuelSeat): boolean {
  return match.pools[player].every(
    (battlefield) => timesPresented(match, player, battlefield) > 0,
  );
}

/**
 * R486.6.a — reuse is a best-of-five affair, and only in games 4 and 5.
 * `match.games.length` is how many are already finished, so three finished
 * games means the next one is the fourth.
 */
function mayReuse(match: MatchState, player: DuelSeat): boolean {
  return (
    match.bestOf === 5 && match.games.length >= 3 && hasPresentedAll(match, player)
  );
}

/**
 * What `player` may present for the next game. Empty means the Match is over —
 * in a legal best of three it never empties while games remain, because three
 * battlefields cover three games.
 */
export function legalBattlefields(
  match: MatchState,
  player: DuelSeat,
): CardId[] {
  if (matchWinner(match) !== null) return [];

  const removed = new Set(removedFrom(match, player));
  const fresh = match.pools[player].filter(
    (battlefield) => !removed.has(battlefield),
  );
  if (!mayReuse(match, player)) return fresh;

  // R486.6.a.2 — "Players may not present a battlefield more than twice in a
  // match when re-using battlefields in this way."
  return match.pools[player].filter(
    (battlefield) => timesPresented(match, player, battlefield) < 2,
  );
}

/** Why `battlefield` may not be presented, or `undefined` if it may. */
export function checkPresent(
  match: MatchState,
  player: DuelSeat,
  battlefield: CardId,
): PresentError | undefined {
  if (matchWinner(match) !== null) return "matchOver";
  if (!match.pools[player].includes(battlefield)) return "notInPool";
  if (legalBattlefields(match, player).includes(battlefield)) return undefined;

  // Past this point it is in the pool but not offered, so it has been removed
  // (R486.5). Which of the two reuse conditions blocked it is worth saying
  // apart, because they fail for opposite reasons.
  if (match.bestOf === 3 || match.games.length < 3) return "removedFromMatch";
  if (!hasPresentedAll(match, player)) return "notYetPresentedAll";
  return "presentedTwice";
}

export type SetupOutcome =
  | { ok: true; setup: GameSetup; match: MatchState }
  | { ok: false; errors: Partial<Record<DuelSeat, PresentError>> };

/**
 * Presents both battlefields and builds the next game's `GameSetup` from a
 * base holding the decks and cards — the same object `matchup()` returns, with
 * its seats' battlefields replaced.
 *
 * R486 gives no First Turn Process beyond R485.7's extra rune for the player
 * going second, and says nothing about who goes first in later games, so
 * R115's "any fair random method" stands and the caller decides. Passing it
 * in also keeps a Match reproducible, which the whole engine is built for.
 *
 * The returned `match` is unchanged apart from nothing — a game is recorded
 * when it *ends*, by `recordGame`, since its winner is what R486.5 turns on.
 */
export function setupFor(
  match: MatchState,
  base: GameSetup,
  presented: Record<DuelSeat, CardId>,
  startingPlayer: DuelSeat = "p1",
): SetupOutcome {
  const errors: Partial<Record<DuelSeat, PresentError>> = {};
  for (const player of PLAYERS) {
    const error = checkPresent(match, player, presented[player]);
    if (error !== undefined) errors[player] = error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    match,
    setup: {
      ...base,
      // R115.1 — index 0 is the First Player, so choosing who starts is
      // choosing the rotation. R486 adds no First Turn Process of its own
      // beyond R485.7's extra rune, which keys off going last.
      turnOrder: startingPlayer === "p1" ? ["p1", "p2"] : ["p2", "p1"],
      seats: {
        p1: { ...base.seats.p1!, battlefield: presented.p1 },
        p2: { ...base.seats.p2!, battlefield: presented.p2 },
      },
    },
  };
}

/**
 * R486.6 — the game is over, so it joins the record. Everything the next game
 * needs (what is removed, who is ahead, whether the Match is done) is read
 * back off this list.
 */
export function recordGame(
  match: MatchState,
  presented: Record<DuelSeat, CardId>,
  winner: DuelSeat | null,
): MatchState {
  return { ...match, games: [...match.games, { presented, winner }] };
}
