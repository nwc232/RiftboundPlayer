import { describe, expect, it } from "vitest";
import { execute } from "../src/abilities.js";
import type { EffectContext } from "../src/abilities.js";
import { predict, seq, draw } from "../src/builders.js";
import { abilitiesOf } from "../src/layers.js";
import { legalActions } from "../src/legal.js";
import { applyAction } from "../src/actions.js";
import { seatOf } from "../src/state.js";
import type { GameState } from "../src/state.js";
import type { Action } from "../src/actions.js";
import { makeState, pool, unit } from "./fixtures.js";

const context = (): EffectContext => ({
  controller: "p1",
  sourceId: "source",
  targets: [],
});

function deckBoard(top: string[] = ["a", "b", "c", "d"]): GameState {
  return makeState({
    p1: { mainDeck: top },
    cards: top.map((id) => unit(id)),
  });
}

/** R436 — "look at a single card from the top … and choose whether to Recycle it." */
describe("predicting (R436)", () => {
  it("asks even about a single card, because keeping it is a choice", () => {
    const after = execute(deckBoard(), predict(1), context());

    expect(after.pause?.decision).toEqual({
      player: "p1",
      prompt: { kind: "predict", legal: ["a"] },
    });
    // Nothing has moved while the question is outstanding.
    expect(seatOf(after.state, "p1").mainDeck).toEqual(["a", "b", "c", "d"]);
  });

  it("recycles what was chosen to the bottom (R416.1)", () => {
    const paused = execute(deckBoard(), predict(1), context());
    const done = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: ["a"],
    });

    expect(seatOf(done.state, "p1").mainDeck).toEqual(["b", "c", "d", "a"]);
    expect(done.events).toEqual([
      { type: "cardRecycled", playerId: "p1", cardId: "a" },
    ]);
  });

  /** R436.1 — "any number" includes none, and the card stays where it was. */
  it("leaves the deck alone when nothing is recycled", () => {
    const paused = execute(deckBoard(), predict(1), context());
    const done = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: [],
    });

    expect(seatOf(done.state, "p1").mainDeck).toEqual(["a", "b", "c", "d"]);
    expect(done.events).toEqual([]);
  });

  /**
   * R436.1.a — with more than one card kept, where they sit relative to each
   * other is a second decision, so the resumed effect stops and asks again.
   */
  it("asks a second time for the order the kept cards go back in", () => {
    const paused = execute(deckBoard(), predict(3), context());
    expect(paused.pause?.decision.prompt).toEqual({
      kind: "predict",
      legal: ["a", "b", "c"],
    });

    const recycled = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: ["b"],
    });

    expect(recycled.pause?.decision.prompt).toEqual({
      kind: "orderPredicted",
      legal: ["a", "c"],
    });
    // "b" is already on the bottom; the kept two sit on top in revealed order
    // until the answer moves them.
    expect(seatOf(recycled.state, "p1").mainDeck).toEqual(["a", "c", "d", "b"]);

    const ordered = execute(recycled.state, recycled.pause!.resume, {
      ...recycled.pause!.context,
      answer: ["c", "a"],
    });
    expect(seatOf(ordered.state, "p1").mainDeck).toEqual(["c", "a", "d", "b"]);
  });

  it("does not ask about order when one card or none is kept", () => {
    const paused = execute(deckBoard(), predict(2), context());
    const done = execute(paused.state, paused.pause!.resume, {
      ...paused.pause!.context,
      answer: ["a"],
    });

    expect(done.pause).toBeUndefined();
    expect(seatOf(done.state, "p1").mainDeck).toEqual(["b", "c", "d", "a"]);
  });

  /**
   * R436.4 — "Predict as many as possible instead", and R436.4.a: never a Burn
   * Out, which is why this does not route through `drawCards`.
   */
  it("predicts as many as are there, and never burns out", () => {
    const after = execute(deckBoard(["a"]), predict(3), context());

    expect(after.pause?.decision.prompt).toEqual({
      kind: "predict",
      legal: ["a"],
    });
    expect(seatOf(after.state, "p1").points).toBe(0);
    expect(seatOf(after.state, "p2").points).toBe(0);
  });

  it("does nothing on an empty deck", () => {
    const after = execute(deckBoard([]), predict(1), context());

    expect(after.pause).toBeUndefined();
    expect(after.events).toEqual([]);
  });

  /** The resumable-`execute` guarantee: a later step waits for the answer. */
  it("carries the rest of a sequence past the question", () => {
    const after = execute(deckBoard(), seq(predict(1), draw(1)), context());

    expect(seatOf(after.state, "p1").hand).toEqual([]);
    expect(after.pause?.resume).toEqual({
      op: "seq",
      steps: [
        { op: "takePredicted", revealed: ["a"] },
        { op: "draw", count: 1 },
      ],
    });
  });
});

