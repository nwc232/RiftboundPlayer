import { useCallback, useMemo, useState } from "react";
import { renderEvent } from "../event-text.js";
import type { GameEvent } from "../events.js";
import type { Action, RejectionReason } from "../actions.js";
import type { CardId, GameState, PlayerId } from "../state.js";
import { eventsFor, viewOf } from "../view.js";
import { useOnline } from "./online.js";
import {
  Battlefields,
  CardDetail,
  Chain,
  MoveList,
  PlayerPanel,
  Prompt,
  Winner,
} from "./components.js";
import {
  actingPlayer,
  dispatch,
  groupMoves,
  movesFor,
  DECKS,
  newGame,
  promptArity,
  whyNotPlayable,
} from "./game.js";
import type { Move } from "./game.js";

interface Snapshot {
  state: GameState;
  /**
   * Kept as events rather than as rendered lines. R107 makes what a player may
   * read out of the log depend on which seat they are in, and the seat can be
   * changed after the fact — so the redaction has to happen at display time,
   * not once at dispatch.
   */
  events: GameEvent[];
}

/** A room code in the URL is what makes a link a link: `?room=badger`. */
function roomFromUrl(): string | null {
  const room = new URLSearchParams(window.location.search).get("room");
  return room === null || room === "" ? null : room;
}

