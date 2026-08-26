import { useCallback, useMemo, useState } from "react";
import { renderEvent } from "../event-text.js";
import type { GameEvent } from "../events.js";
import type { Action, RejectionReason } from "../actions.js";
import type { CardId, GameState } from "../state.js";
import {
  Battlefields,
  Chain,
  MoveList,
  PlayerPanel,
  Prompt,
  Winner,
} from "./components.js";
import {
  actingPlayer,
  dispatch,
  movesFor,
  newGame,
  promptArity,
  subjectOf,
} from "./game.js";
import type { Move } from "./game.js";

interface Snapshot {
  state: GameState;
  log: string[];
}

export function App() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [history, setHistory] = useState<Snapshot[]>(() => [
    { state: newGame(seed), log: [] },
  ]);
  const [selected, setSelected] = useState<CardId | null>(null);
  const [staged, setStaged] = useState<CardId[]>([]);
  const [rejected, setRejected] = useState<RejectionReason | null>(null);

  const here = history[history.length - 1]!;
  const state = here.state;
  const acting = actingPlayer(state);
  const moves = useMemo(() => movesFor(state, acting), [state, acting]);

  /**
   * R320.1 — while a decision is outstanding, answering it is the only move,
   * and `pending.prompt.legal` is already the set of cards that answer it.
   * Click-to-select and the decision mechanism are the same thing.
   */
  const legal = useMemo(() => {
    const prompt = state.pending?.prompt;
    return new Set<CardId>(
      prompt !== undefined && "legal" in prompt ? prompt.legal : [],
    );
  }, [state]);

  /** Cards with at least one move available — what is worth clicking. */
  const actionable = useMemo(() => {
    const ids = new Set<CardId>();
    for (const move of moves) {
      const subject = subjectOf(move.action);
      if (subject !== undefined) ids.add(subject);
    }
    return ids;
  }, [moves]);

  const play = useCallback(
    (action: Action) => {
      const result = dispatch(state, action);
      if (result.rejected !== undefined) {
        setRejected(result.rejected);
        return;
      }
      setRejected(null);
      setSelected(null);
      setStaged([]);
      setHistory((past) => {
        const previous = past[past.length - 1]!;
        return [
          ...past,
          {
            state: result.state,
            log: [...previous.log, ...result.events.map(renderEvent)],
          },
        ];
      });
    },
    [state],
  );

  const arity = promptArity(state);

  const onSelect = useCallback(
    (cardId: CardId) => {
      // Answering a decision is a click on a highlighted card. A prompt that
      // wants one card answers on that click; one that wants several (the
      // mulligan, Stacked Deck) collects them and waits for a confirm.
      if (state.pending !== null && legal.has(cardId)) {
        if (arity.max <= 1) {
          play({
            type: "decide",
            playerId: state.pending.player,
            targets: [cardId],
          });
          return;
        }
        setStaged((current) =>
          current.includes(cardId)
            ? current.filter((id) => id !== cardId)
            : current.length < arity.max
              ? [...current, cardId]
              : current,
        );
        return;
      }
      setSelected((current) => (current === cardId ? null : cardId));
    },
    [state, legal, play, arity.max],
  );

  const shown =
    selected === null
      ? moves.filter((move) => subjectOf(move.action) === undefined)
      : moves.filter((move) => subjectOf(move.action) === selected);

  const pick = {
    selected,
    staged: new Set(staged),
    legal,
    actionable,
    onSelect,
  };

  const restart = (): void => {
    setHistory([{ state: newGame(seed), log: [] }]);
    setSelected(null);
    setRejected(null);
  };

  return (
    <div className="app">
      <header className="top">
        <h1>Riftbound</h1>
        <span className="turn">
          turn {state.turn.number} · {state.turn.player} · {state.turn.phase}
        </span>
        <span className="acting">acting: {acting}</span>
        <span className="spacer" />
        <label className="seed">
          seed
          <input
            type="number"
            value={seed}
            onChange={(event) => setSeed(Number(event.target.value))}
          />
        </label>
        <button onClick={restart}>new game</button>
        <button
          disabled={history.length < 2}
          onClick={() => {
            setHistory((past) => past.slice(0, -1));
            setSelected(null);
            setRejected(null);
          }}
        >
          undo
        </button>
      </header>

      <div className="banners">
        <Winner state={state} />
        <Prompt state={state} />
        {arity.max > 1 && state.pending !== null && (
          <div className="staging">
            <span>
              {staged.length === 0
                ? "none chosen"
                : staged.map((id) => state.cards[id]?.name ?? id).join(" + ")}
            </span>
            <button
              disabled={staged.length < arity.min}
              onClick={() =>
                play({
                  type: "decide",
                  playerId: state.pending!.player,
                  targets: staged,
                })
              }
            >
              confirm
            </button>
            {staged.length > 0 && (
              <button onClick={() => setStaged([])}>clear</button>
            )}
          </div>
        )}
        {rejected !== null && (
          <div className="rejected">rejected: {rejected}</div>
        )}
      </div>

      <main className="board">
        <PlayerPanel
          state={state}
          playerId="p2"
          pick={pick}
          acting={acting === "p2"}
        />
        <Battlefields state={state} pick={pick} />
        <PlayerPanel
          state={state}
          playerId="p1"
          pick={pick}
          acting={acting === "p1"}
        />
      </main>

      <aside className="side">
        <Chain state={state} />
        <section className="actions">
          <h3>
            {selected === null
              ? `${acting} — general moves`
              : `${acting} — ${state.cards[selected]?.name ?? selected}`}
          </h3>
          {selected !== null && (
            <button className="clear" onClick={() => setSelected(null)}>
              back to general moves
            </button>
          )}
          <MoveList moves={shown} onPlay={(move: Move) => play(move.action)} />
        </section>
        <section className="log">
          <h3>log</h3>
          <ol>
            {here.log.slice(-40).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