/** R817 — "[Vision] (When you play this, Predict 1.)" */
describe("[Vision] (R817)", () => {
  it("expands into a play trigger rather than being written out", () => {
    const state = makeState({
      cards: [unit("seer", { keywords: ["vision"] })],
      permanents: [{ cardId: "seer", controller: "p1" }],
    });

    expect(abilitiesOf(state, "seer")).toEqual([
      {
        kind: "triggered",
        trigger: { on: "unitPlayed", subject: "self" },
        effect: { op: "predict", count: 1 },
      },
    ]);
  });
});

/**
 * The lesson from the CLI playthrough: a unit test that hands an effect its
 * answers can pass while the move is undiscoverable in a real game. This plays
 * the card and lets the engine find its own way to the question.
 */
describe("playing a [Vision] permanent", () => {
  const PLAY: Action = {
    type: "playUnitFromHand",
    playerId: "p1",
    cardId: "seer",
  };

  function board(): GameState {
    return makeState({
      p1: {
        hand: ["seer"],
        mainDeck: ["a", "b"],
        runePool: pool({ energy: 5 }),
      },
      cards: [
        unit("seer", { might: 1, keywords: ["vision"] }),
        unit("a"),
        unit("b"),
      ],
    });
  }

  it("triggers, resolves, and asks about the top card", () => {
    const played = applyAction(board(), PLAY);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    // R383 — the trigger goes on the chain and resolves once both pass.
    let state = played.state;
    for (const action of [
      { type: "passPriority", playerId: "p1" },
      { type: "passPriority", playerId: "p2" },
    ] as Action[]) {
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    expect(state.pending).toEqual({
      player: "p1",
      prompt: { kind: "predict", legal: ["a"] },
    });

    // And the answer is reachable without the test knowing the protocol.
    const recycle = legalActions(state, "p1").find(
      (action) => action.type === "decide" && action.targets?.[0] === "a",
    );
    expect(recycle).toBeDefined();

    const answered = applyAction(state, recycle!);
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(seatOf(answered.state, "p1").mainDeck).toEqual(["b", "a"]);
    expect(answered.state.pending).toBeNull();
  });
});

/**
 * `legalActions` is the only legality authority, so every answer it offers has
 * to be one `applyAction` accepts — and every answer a player has must appear.
 */
describe("enumerating a predict", () => {
  function pendingPredict(legal: string[]): GameState {
    const base = deckBoard(legal);
    return {
      ...base,
      pending: { player: "p1", prompt: { kind: "predict", legal } },
    };
  }

  it("offers every subset, the empty one included", () => {
    const state = pendingPredict(["a", "b"]);
    const answers = legalActions(state, "p1").map((action) =>
      action.type === "decide" ? (action.targets ?? []) : null,
    );

    expect(answers).toContainEqual([]);
    expect(answers).toContainEqual(["a"]);
    expect(answers).toContainEqual(["b"]);
    expect(answers).toContainEqual(["a", "b"]);
  });

  /**
   * R436.1.a's order prompt is answered with the whole list. Enumerating one
   * id at a time offered nothing `applyAction` would take, which is how the
   * same shape of prompt for R372's damage ordering left the CLI stuck.
   */
  it("offers whole orders, not single cards", () => {
    const base = deckBoard(["a", "b"]);
    const state: GameState = {
      ...base,
      pending: {
        player: "p1",
        prompt: { kind: "orderPredicted", legal: ["a", "b"] },
      },
    };

    const answers = legalActions(state, "p1").map((action) =>
      action.type === "decide" ? (action.targets ?? []) : null,
    );

    expect(answers).toContainEqual(["a", "b"]);
    expect(answers).toContainEqual(["b", "a"]);
    expect(answers.every((each) => each !== null && each.length === 2)).toBe(true);
  });

  it("rejects an answer naming a card that was not revealed", () => {
    const state = pendingPredict(["a", "b"]);

    expect(
      applyAction(state, { type: "decide", playerId: "p1", targets: ["d"] }),
    ).toEqual({ ok: false, reason: "invalidTarget" });
  });
});
