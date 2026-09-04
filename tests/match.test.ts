import { describe, expect, it } from "vitest";
import { startGame } from "../src/deck.js";
import type { Deck } from "../src/deck.js";
import { DECK_LISTS, instantiate, matchup } from "../src/decks/index.js";
import {
  checkPresent,
  gameWins,
  legalBattlefields,
  matchWinner,
  recordGame,
  setupFor,
  startMatch,
  winsNeeded,
} from "../src/match.js";
import type { MatchState } from "../src/match.js";
import type { CardId, PlayerId } from "../src/state.js";

const DECKS: Record<PlayerId, Deck> = {
  p1: instantiate(DECK_LISTS[0]!, "p1").deck,
  p2: instantiate(DECK_LISTS[1]!, "p2").deck,
};

/** Plays one game of the match on paper: both present, `winner` takes it. */
function playGame(
  match: MatchState,
  choices: [number, number],
  winner: PlayerId | null,
): MatchState {
  const presented = {
    p1: legalBattlefields(match, "p1")[choices[0]]!,
    p2: legalBattlefields(match, "p2")[choices[1]]!,
  };
  return recordGame(match, presented, winner);
}

describe("R486 — 1v1 (Match)", () => {
  it("starts with each player's three battlefields available (R486.4.a)", () => {
    const match = startMatch(DECKS);

    expect(legalBattlefields(match, "p1")).toEqual(DECKS.p1.battlefields);
    expect(legalBattlefields(match, "p2")).toEqual(DECKS.p2.battlefields);
    expect(winsNeeded(match)).toBe(2);
    expect(matchWinner(match)).toBeNull();
  });

  /**
   * R486.5 — "if a player won, the Battlefields that were used are to be
   * removed". Both of them: the rule is about the pair that were in play, not
   * about the winner's alone. The loser's battlefield is the interesting half.
   */
  it("removes both battlefields after a game someone won (R486.5)", () => {
    const start = startMatch(DECKS);
    const used = { p1: DECKS.p1.battlefields[0]!, p2: DECKS.p2.battlefields[0]! };
    const after = recordGame(start, used, "p1");

    expect(legalBattlefields(after, "p1")).not.toContain(used.p1);
    expect(legalBattlefields(after, "p2")).not.toContain(used.p2);
    expect(legalBattlefields(after, "p1")).toHaveLength(2);
    expect(legalBattlefields(after, "p2")).toHaveLength(2);
    expect(checkPresent(after, "p1", used.p1)).toBe("removedFromMatch");
  });

  /** R486.5.a — a game nobody won leaves both battlefields available. */
  it("keeps both battlefields after a game nobody won (R486.5.a)", () => {
    const start = startMatch(DECKS);
    const used = { p1: DECKS.p1.battlefields[0]!, p2: DECKS.p2.battlefields[0]! };
    const after = recordGame(start, used, null);

    expect(legalBattlefields(after, "p1")).toEqual(DECKS.p1.battlefields);
    expect(legalBattlefields(after, "p2")).toEqual(DECKS.p2.battlefields);
  });

  it("is won by the first to two game wins (R486.6)", () => {
    let match = startMatch(DECKS);
    match = playGame(match, [0, 0], "p1");
    expect(matchWinner(match)).toBeNull();

    match = playGame(match, [0, 0], "p2");
    expect(matchWinner(match)).toBeNull();

    match = playGame(match, [0, 0], "p1");
    expect(gameWins(match, "p1")).toBe(2);
    expect(matchWinner(match)).toBe("p1");
    expect(legalBattlefields(match, "p1")).toEqual([]);
    expect(checkPresent(match, "p1", DECKS.p1.battlefields[0]!)).toBe("matchOver");
  });

  /**
   * Three battlefields cover three games exactly, which is why R486.4.a asks
   * for three. A best of three can never run a player out of them.
   */
  it("always leaves a legal battlefield while a best of three is live", () => {
    let match = startMatch(DECKS);
    for (const winner of ["p1", "p2", "p1"] as PlayerId[]) {
      expect(legalBattlefields(match, "p1").length).toBeGreaterThan(0);
      expect(legalBattlefields(match, "p2").length).toBeGreaterThan(0);
      match = playGame(match, [0, 0], winner);
    }
    expect(matchWinner(match)).toBe("p1");
  });

  it("never lets a battlefield outside the pool be presented", () => {
    const match = startMatch(DECKS);

    expect(checkPresent(match, "p1", "not-a-battlefield" as CardId)).toBe(
      "notInPool",
    );
    // R103.4 keeps the pools disjoint, so the opponent's is out of the pool too.
    expect(checkPresent(match, "p1", DECKS.p2.battlefields[0]!)).toBe("notInPool");
  });
});

