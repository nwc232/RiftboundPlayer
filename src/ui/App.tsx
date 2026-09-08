import { useCallback, useEffect, useMemo, useState } from "react";
import { renderEvent } from "../event-text.js";
import type { GameEvent } from "../events.js";
import type { Action, RejectionReason } from "../actions.js";
import type { CardId, GameState, PlayerId } from "../state.js";
import { eventsFor, viewOf } from "../view.js";
import { useOnline } from "./online.js";
import {
  CardPreview,
  Mulligan,
  Resources,
  Hand,
  CardMenu,
  Battlefields,
  Chain,
  MoveList,
  PlayerPanel,
  Prompt,
  Winner,
} from "./components.js";
import {
  clickOn,
  actingPlayer,
  dispatch,
  groupMoves,
  movesFor,
  DECKS,
  newGame,
  owesMulligan,
  promptArity,
  whyNotPlayable,
} from "./game.js";
import type { Move } from "./game.js";
import { MODES } from "../modes-of-play.js";
import { SEATS, opponentsOf, seatOf } from "../state.js";
import { explain } from "./rejections.js";

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
  const [decks, setDecks] = useState<number[]>([0, 1]);
  /**
   * R483.1 — how many seats. Changing it resizes the deck list, because a
   * Skirmish needs a third choice and a Duel has nowhere to put one.
   */
  const setPlayers = (count: number): void => {
    setDecks((current) =>
      Array.from({ length: count }, (_, at) => current[at] ?? at % DECKS.length),
    );
  };
  /**
   * Online there is only one deck to choose: your own. The two pickers above
   * are a hotseat idea — one screen setting up both sides — and sending one of
   * them as "my deck" is what had both seats arriving with Vex.
   */
  const [myDeck, setMyDeck] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>(() => [
    { state: newGame(seed), events: [] },
  ]);
  /**
   * What the running local game was dealt with, so the pickers above can say
   * when they no longer describe it.
   *
   * They never touched the running game and never should — a seat count is not
   * something a game in progress can change, and re-dealing because somebody
   * opened a dropdown would throw away a game. But saying nothing was worse:
   * choosing "FFA4 (War)" put four deck pickers on screen over a two-player
   * board with two battlefields, and nothing anywhere said why.
   */
  const [dealt, setDealt] = useState<number[]>([0, 1]);
  const [selected, setSelected] = useState<CardId | null>(null);
  /** What the pointer is over, previewed full size beside the board. */
  /** What the pointer is over, and where it is, for the readable preview. */
  const [hovered, setHovered] = useState<{ cardId: CardId; rect?: DOMRect } | null>(
    null,
  );
  const [staged, setStaged] = useState<CardId[]>([]);
  /** The mulligan overlay, set aside for a moment to look at the board. */
  const [peeking, setPeeking] = useState(false);
  /**
   * Seats whose mulligan this client has already sent. Online the answer is
   * held by the server until R117's order reaches that seat, so the task stays
   * on the queue after it was submitted and the overlay would otherwise sit
   * there asking a question already answered.
   */
  const [sentMulligan, setSentMulligan] = useState<CardId[]>([]);
  /** Setup starts open — there is nothing to look at until a game exists. */
  const [showSetup, setShowSetup] = useState(true);
  /** Which card's moves are open, and where on screen to put them. */
  const [menu, setMenu] = useState<{ cardId: CardId; rect: DOMRect } | null>(
    null,
  );
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
  const online = useOnline(room, myDeck, decks.length);
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
  const log = useMemo(() => {
    const events = isOnline
      ? online.events
      : seat === null
        ? here.events
        : eventsFor(here.events, seat);

    // A phase that nothing happened in is a line saying so. Five of the six
    // phases are usually empty, so by turn five the log was thirty lines of
    // "awaken phase / beginning phase / channel phase" with the two things a
    // player wanted to see buried among them. A phase heading followed
    // immediately by another heading had nothing under it, and is dropped;
    // the ones that kept something keep it.
    return events
      .filter((event, at) => {
        if (event.type !== "phaseBegan") return true;
        const next = events[at + 1];
        return (
          next !== undefined &&
          next.type !== "phaseBegan" &&
          next.type !== "turnBegan"
        );
      })
      .map((event) => ({
        line: renderEvent(event, state.cards),
        // Headings, dimmed: they are structure rather than news, and a player
        // scanning for what happened should not have to read past them.
        heading: event.type === "phaseBegan" || event.type === "turnBegan",
      }));
  }, [isOnline, online.events, here.events, seat, state.cards]);
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
  /**
   * Which seat sits at the bottom of the board. Online and in single-seat
   * mode that is you; in hotseat it follows whoever is acting, so the panel
   * you are playing out of is always the near one.
   */
  const near = acting;
  // Pointing at a card wins over the selection, so you can read anything on
  // the board without losing what you were about to play.
  const refusal = explain(isOnline ? online.rejected : rejected);
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
    (cardId: CardId, anchor?: DOMRect) => {
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
      // Nothing pending, so a click is about *doing* something with this
      // card. `clickOn` sorts the moves `legalActions` already returned; the
      // menu is a second place to click the same list, never a second opinion
      // about what is legal.
      setMenu(null);
      const outcome = clickOn(moves, cardId);
      if (outcome.kind === "play") {
        play(outcome.move.action);
        return;
      }
      if (outcome.kind === "menu" && anchor !== undefined) {
        setMenu({ cardId, rect: anchor });
        setSelected(cardId);
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

  // The menu is pinned to where a card *was*. Any change to the board can
  // move it, so it closes rather than pointing at the wrong thing — including
  // when somebody else acts in an online game.
  useEffect(() => {
    setMenu(null);
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = {
    selected,
    staged: new Set(staged),
    legal,
    actionable,
    onSelect,
    onHover: (cardId: CardId | null, anchor?: DOMRect) =>
      setHovered(
        cardId === null
          ? null
          : { cardId, ...(anchor === undefined ? {} : { rect: anchor }) },
      ),
    menuFor: menu?.cardId ?? null,
  };

  const restart = (): void => {
    if (isOnline) {
      online.restart();
    } else {
      setHistory([{ state: newGame(seed, decks), events: [] }]);
      setDealt(decks);
    }
    setSelected(null);
    setRejected(null);
    setStaged([]);
    setSentMulligan([]);
    setPeeking(false);
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
        {/* R483.1 — the room's size. The server honours it only from whoever
            opens the room, so it is shown to everyone (a joiner needs to know
            what they have walked into) but changing it is only meaningful for
            the first to arrive, which is what p1 means here. */}
        <label className="decks lobby-deck">
          players
          <select
            // Whoever opened the room decided this, and the server ignores
            // anyone else's answer — so a joiner is shown the room's real
            // size rather than whatever their own picker happened to say.
            value={online.seated?.of ?? decks.length}
            disabled={online.seat !== null && online.seat !== "p1"}
            onChange={(event) => setPlayers(Number(event.target.value))}
          >
            {MODES.map((mode) => (
              <option key={mode.id} value={mode.players}>
                {mode.name}
              </option>
            ))}
          </select>
        </label>
        <p className="lobby-status">
          {online.status === "connecting" && "connecting…"}
          {online.status === "waiting" &&
            (online.seated === null
              ? "waiting for the other players to join"
              : `waiting — ${online.seated.seated} of ${online.seated.of} seated`)}
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
        {/*
          Setup is not play. Seeds, seat selectors, deck pickers and the room
          code are how a game is *arranged*; once one is running they are
          clutter, and to someone who has never seen this they read as a
          debugger rather than a card game. They fold away, open by default
          only until the first game is under way.
        */}
        <button
          className={showSetup ? "setup-toggle is-open" : "setup-toggle"}
          aria-expanded={showSetup}
          onClick={() => setShowSetup((open) => !open)}
        >
          setup {showSetup ? "▴" : "▾"}
        </button>
        <button
          className="concede"
          disabled={state.winner !== null}
          onClick={() => {
            const who = isOnline ? online.seat : acting;
            if (who === null) return;
            if (!window.confirm(`Concede as ${who}? This cannot be undone.`)) {
              return;
            }
            play({ type: "concede", playerId: who });
          }}
        >
          concede
        </button>
      </header>

      {showSetup && (
        <div className="setup-panel">
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
            {state.turnOrder.map((id) => (
              <option key={id} value={id}>
                {id} only
              </option>
            ))}
          </select>
        </label>
        )}
        {isOnline ? null : (
        <label className="decks">
          players
          <select
            value={decks.length}
            onChange={(event) => setPlayers(Number(event.target.value))}
          >
            {MODES.map((mode) => (
              <option key={mode.id} value={mode.players}>
                {mode.name}
              </option>
            ))}
          </select>
        </label>
        )}
        {isOnline
          ? null
          : decks.map((chosen, at) => (
              <label className="decks" key={SEATS[at]}>
                {SEATS[at]}
                <select
                  value={chosen}
                  onChange={(event) =>
                    setDecks((current) =>
                      current.map((each, index) =>
                        index === at ? Number(event.target.value) : each,
                      ),
                    )
                  }
                >
                  {DECKS.map((entry, index) => (
                    <option key={entry.name} value={index}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
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
        {/* The pickers describe the *next* game, and mostly that is obvious.
            It is not obvious at all when the seat count is one of them: four
            deck pickers over a two-player board is a screen contradicting
            itself, and this is the sentence that resolves it. */}
        <button
          onClick={restart}
          className={
            !isOnline && dealt.join() !== decks.join() ? "primary" : undefined
          }
        >
          new game
        </button>
        {!isOnline && dealt.join() !== decks.join() && (
          <span className="pending-setup">
            {dealt.length !== decks.length
              ? `still a ${dealt.length}-player game — deal again to change it`
              : "deal again to use these decks"}
          </span>
        )}
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
        {/* R650 — legal at any time, and kept away from the move list on
            purpose: online it cannot be undone, so it asks first. */}
        </div>
      )}

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
            {/* Peeking is a look, not a decision, so the way back sits with
                the other mulligan controls rather than floating over the hand
                it exists to get you back to. */}
            {peeking && (
              <button onClick={() => setPeeking(false)}>back to your hand</button>
            )}
          </div>
        )}
        {/* Online the refusal comes back from the server, and it is the
            engine's own reason either way — `explain` is the only place it
            becomes something a player can act on. */}
        {refusal !== null && (
          <div className={refusal.race ? "rejected is-race" : "rejected"}>
            {refusal.text}
          </div>
        )}
        {/* Somebody's socket dropped and their seat is being held. The others
            are waiting on them, so they are told rather than left guessing. */}
        {isOnline && online.away.length > 0 && (
          <div className="rejected is-race">
            {online.away.join(", ")} disconnected — holding their seat for a
            minute
          </div>
        )}
      </div>

      {/* R117 — the first decision of the game, and the only one made before
          there is a board to read. It takes the screen rather than sharing it
          with a board nothing has happened on yet. Only the viewer's own: in
          a shared game the others are answering theirs, and in hotseat the
          prompt moves to whoever is being asked. */}
      {owesMulligan(state, near) &&
        !sentMulligan.includes(near) &&
        !peeking && (
          <Mulligan
            state={state}
            playerId={near}
            staged={staged}
            // R117.1's "up to two", capped by a hand that could be smaller.
            // Read from the prompt when it is this seat's turn and worked out
            // the same way when it is not, because the overlay opens before
            // the prompt does.
            max={
              state.pending?.prompt.kind === "mulligan" &&
              state.pending.player === near
                ? state.pending.prompt.max
                : Math.min(2, seatOf(state, near).hand.length)
            }
            pick={pick}
            onConfirm={() => {
              play({ type: "decide", playerId: near, targets: staged });
              setSentMulligan((sent) => [...sent, near]);
              setStaged([]);
              setPeeking(false);
            }}
            onClear={() => setStaged([])}
            onPeek={() => setPeeking(true)}
          />
        )}
      {/* Answered, and the others have not. R117's order still decides when it
          is performed; this is the only place that shows through. */}
      {owesMulligan(state, near) && sentMulligan.includes(near) && (
        <div className="mulligan-waiting">waiting for the other players</div>
      )}
      {hovered?.rect !== undefined && menu === null && (
        <CardPreview
          state={state}
          cardId={hovered.cardId}
          at={hovered.rect}
          viewer={acting}
        />
      )}

      {menu !== null && (
        <CardMenu
          moves={moves.filter((move) => move.subject === menu.cardId)}
          at={menu.rect}
          onPick={(move) => {
            play(move.action);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      <main className="board">
        {/* Everyone else above, the viewer below. With two seats that is the
            layout it always was; with three or four the top row grows, which
            is the only thing about the board a Skirmish changes. */}
        {/* Everything above the hand scrolls; the hand does not. */}
        <div className="mat">
        <div className="opponents">
          {opponentsOf(state, near).map((id) => (
            <PlayerPanel
              key={id}
              state={state}
              playerId={id}
              pick={pick}
              acting={acting === id}
            />
          ))}
        </div>
        <Battlefields state={state} pick={pick} />
        <PlayerPanel
          state={state}
          playerId={near}
          pick={pick}
          acting={acting === near}
          near
        />
        </div>
        {/* The three things you act with, always on screen: what you can pay
            with, and what you can play. */}
        <div className="tray">
          <Resources state={state} playerId={near} pick={pick} />
          <Hand state={state} playerId={near} pick={pick} />
        </div>
      </main>

      <aside className="side">
        <Chain state={state} />
        <section className="actions">
          {/* The card you are pointing at is rendered beside the card
              itself now, so repeating it here would be the same picture
              twice, half a screen apart. */}
          <h3>{acting} — what you can do</h3>
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
            {log.slice(-40).map((entry, i) => (
              <li key={i} className={entry.heading ? "is-heading" : ""}>
                {entry.line}
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