export function App() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  /**
   * Online when a room code is set. The two modes differ in exactly one
   * place — where the game comes from — because the server sends what
   * `viewOf` and `eventsFor` already produced locally. Everything below this
   * renders from a `GameState` and does not know which kind it is.
   */
  const [room, setRoom] = useState<string | null>(roomFromUrl);
  const [roomDraft, setRoomDraft] = useState(() => roomFromUrl() ?? "");
  // Which list each seat brings. R485.5's choice of battlefield is left to
  // `matchup`'s default; changing either only takes effect on a new game,
  // which is why the pickers do not touch the running one.
  const [p1Deck, setP1Deck] = useState(0);
  const [p2Deck, setP2Deck] = useState(1);
  /**
   * Online there is only one deck to choose: your own. The two pickers above
   * are a hotseat idea — one screen setting up both sides — and sending one of
   * them as "my deck" is what had both seats arriving with Vex.
   */
  const [myDeck, setMyDeck] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>(() => [
    { state: newGame(seed), events: [] },
  ]);
  const [selected, setSelected] = useState<CardId | null>(null);
  /** What the pointer is over, previewed full size beside the board. */
  const [hovered, setHovered] = useState<CardId | null>(null);
  const [staged, setStaged] = useState<CardId[]>([]);
  const [rejected, setRejected] = useState<RejectionReason | null>(null);

  /**
   * R107 — whose eyes to render through. `null` is hotseat: one screen, both
   * hands visible, which is what a single person testing wants. Choosing a
   * seat runs the state through `viewOf` first, so the screen is shown exactly
   * what a client on the other end of a socket would receive — the opponent's
   * hand is not hidden by the renderer, it never arrives.
   */
  const [seat, setSeat] = useState<PlayerId | null>(null);

  // Always called, connecting only when there is a room: a hook cannot be
  // conditional, and `useOnline` treats a null room as "stay offline".
  const online = useOnline(room, myDeck);
  const isOnline = room !== null;

  const here = history[history.length - 1]!;
  const truth = here.state;
  const local = useMemo(
    () => (seat === null ? truth : viewOf(truth, seat)),
    [truth, seat],
  );
  // Online, the filtering already happened on the server — this client was
  // never sent the rest. Offline it happens here, from the same two functions.
  //
  // Online and not yet dealt, there is no game: the lobby returns before
  // anything below is rendered. The local game stands in only so the hooks
  // beneath have a shape to work on, because React will not let them be
  // skipped.
  const state = (isOnline ? online.state : local) ?? local;
  // R107 — the log through the same eyes as the board. `viewOf` closes the
  // state half and `eventsFor` closes the other: an opponent's draw arrives as
  // "a card", because the identity never reaches this client at all.
  const log = useMemo(
    () =>
      (isOnline
        ? online.events
        : seat === null
          ? here.events
          : eventsFor(here.events, seat)
      ).map((event) => renderEvent(event)),
    [isOnline, online.events, here.events, seat],
  );
  /**
   * Whose moves to offer.
   *
   * In hotseat that is whoever the game is waiting on. Once a seat is chosen
   * it is *that seat*, always — a client on the other end of a socket receives
   * its own legal moves and nobody else's. Asking for the acting player
   * offered p2's screen a list of p1's plays, over cards it had correctly been
   * refused the identity of: "play to base" against a card called "hidden
   * card".
   */
  const acting = (isOnline ? online.seat : seat) ?? actingPlayer(state);
  // Pointing at a card wins over the selection, so you can read anything on
  // the board without losing what you were about to play.
  const showing = hovered ?? selected;
  const moves = useMemo(() => movesFor(state, acting), [state, acting]);

  /**
   * R320.1 — while a decision is outstanding, answering it is the only move,
   * and `pending.prompt.legal` is already the set of cards that answer it.
   * Click-to-select and the decision mechanism are the same thing.
   */
  const legal = useMemo(() => {
    const prompt = state.pending?.prompt;
    // `chooseMode` answers with an index rather than a card, so nothing on the
    // board is highlighted for it — the prompt bar offers the arms instead.
    return new Set<CardId>(
      prompt !== undefined && "legal" in prompt && prompt.kind !== "chooseMode"
        ? prompt.legal
        : [],
    );
  }, [state]);

  /** Cards with at least one move available — what is worth clicking. */
  const actionable = useMemo(() => {
    const ids = new Set<CardId>();
    for (const move of moves) {
      if (move.subject !== undefined) ids.add(move.subject);
    }
    return ids;
  }, [moves]);

  const play = useCallback(
    (action: Action) => {
      // Online the server owns the game, so this is a request rather than a
      // move: the new state comes back over the socket, or a refusal does.
      if (isOnline) {
        online.send(action);
        setSelected(null);
        setStaged([]);
        return;
      }
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
            events: [...previous.events, ...result.events],
          },
        ];
      });
    },
    [state, isOnline, online],
  );

  const arity = promptArity(state);

  const onSelect = useCallback(
    (cardId: CardId) => {
      // Answering a decision is a click on a highlighted card. A prompt that
      // wants exactly one card answers on that click; anything else (the
      // mulligan, Stacked Deck, a Predict) collects clicks and waits for a
      // confirm. A prompt that accepts *none* has to wait even when it accepts
      // at most one, or R436.1's "keep it on top" would be unreachable.
      if (state.pending !== null && legal.has(cardId)) {
        if (arity.min === 1 && arity.max === 1) {
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

  // Every legal move is listed, grouped by the card it acts on. Selecting a
  // card narrows to it, but nothing is hidden until you do — a player who
  // cannot see what any card offers has no way to find out that runes are
  // what fills the pool.
  const groups = useMemo(
    () =>
      groupMoves(
        state,
        selected === null
          ? moves
          : moves.filter((move) => move.subject === selected),
      ),
    [state, moves, selected],
  );

  const blocked =
    selected === null ? null : whyNotPlayable(state, acting, selected);

  const pick = {
    selected,
    staged: new Set(staged),
    legal,
    actionable,
    onSelect,
    onHover: setHovered,
  };

  const restart = (): void => {
    if (isOnline) {
      online.restart();
    } else {
      setHistory([{ state: newGame(seed, p1Deck, p2Deck), events: [] }]);
    }
    setSelected(null);
    setRejected(null);
  };

  /**
   * Nothing to show until the server has dealt, which needs both seats. The
   * room code is the whole of the pairing — no accounts, no lobby list.
   */
  if (isOnline && online.state === null) {
    return (
      <div className="lobby">
        <h1>Riftbound</h1>
        <p className="lobby-room">
          room <strong>{room}</strong>
          {online.seat !== null && <> · you are {online.seat}</>}
        </p>
        <label className="decks lobby-deck">
          your deck
          <select
            value={myDeck}
            onChange={(event) => setMyDeck(Number(event.target.value))}
          >
            {DECKS.map((entry, index) => (
              <option key={entry.name} value={index}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <p className="lobby-status">
          {online.status === "connecting" && "connecting…"}
          {online.status === "waiting" &&
            "waiting for the other player to join"}
          {online.status === "closed" &&
            `disconnected${online.rejected === null ? "" : ` — ${online.rejected}`}`}
        </p>
        <p className="lobby-share">
          Send them this link:
          <code>{`${window.location.origin}/?room=${room}`}</code>
        </p>
        <button
          onClick={() => {
            window.history.replaceState(null, "", window.location.pathname);
            setRoom(null);
          }}
        >
          play locally instead
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <h1>Riftbound</h1>
        <span className="turn">
          turn {state.turn.number} · {state.turn.player} · {state.turn.phase}
        </span>
        {/* In hotseat this is whoever the game is waiting on; in a seat it is
            simply whose screen this is, and calling that "acting" was wrong
            the moment the seat stopped following the turn. */}
        <span className="acting">
          {seat === null ? `acting: ${acting}` : `you: ${acting}`}
        </span>
        <span className="spacer" />
        {isOnline ? (
          <label className="decks">
            your deck
            <select
              value={myDeck}
              // Rejoining mid-game would deal a new one out from under the
              // other seat, so the choice is locked once the game exists.
              disabled={online.state !== null}
              onChange={(event) => setMyDeck(Number(event.target.value))}
            >
              {DECKS.map((entry, index) => (
                <option key={entry.name} value={index}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isOnline ? null : (
        <label className="seat">
          seat
          <select
            value={seat ?? "both"}
            onChange={(event) =>
              setSeat(
                event.target.value === "both"
                  ? null
                  : (event.target.value as PlayerId),
              )
            }
          >
            <option value="both">hotseat</option>
            <option value="p1">p1 only</option>
            <option value="p2">p2 only</option>
          </select>
        </label>
        )}
        {isOnline ? null : (
        <label className="decks">
          p1
          <select
            value={p1Deck}
            onChange={(event) => setP1Deck(Number(event.target.value))}
          >
            {DECKS.map((entry, index) => (
              <option key={entry.name} value={index}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        )}
        {isOnline ? null : (
        <label className="decks">
          p2
          <select
            value={p2Deck}
            onChange={(event) => setP2Deck(Number(event.target.value))}
          >
            {DECKS.map((entry, index) => (
              <option key={entry.name} value={index}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        )}
        <label className="decks">
          room
          <input
            className="room"
            value={roomDraft}
            placeholder="code"
            onChange={(event) => setRoomDraft(event.target.value.trim())}
          />
          <button
            onClick={() => {
              if (isOnline) {
                window.history.replaceState(null, "", window.location.pathname);
                setRoom(null);
                return;
              }
              if (roomDraft === "") return;
              window.history.replaceState(null, "", `?room=${roomDraft}`);
              setRoom(roomDraft);
            }}
          >
            {isOnline ? "leave" : "play online"}
          </button>
        </label>
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
          // Online the server holds the game, and one seat cannot rewind a
          // game the other is also playing.
          disabled={isOnline || history.length < 2}
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
        {(arity.max > 1 || arity.min === 0) && state.pending !== null && (
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
        {/* Online the refusal comes back from the server, and it is the
            engine's own reason either way. */}
        {(isOnline ? online.rejected : rejected) !== null && (
          <div className="rejected">
            rejected: {isOnline ? online.rejected : rejected}
          </div>
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
            {showing === null
              ? `${acting} — everything you can do`
              : `${acting} — ${state.cards[showing]?.name ?? showing}`}
          </h3>
          {/* Pointing at a card wins over the selection, so you can read
              anything on the board without losing what you were about to
              play. */}
          {showing !== null && (
            <>
              <CardDetail state={state} cardId={showing} viewer={acting} />
              {selected !== null && (
                <button className="clear" onClick={() => setSelected(null)}>
                  show every move
                </button>
              )}
            </>
          )}
          {blocked !== null && <p className="blocked">{blocked}</p>}
          <MoveList
            groups={groups}
            selected={selected}
            onPlay={(move: Move) => play(move.action)}
            onFocus={(cardId) => setSelected(cardId)}
          />
        </section>
        <section className="log">
          <h3>log</h3>
          <ol>
            {log.slice(-40).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