describe("R486.6.a — best of five", () => {
  it("needs three game wins", () => {
    const match = startMatch(DECKS, 5);

    expect(winsNeeded(match)).toBe(3);
  });

  /**
   * R486.6.a — after three decisive games every battlefield is removed, and
   * games 4 and 5 may reuse one. R486.6.a.1's gate is satisfied by exactly
   * that: each has been presented once.
   */
  it("reopens removed battlefields for games 4 and 5 (R486.6.a)", () => {
    let match = startMatch(DECKS, 5);
    match = playGame(match, [0, 0], "p1");
    match = playGame(match, [0, 0], "p2");
    // Two decisive games in, reuse is not open yet — this is game 3.
    expect(legalBattlefields(match, "p1")).toHaveLength(1);

    match = playGame(match, [0, 0], "p1");
    expect(matchWinner(match)).toBeNull();
    expect(legalBattlefields(match, "p1")).toEqual(DECKS.p1.battlefields);
  });

  /**
   * R486.6.a.1 — the gate is "presented each of their battlefields at least
   * once", which a drawn game can leave unsatisfied at game 4: two of the
   * three have been presented and one has not, so the untouched one is the
   * only legal choice.
   */
  it("withholds reuse until every battlefield has been presented (R486.6.a.1)", () => {
    const [first, second, third] = DECKS.p1.battlefields as [
      CardId,
      CardId,
      CardId,
    ];
    let match = startMatch(DECKS, 5);
    const theirs = DECKS.p2.battlefields as [CardId, CardId, CardId];

    match = recordGame(match, { p1: first, p2: theirs[0] }, "p1");
    match = recordGame(match, { p1: second, p2: theirs[1] }, null);
    match = recordGame(match, { p1: second, p2: theirs[1] }, "p2");

    // Game 4: `third` has never been presented, so R486.6.a.1 blocks reuse.
    expect(legalBattlefields(match, "p1")).toEqual([third]);
    expect(checkPresent(match, "p1", first)).toBe("notYetPresentedAll");
  });

  /** R486.6.a.2 — twice in a match is the ceiling. */
  it("refuses a third presentation of the same battlefield (R486.6.a.2)", () => {
    const [first, second, third] = DECKS.p1.battlefields as [
      CardId,
      CardId,
      CardId,
    ];
    const theirs = DECKS.p2.battlefields as [CardId, CardId, CardId];
    let match = startMatch(DECKS, 5);

    match = recordGame(match, { p1: first, p2: theirs[0] }, "p1");
    match = recordGame(match, { p1: second, p2: theirs[1] }, "p2");
    match = recordGame(match, { p1: third, p2: theirs[2] }, "p1");
    // Game 4 reuses `first`, taking it to two.
    match = recordGame(match, { p1: first, p2: theirs[0] }, "p2");

    expect(checkPresent(match, "p1", first)).toBe("presentedTwice");
    expect(legalBattlefields(match, "p1")).toEqual([second, third]);
  });
});

describe("a Match's games are real games", () => {
  /**
   * The point of the layer: a game of a Match is a game of a Duel. R486.1–.3
   * repeat R485's two players and Victory Score of 8, so the setup this
   * produces has to start like any other.
   */
  it("builds a startable GameSetup for each game", () => {
    const base = matchup();
    let match = startMatch(DECKS);

    for (const winner of ["p1", "p2"] as PlayerId[]) {
      const presented = {
        p1: legalBattlefields(match, "p1")[0]!,
        p2: legalBattlefields(match, "p2")[0]!,
      };
      const outcome = setupFor(match, base, presented, winner);
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.errors));

      const started = startGame(outcome.setup);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(started.state.battlefieldOrder).toEqual([presented.p1, presented.p2]);
      // R485.7 / R486.7 — the extra rune keys off who goes second.
      expect(started.state.startingPlayer).toBe(winner);

      match = recordGame(match, presented, winner);
    }

    expect(matchWinner(match)).toBeNull();
  });

  it("refuses to set up a game with an illegal presentation", () => {
    const base = matchup();
    const used = { p1: DECKS.p1.battlefields[0]!, p2: DECKS.p2.battlefields[0]! };
    const match = recordGame(startMatch(DECKS), used, "p1");

    const outcome = setupFor(match, base, used);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors).toEqual({
      p1: "removedFromMatch",
      p2: "removedFromMatch",
    });
  });
});
