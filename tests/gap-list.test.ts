import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import { detach, discard, forEachPlayer, raiseVictoryScore } from "../src/builders.js";
import type { Effect, EffectContext, EffectOutcome } from "../src/abilities.js";
import { holds } from "../src/conditions.js";
import { checkForWinner, victoryScore } from "../src/scoring.js";
import { seatOf } from "../src/state.js";
import type { GameState } from "../src/state.js";
import { makeState, unit } from "./fixtures.js";

const context = { controller: "p1" as const, sourceId: "src", targets: [] };

/**
 * R194.3.a — "Some game modes or card effects may alter the Victory Score."
 * The mode sets the number and Aspirant's Climb moves it: "Increase the points
 * needed to win the game by 1."
 */
describe("R194.3.a — a card moves the finish line", () => {
  it("raises the score the game is played to", () => {
    const before = makeState({});
    expect(victoryScore(before)).toBe(8);

    const { state } = execute(before, raiseVictoryScore(1), context);

    expect(victoryScore(state)).toBe(9);
  });

  /** The point of it: a player on 8 has not won a game played to 9. */
  it("moves what it takes to win with it", () => {
    const onEight = makeState({ p1: { points: 8 }, p2: { points: 0 } });
    expect(checkForWinner(onEight).state.winner).toBe("p1");

    const { state } = execute(onEight, raiseVictoryScore(1), context);

    expect(checkForWinner(state).state.winner).toBeNull();
  });
});

/**
 * R194.3 — "within X points of the Victory Score", which five cards read to
 * decide whether the game is nearly over.
 */
describe("R194.3 — how close the game is", () => {
  const at = (mine: number, theirs: number): GameState =>
    makeState({ p1: { points: mine }, p2: { points: theirs } });

  it("reads the controller's own score", () => {
    const near = { kind: "nearVictory", who: "you", within: 3 } as const;

    expect(holds(at(5, 0), near, context)).toBe(true);
    expect(holds(at(4, 0), near, context)).toBe(false);
  });

  it("reads whether any opponent is close", () => {
    const near = { kind: "nearVictory", who: "anyOpponent", within: 3 } as const;

    expect(holds(at(0, 5), near, context)).toBe(true);
    expect(holds(at(7, 4), near, context)).toBe(false);
  });

  /** It is measured against the *current* score, which a card can move. */
  it("follows the Victory Score when a card raises it", () => {
    const near = { kind: "nearVictory", who: "you", within: 3 } as const;
    const close = at(5, 0);
    expect(holds(close, near, context)).toBe(true);

    const { state } = execute(close, raiseVictoryScore(2), context);

    expect(holds(state, near, context)).toBe(false);
  });
});

/**
 * R716 — the inverse of attaching. Angle Shot detaches an Equipment; Strike
 * Down and Veiled Temple detach one they have just used.
 */
describe("R716 — detaching an Equipment", () => {
  const NORTH = { kind: "battlefield" as const, id: "bf-north" };

  function equipped(): GameState {
    return makeState({
      cards: [unit("hero", { might: 2 }), { ...unit("blade"), type: "gear" as const }],
      permanents: [
        { cardId: "hero", controller: "p1", location: NORTH },
        { cardId: "blade", controller: "p1", location: NORTH, attachedTo: "hero" },
      ],
      battlefields: ["bf-north"],
    });
  }

  it("takes the Equipment off its unit", () => {
    const { state, events } = execute(equipped(), detach(0), {
      ...context,
      targets: ["blade"],
    });

    expect(state.permanents["blade"]?.attachedTo).toBeUndefined();
    // R456 — the unit is untouched; only the attachment ended.
    expect(state.permanents["hero"]?.location).toEqual(NORTH);
    expect(events).toContainEqual({
      type: "detached",
      playerId: "p1",
      cardId: "blade",
      fromCardId: "hero",
    });
  });

  it("does nothing to a gear that was not attached", () => {
    const loose = equipped();
    const { attachedTo: _none, ...bare } = loose.permanents["blade"]!;
    const before: GameState = {
      ...loose,
      permanents: { ...loose.permanents, blade: bare },
    };

    const { state, events } = execute(before, detach(0), {
      ...context,
      targets: ["blade"],
    });

    expect(state).toBe(before);
    expect(events).toEqual([]);
  });

  /**
   * R149.3 then takes it home, because an unattached non-Unit gear does not
   * belong at a battlefield — the two rules meet here.
   */
  it("leaves it for the cleanup to recall", () => {
    const { state } = execute(equipped(), detach(0), {
      ...context,
      targets: ["blade"],
    });

    expect(state.permanents["blade"]?.location).toEqual(NORTH);
    expect(seatOf(state, "p1").banished).toEqual([]);
  });
});

/**
 * R303.2.a — "Turn Order is referenced to organize the sequence of actions."
 *
 * Four cards open "Starting with the next player, each other player chooses…"
 * — King's Edict, Party Favors, Promising Future and Whirlwind. Until now an
 * "each player" step that asked a question stranded everyone after it, which
 * was written up as a deviation; this is that deviation closed.
 */
describe("R303.2.a — each player, in turn, asked in turn", () => {
  function table(): GameState {
    return makeState({
      p1: { hand: ["p1a", "p1b"] },
      p2: { hand: ["p2a", "p2b"] },
      p3: { hand: ["p3a", "p3b"] },
      cards: ["p1a", "p1b", "p2a", "p2b", "p3a", "p3b"].map((id) => unit(id)),
    });
  }

  /** Discarding asks which card, so this is the shape that used to strand. */
  const eachDiscards = forEachPlayer(discard(1, 0), "each");

  it("asks the first player and holds the rest for after", () => {
    const outcome = execute(table(), eachDiscards, context);

    expect(outcome.pause).toBeDefined();
    // The controller goes first — R303.2.a sequences from them.
    expect(outcome.pause?.decision.player).toBe("p1");
  });

  /**
   * The whole point: answering carries on down the table rather than stopping.
   * Every player discards, each choosing for themselves.
   */
  it("carries on through everyone as each one answers", () => {
    let state = table();
    let effect: Effect | null = eachDiscards;
    let ctx = context as EffectContext;
    const asked: string[] = [];

    for (let step = 0; step < 6 && effect !== null; step += 1) {
      const outcome: EffectOutcome = execute(state, effect, ctx);
      state = outcome.state;
      if (outcome.pause === undefined) {
        effect = null;
        break;
      }
      const who = outcome.pause.decision.player;
      asked.push(who);
      // Answer with that player's own first card, as the prompt offered.
      const legal =
        "legal" in outcome.pause.decision.prompt
          ? outcome.pause.decision.prompt.legal
          : [];
      effect = outcome.pause.resume;
      ctx = { ...outcome.pause.context, answer: [String(legal[0])] };
    }

    expect(asked).toEqual(["p1", "p2", "p3"]);
    // Each discarded one of their own, and nobody was skipped.
    for (const id of ["p1", "p2", "p3"] as const) {
      expect(seatOf(state, id).hand).toHaveLength(1);
      expect(seatOf(state, id).trash).toHaveLength(1);
    }
  });

  /** "each *other* player" skips the controller, and still asks the rest. */
  it("skips the controller for eachOpponent", () => {
    const outcome = execute(
      table(),
      forEachPlayer(discard(1, 0), "eachOpponent"),
      context,
    );

    expect(outcome.pause?.decision.player).toBe("p2");
  });
});

/**
 * A whole class of effects silently did nothing to a third or fourth player.
 *
 * `PlayerId` is structurally a `CardId` — that is what lets a card target a
 * player — so effects that read a target back had to narrow it, and did so as
 * `id !== "p1" && id !== "p2"`. When the seats widened, those stopped being
 * narrowings and became two-player restrictions: a comparison rather than a
 * type, so nothing in the compiler could say a word about it. Eight of them.
 */
describe("effects reach every seat, not just the first two", () => {
  function table(): GameState {
    return makeState({
      p1: { hand: ["p1a", "p1b"] },
      p2: { hand: ["p2a", "p2b"] },
      p3: { hand: ["p3a", "p3b"] },
      p4: { hand: ["p4a", "p4b"] },
      cards: ["p1a", "p1b", "p2a", "p2b", "p3a", "p3b", "p4a", "p4b"].map(
        (id) => unit(id),
      ),
    });
  }

  it.each(["p1", "p2", "p3", "p4"] as const)(
    "asks %s to discard when the effect names them",
    (who) => {
      const outcome = execute(table(), discard(1, 0), {
        ...context,
        targets: [who],
      });

      expect(outcome.pause?.decision.player).toBe(who);
    },
  );

  /** And an id that names nobody is still ignored, which is the original point. */
  it("ignores a target that is not a player at all", () => {
    const outcome = execute(table(), discard(1, 0), {
      ...context,
      targets: ["p1a"],
    });

    expect(outcome.pause).toBeUndefined();
    expect(outcome.events).toEqual([]);
  });
});
