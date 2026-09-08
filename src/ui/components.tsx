import type { ReactNode } from "react";
import { totals } from "../cost.js";
import { victoryScore } from "../scoring.js";
import { artFor } from "./card-art.js";
import { characteristicsOf } from "../layers.js";
import type { GameState, CardId, Location, PlayerId } from "../state.js";
import {
  battlefieldLabel,
  controlOf,
  costLabel,
  describeCost,
  nameOf,
  unitsAt,
} from "./game.js";
import type { Move, MoveGroup } from "./game.js";
import { opponentsOf, seatOf } from "../state.js";

interface Selectable {
  selected: CardId | null;
  /** Cards clicked toward a multi-card answer, not yet confirmed. */
  staged: ReadonlySet<CardId>;
  legal: ReadonlySet<CardId>;
  actionable: ReadonlySet<CardId>;
  /**
   * `anchor` is where the card is on screen, so a menu of its moves can open
   * beside it rather than 800px away in the list. Measured at the click
   * because rows scroll and the mat reflows; a position worked out any earlier
   * would be wrong by the time it is used.
   */
  onSelect: (cardId: CardId, anchor?: DOMRect) => void;
  /**
   * `anchor` is where the card is, so a readable copy of it can open beside
   * the one you are pointing at rather than in a panel on the far side of the
   * screen. Every table-top client works this way for the same reason: at
   * hand size a card face is about 90px wide and its rules text is not
   * legible at any zoom.
   *
   * Not only cards: a battlefield is hovered by its header, which is the only
   * place its printed text is readable at all — the mat shows its name and who
   * holds it and nothing else, so an ability like Star Spring's was invisible
   * in the UI even though the engine was applying it.
   */
  onHover: (cardId: CardId | null, anchor?: DOMRect) => void;
  /** Which card currently has its move menu open, so it can be marked. */
  menuFor: CardId | null;
}

/**
 * One card, anywhere. `legal` is the set a pending decision will accept, which
 * is exactly what `pending.prompt.legal` carries — the decision mechanism and
 * click-to-select are the same thing wearing different clothes.
 */
function Card({
  state,
  cardId,
  sub,
  cost,
  pick,
  exhausted = false,
}: {
  state: GameState;
  cardId: CardId;
  sub?: string | undefined;
  /** Shown for a card still in hand, so its price is visible before clicking. */
  cost?: string | undefined;
  pick: Selectable;
  /** For a card whose exhausted state is not on a permanent — the Legend. */
  exhausted?: boolean;
}) {
  const now = characteristicsOf(state, cardId);
  const permanent = state.permanents[cardId];
  const printed = state.cards[cardId]?.might;
  // A concealed card in an opponent's hand has a stand-in name and no art;
  // so does a token. Both fall back to the plain face below.
  const art = artFor(now.name);
  const classes = [
    "card",
    `type-${now.type}`,
    art !== undefined ? "has-art" : "",
    pick.selected === cardId || pick.staged.has(cardId) ? "is-selected" : "",
    pick.menuFor === cardId ? "is-open" : "",
    pick.legal.has(cardId) ? "is-legal" : "",
    pick.actionable.has(cardId) ? "is-actionable" : "",
    permanent?.exhausted === true || exhausted ? "is-exhausted" : "",
    permanent?.stunned === true ? "is-stunned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // R477 — what the card *is* now, which the printed face cannot show. A 4
  // Might unit standing at 7 with two damage on it has to read 7, or the
  // picture is lying about the game.
  const might =
    now.type === "unit" && (printed !== undefined || permanent !== undefined)
      ? now.might
      : undefined;

  return (
    <button
      className={classes}
      onClick={(event) =>
        pick.onSelect(cardId, event.currentTarget.getBoundingClientRect())
      }
      onMouseEnter={(event) =>
        pick.onHover(cardId, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => pick.onHover(null)}
      onFocus={(event) =>
        pick.onHover(cardId, event.currentTarget.getBoundingClientRect())
      }
      onBlur={() => pick.onHover(null)}
      // No `title`: it used to carry the internal id (`p1-gust-2`), which is
      // a debugging aid and reads to a player as nonsense. The preview says
      // what the card is, and a browser tooltip fighting it is worse than
      // neither.
    >
      {art !== undefined && (
        <img className="card-art" src={art} alt="" aria-hidden="true" />
      )}
      <span className="card-name">{now.name}</span>
      {might !== undefined && (
        <span
          // The value is the key, so a Might that changes is a *new* element
          // and its animation plays. Without it React keeps the old span and
          // only the text changes, which is the thing that was easy to miss.
          key={`might-${might}`}
          className={`card-might ${printed !== undefined && printed !== might ? "is-changed" : ""}`}
        >
          {might}
        </span>
      )}
      {cost !== undefined && <span className="card-cost">{cost}</span>}
      {sub !== undefined && <span className="card-sub">{sub}</span>}
      {permanent !== undefined && permanent.damage > 0 && (
        <span
          key={`damage-${permanent.damage}`}
          className="card-damage"
          title={`${permanent.damage} damage`}
        >
          {permanent.damage}
        </span>
      )}
      {permanent?.buffed === true && <span className="pip" title="buffed">+</span>}
      {permanent?.attachedTo !== undefined && (
        <span className="pip" title="attached">⇗</span>
      )}
    </button>
  );
}

function Row({
  label,
  ids,
  state,
  pick,
  empty = "—",
  owner,
  exhausted = false,
}: {
  label: string;
  ids: CardId[];
  state: GameState;
  pick: Selectable;
  empty?: string;
  /** When given, each card shows what it would cost this player. */
  owner?: PlayerId;
  /**
   * R107.4.c — the Legend's exhausted state lives on the player rather than on
   * a permanent, so it has to be passed in; every other card carries its own.
   */
  exhausted?: boolean;
}) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-cards">
        {ids.length === 0 ? (
          <span className="muted">{empty}</span>
        ) : (
          ids.map((id) => (
            <Card
              key={id}
              state={state}
              cardId={id}
              pick={pick}
              exhausted={exhausted}
              cost={owner === undefined ? undefined : costLabel(state, owner, id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * One space on the mat, labelled, whether or not anything is in it.
 *
 * A playmat prints its zones so the empty ones still read as somewhere a card
 * goes. That is the whole difference between a mat and a list: the panel used
 * to render only what existed, so a base with nothing in it was the word
 * "empty" and the Rune Deck was not on screen at all.
 */
function Zone({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`zone ${wide ? "is-wide" : ""}`}>
      <span className="zone-label">{label}</span>
      <div className="zone-body">{children}</div>
    </div>
  );
}

/**
 * A face-down pile: the Main Deck (R108.4) and the Rune Deck (R108.5).
 *
 * R107.2/R108.5.d — the order of both is Secret Information from everyone,
 * their owner included, so there is nothing to show but how many are left.
 * They were a tally in the panel header before, which put "deck 35" in the
 * same breath as the score and gave neither a place on the board.
 */
function Pile({ count }: { count: number }) {
  return (
    <div className="pile" aria-label={`${count} cards`}>
      <span>{count}</span>
    </div>
  );
}

/**
 * A player's side of the board — a playmat, with a space for each zone the
 * rules give them: R107.4's Legend Zone, R108.3's Champion Zone, R107.1's
 * Base (which R107.1.c is also where their Runes reside), R108.4's Main Deck,
 * R108.5's Rune Deck, and R108.2's Trash.
 *
 * Both seats render from this same component, so making one of them "theirs"
 * stays a filter on what is passed in rather than a different component.
 */
export function PlayerPanel({
  state,
  playerId,
  pick,
  acting,
  near = false,
  mat,
}: {
  state: GameState;
  playerId: PlayerId;
  pick: Selectable;
  acting: boolean;
  /**
   * The seat at the bottom of the mat — yours. Its hand is rendered as a fan
   * along the bottom edge instead of a row in here, so the panel keeps only
   * what is on the board. Everyone else's panel is the same component with
   * this off, drawn smaller: you cannot use their cards, so they need to be
   * legible rather than reachable.
   */
  near?: boolean;
  /**
   * A playmat image behind the zones — purely decorative, and the reason the
   * zones are drawn as outlines over a surface rather than as boxes: there was
   * somewhere for one to go without moving anything.
   *
   * The printed zones on a real mat will not line up with these, because these
   * are placed by a grid that reflows with the seat count. It is a surface, not
   * a template.
   */
  mat?: string | undefined;
}) {
  const player = seatOf(state, playerId);
  const base: Location = { kind: "base", player: playerId };
  const inBase = unitsAt(state, base).map((permanent) => permanent.cardId);

  // R133 — a player can be the thing an ability chooses, and a player is not
  // on the board anywhere, so the panel itself is what gets clicked.
  const choosable = pick.legal.has(playerId);

  return (
    <section
      className={[
        "panel",
        near ? "is-near" : "is-far",
        acting ? "is-acting" : "",
        choosable ? "is-legal" : "",
        mat === undefined || mat === "" ? "" : "has-mat",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        mat === undefined || mat === ""
          ? undefined
          : { backgroundImage: `url(${mat})` }
      }
    >
      <header className="panel-head">
        <h2>
          {choosable ? (
            <button className="pick-player" onClick={() => pick.onSelect(playerId)}>
              {playerId.toUpperCase()}
            </button>
          ) : (
            playerId.toUpperCase()
          )}
        </h2>
        <div className="tallies">
          <span className="score">
            {player.points}
            <em>/{victoryScore(state)}</em>
          </span>
          {/* The deck and the trash have spaces on the mat now, so counting
              them here as well put "deck 35" in the same breath as the score
              and gave neither a place on the board. */}
          {player.xp > 0 && <span className="tally">{player.xp} XP</span>}
        </div>
      </header>

      {/*
        The mat. Every zone the rules give a player has a printed space here,
        occupied or not — R107.4's Legend, R108.3's Champion, R107.1's Base,
        R108.5's Rune Deck, R108.4's Main Deck and R108.2's Trash — laid out
        the way they sit in front of you: who you are on the left, the board
        in the middle, what you draw from and discard to on the right.

        R107.4.c — the Champion Legend is a Game Object and several print an
        activated ability. It was a text label once, which meant no way to
        read it, no way to see it exhausted and no way to click it.
      */}
      <div className="mat-grid">
        <div className="mat-identity">
          <Zone label="legend">
            {player.legend === null ? null : (
              <Card
                state={state}
                cardId={player.legend}
                pick={pick}
                exhausted={player.legendExhausted === true}
              />
            )}
          </Zone>
          <Zone label="champion">
            {player.champion === null ? null : (
              <Card
                state={state}
                cardId={player.champion}
                pick={pick}
                cost={costLabel(state, playerId, player.champion)}
              />
            )}
          </Zone>
        </div>

        <div className="mat-middle">
          <Zone label="base" wide>
            {inBase.map((id) => (
              <Card key={id} state={state} cardId={id} pick={pick} />
            ))}
          </Zone>
          {/* R107.1.c — "Permanents and Runes controlled by a player reside in
              that player's Base", so the runes belong beside it rather than
              in a tray at the other end of the screen. */}
          <Zone label="runes" wide>
            <Resources state={state} playerId={playerId} pick={pick} />
          </Zone>
        </div>

        <div className="mat-piles">
          <Zone label="rune deck">
            <Pile count={player.runeDeck.length} />
          </Zone>
          <Zone label="deck">
            <Pile count={player.mainDeck.length} />
          </Zone>
          {/* R108.2.d — a Trash is Public Information, so the top of it is
              shown rather than counted: what somebody has spent is half of
              reading their board. */}
          <Zone label="trash">
            {player.trash.length === 0 ? null : (
              <Card
                state={state}
                cardId={player.trash[player.trash.length - 1]!}
                sub={player.trash.length > 1 ? `+${player.trash.length - 1}` : undefined}
                pick={pick}
              />
            )}
          </Zone>
        </div>
      </div>

      {/* Yours is the fan along the bottom edge; theirs stays on the mat,
          because a hand you cannot play out of is information rather than a
          control. */}
      {!near && (
        <Row
          label="hand"
          ids={player.hand}
          state={state}
          pick={pick}
          owner={playerId}
          empty="no cards"
        />
      )}

    </section>
  );
}

/**
 * What you pay with: your runes and what is in your pool.
 *
 * R164 — runes are individually clickable, because exhausting and recycling
 * them is how the pool gets filled; a tally would leave a player unable to
 * pay for anything. They sit beside the hand rather than in the panel because
 * they are used on every turn, and the panel scrolls.
 */
export function Resources({
  state,
  playerId,
  pick,
}: {
  state: GameState;
  playerId: PlayerId;
  pick: Selectable;
}) {
  const player = seatOf(state, playerId);
  const pool = totals(player.runePool);
  const empty =
    pool.energy === 0 &&
    pool.universalPower === 0 &&
    Object.keys(pool.power).length === 0;

  return (
    <section className="resources" aria-label={`${playerId} resources`}>
      <div className="rune-strip">
        {player.runes.length === 0 ? (
          <span className="muted">no runes</span>
        ) : (
          player.runes.map((runeId) => {
            const rune = state.runes[runeId];
            if (rune === undefined) return null;
            // A rune is a card (R161.1), so it is drawn as one. It was a
            // two-letter chip, which had room for a domain and nothing else:
            // what a rune *does* — R164.2's "Exhaust: Add [1]. Recycle: Add
            // [Calm]" — was the one thing a new player has to work out before
            // anything else can be played, and the board never showed it.
            //
            // R107.1.d makes runes in a Base Public Information, so this is
            // the same card at both seats. Its exhausted state is passed in
            // rather than read off a permanent: R161.2 keeps a rune in its own
            // zone, so `state.permanents` knows nothing about it.
            return (
              <Card
                key={runeId}
                state={state}
                cardId={runeId}
                pick={pick}
                exhausted={rune.exhausted}
              />
            );
          })
        )}
      </div>
      <div className="pool-strip">
        {empty ? (
          <span className="muted">pool empty</span>
        ) : (
          <span className="pool">
            {pool.energy > 0 && `${pool.energy} energy`}
            {Object.entries(pool.power).map(([d, n]) => ` · ${n} ${d}`)}
            {pool.universalPower > 0 && ` · ${pool.universalPower} any`}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Your hand, along the bottom edge.
 *
 * Overlapping rather than spaced, and larger than a card anywhere else on the
 * mat: it is the only zone you act out of constantly, and the one place where
 * being able to read a card at a glance is worth the room. Hover lifts one
 * clear of its neighbours, which is what the overlap costs and what makes it
 * affordable.
 */
export function Hand({
  state,
  playerId,
  pick,
}: {
  state: GameState;
  playerId: PlayerId;
  pick: Selectable;
}) {
  const player = seatOf(state, playerId);

  return (
    <section className="hand-fan" aria-label={`${playerId} hand`}>
      {player.hand.length === 0 ? (
        <span className="muted">no cards in hand</span>
      ) : (
        player.hand.map((cardId) => (
          <Card
            key={cardId}
            state={state}
            cardId={cardId}
            pick={pick}
            cost={costLabel(state, playerId, cardId)}
          />
        ))
      )}
    </section>
  );
}

/** The battlefields, with whoever is standing on each. */
export function Battlefields({
  state,
  pick,
}: {
  state: GameState;
  pick: Selectable;
}) {
  return (
    <section className="battlefields">
      {state.battlefieldOrder.map((battlefieldId) => {
        const battlefield = state.battlefields[battlefieldId];
        const here: Location = { kind: "battlefield", id: battlefieldId };
        const present = unitsAt(state, here);
        const facedown = state.facedown[battlefieldId];
        const contested = battlefield?.contestedBy ?? null;
        const inCombat = state.showdown?.battlefieldId === battlefieldId;

        // The battlefield's own printed face, laid under its contents rather
        // than beside them — a battlefield is the space the units stand in,
        // so it reads as the mat rather than as another card in a row.

        return (
          <div
            key={battlefieldId}
            className={`battlefield ${inCombat ? "is-showdown" : ""} ${
              contested !== null ? "is-contested" : ""
            } ${battlefield?.controller != null ? "is-held" : ""}`}
          >
            {/* The card's art, blurred into atmosphere rather than cropped to
                it. A battlefield card is landscape and printed for a shared
                table — a bar of upside-down rules text along the top for the
                player opposite, art through the middle, name plate and the
                upright text below — and a mat is never the same shape as the
                card, so any crop that isolates the art at one battlefield
                count catches the text at another. Blurred, none of that is
                readable and what is left is the colour of the place. */}
            {artFor(nameOf(state, battlefieldId)) !== undefined && (
              <div
                className="bf-art"
                style={{
                  backgroundImage: `url(${artFor(nameOf(state, battlefieldId))})`,
                }}
              />
            )}
            {/* No separate card face on the mat: a battlefield card is
                *landscape* (1039x744, where every other card is 744x1039), so
                rendering it in a portrait card box squashed it. The mat is the
                card — its art is the mat's background, its name is the header,
                and its printed text is a hover away. R107.2.b makes each
                battlefield a Location, and this is that location. */}
            <header
              // Anchored to the name rather than to the header, which spans
              // the whole mat: a preview measured off that opens past the
              // battlefield beside it instead of next to what you pointed at.
              onMouseEnter={(event) => {
                const name = event.currentTarget.querySelector(".bf-name");
                pick.onHover(
                  battlefieldId,
                  (name ?? event.currentTarget).getBoundingClientRect(),
                );
              }}
              onMouseLeave={() => pick.onHover(null)}
            >
              <button
                className={`bf-name ${pick.legal.has(battlefieldId) ? "is-legal" : ""}`}
                onClick={() => pick.onSelect(battlefieldId)}
                onFocus={(event) =>
                  pick.onHover(
                    battlefieldId,
                    event.currentTarget.getBoundingClientRect(),
                  )
                }
                onBlur={() => pick.onHover(null)}
              >
                {battlefieldLabel(state, battlefieldId)}
              </button>
              <span className="bf-state">
                {battlefield?.controller === null || battlefield === undefined
                  ? "uncontrolled"
                  : `held by ${battlefield.controller}`}
                {contested !== null && ` · contested by ${contested}`}
                {inCombat && " · showdown"}
              </span>
            </header>
            <div className="bf-units">
              {present.length === 0 && <span className="muted">empty</span>}
              {present.map((permanent) => (
                <Card
                  key={permanent.cardId}
                  state={state}
                  cardId={permanent.cardId}
                  sub={
                    permanent.designation ??
                    (permanent.damage > 0 ? `${permanent.damage} dmg` : undefined)
                  }
                  pick={pick}
                />
              ))}
            </div>
            {facedown !== undefined && (
              <div className="bf-facedown">
                {/* A card, not a line of text. R811.1.b's "beginning on the
                    next turn … you may play this" is a real move that
                    `legalActions` offers — but the whole interaction model
                    here is "click the card to see what it can do", and the
                    facedown zone was the one place on the board with no card
                    to click. A player with a hidden Evelynn and a combat
                    happening on top of it had nowhere to go.

                    `viewOf` has already decided what this is: its controller
                    sees the card, everyone else sees a blank with a stand-in
                    name, so rendering it the same way for both is safe. */}
                <Card
                  state={state}
                  cardId={facedown.cardId}
                  sub={`hidden t${facedown.hiddenOnTurn}`}
                  pick={pick}
                />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The opening hand, big enough to actually decide over.
 *
 * R117's Mulligan is the first thing anyone does and the only decision made
 * before there is a board to read — so the board is not what should be on
 * screen for it. At hand size the four cards are 92px wide and the choice is
 * being made off card names; at this size it is being made off the cards.
 *
 * The board is a click away rather than gone: a player who wants to see which
 * battlefields are in play before deciding what to keep is asking a fair
 * question, and R485.5 has them presented before the mulligan.
 */
export function Mulligan({
  state,
  playerId,
  staged,
  max,
  pick,
  onConfirm,
  onClear,
  onPeek,
}: {
  state: GameState;
  playerId: PlayerId;
  staged: readonly CardId[];
  max: number;
  pick: Selectable;
  onConfirm: () => void;
  onClear: () => void;
  onPeek: () => void;
}) {
  const set = staged.length;
  return (
    <div className="mulligan-veil">
      <div className="mulligan-panel">
        <h2>your opening hand</h2>
        <p className="mulligan-said">
          {/* R117.1–117.3 in one sentence, because "mulligan" means something
              different in every card game and this one is unusual: you keep
              the hand and swap up to two of it, rather than redrawing. */}
          Set aside up to {max}. You draw that many back, and the ones you set
          aside go to the bottom of your deck.
        </p>

        <Hand state={state} playerId={playerId} pick={pick} />

        <div className="mulligan-actions">
          <button className="primary" onClick={onConfirm}>
            {set === 0
              ? "keep all four"
              : `set aside ${set} and draw ${set === 1 ? "1" : set}`}
          </button>
          {set > 0 && <button onClick={onClear}>clear</button>}
          <button onClick={onPeek}>look at the board</button>
        </div>
      </div>
    </div>
  );
}

/** R327 — the chain, newest first, because that is the order it resolves in. */
/**
 * The card you are pointing at, big enough to read.
 *
 * Opens beside the card rather than in the side panel, because looking away
 * from the board to read what you are pointing at is the thing that makes a
 * card game feel like a spreadsheet. Positioned the same way the move menu is
 * — fixed against a measured rectangle, flipping side and clamping to the
 * viewport — so the two never fight over the same corner.
 */
/** Who holds a battlefield, and whether anyone is contesting it (R449). */
function holderOf(state: GameState, battlefieldId: CardId): string {
  const battlefield = state.battlefields[battlefieldId];
  if (battlefield === undefined) return "not in play";
  const held =
    battlefield.controller === null
      ? "uncontrolled"
      : `held by ${battlefield.controller}`;
  return battlefield.contestedBy === null
    ? held
    : `${held} · contested by ${battlefield.contestedBy}`;
}

export function CardPreview({
  state,
  cardId,
  at,
  viewer,
}: {
  state: GameState;
  cardId: CardId;
  at: DOMRect;
  viewer: PlayerId;
}) {
  const now = characteristicsOf(state, cardId);
  const printed = state.cards[cardId];
  const art = artFor(now.name);
  const permanent = state.permanents[cardId];

  const width = 250;
  const roomRight = window.innerWidth - at.right > width + 20;
  const left = roomRight ? at.right + 12 : Math.max(8, at.left - width - 12);
  // Tall enough for the face plus a few lines of text, clamped into view.
  const tall = Math.round(width * (1039 / 744)) + 120;
  const top = Math.min(
    Math.max(8, at.top - 40),
    Math.max(8, window.innerHeight - tall - 8),
  );

  return (
    <div className="card-preview" style={{ left, top, width }}>
      {art !== undefined && <img src={art} alt="" aria-hidden="true" />}
      <div className="preview-head">
        <strong>{now.name}</strong>
        {now.type === "unit" && <span className="preview-might">{now.might}</span>}
      </div>
      {printed?.text !== undefined && (
        <p className="preview-text">{printed.text}</p>
      )}
      <p className="preview-foot">
        {/* R485.5 — a battlefield is presented, not played, and a legend is
            placed at setup: neither has a price, so showing one reads as a
            cost the player could pay. What a battlefield's footer is for is
            who holds it, which is the thing being decided over it. */}
        {now.type === "battlefield"
          ? holderOf(state, cardId)
          : now.type === "legend"
            ? "legend"
            : // A rune on the board is not in `permanents` — R161 keeps it in
              // its own zone — so its readied state has to be read from there
              // or the footer says nothing about the one thing that matters.
              now.type === "rune" && state.runes[cardId] !== undefined
              ? state.runes[cardId]!.exhausted
                ? "exhausted"
                : "readied"
              : costLabel(state, viewer, cardId)}
        {permanent?.exhausted === true && " · exhausted"}
        {permanent !== undefined && permanent.damage > 0 && ` · ${permanent.damage} damage`}
      </p>
    </div>
  );
}

/**
 * The moves for one card, opened beside it.
 *
 * `position: fixed` against the card's measured rectangle rather than nesting
 * inside it: rows scroll and clip, and a menu that can be cut off by its own
 * container is worse than no menu. Everything in it comes from
 * `legalActions` — this is a different place to click the same list, not a
 * second opinion about what is playable.
 */
export function CardMenu({
  moves,
  at,
  onPick,
  onClose,
}: {
  moves: Move[];
  at: DOMRect;
  onPick: (move: Move) => void;
  onClose: () => void;
}) {
  // Open to the right of the card, or to its left when that would run off the
  // edge; below it, or above when there is no room underneath.
  const width = 240;
  const roomRight = window.innerWidth - at.right > width + 16;
  const left = roomRight ? at.right + 8 : Math.max(8, at.left - width - 8);
  const estimated = 12 + moves.length * 30;
  const top = Math.min(at.top, Math.max(8, window.innerHeight - estimated - 8));

  return (
    <>
      {/* A click anywhere else closes it, including on another card — which
          then opens that card's own menu, so nothing needs two clicks. */}
      <div className="menu-shade" onClick={onClose} />
      <div className="card-menu" style={{ left, top, width }} role="menu">
        {moves.map((move, index) => (
          <button
            key={`${move.label}-${index}`}
            className="menu-item"
            role="menuitem"
            onClick={() => onPick(move)}
          >
            {move.label}
          </button>
        ))}
      </div>
    </>
  );
}

export function Chain({ state }: { state: GameState }) {
  if (state.chain.length === 0) return null;
  return (
    <section className="chain">
      <h3>chain · resolves top down</h3>
      <ol>
        {[...state.chain].reverse().map((item, i) => {
          const id = item.kind === "spell" ? item.cardId : item.sourceId;
          return (
            <li key={`${id}-${i}`}>
              <strong>{nameOf(state, id)}</strong>
              <span className="muted">
                {" "}
                {item.kind} · {item.controller}
                {item.targets.length > 0 &&
                  ` → ${item.targets.map((t) => nameOf(state, t)).join(", ")}`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Everything the acting player may do, grouped by the card it is about. */
export function MoveList({
  groups,
  selected,
  onPlay,
  onFocus,
}: {
  groups: MoveGroup[];
  selected: CardId | null;
  onPlay: (move: Move) => void;
  onFocus: (cardId: CardId | null) => void;
}) {
  if (groups.length === 0) {
    return <p className="muted">nothing legal right now.</p>;
  }

  // The moves that belong to no card — end turn, pass — are the ones you
  // reach for without looking at the board, so they stay out in the open.
  // Everything else has a home on the card itself now: clicking it opens the
  // same list beside it. This is the reference copy, not the way in.
  const loose = groups.filter((group) => group.cardId === null);
  const byCard = groups.filter((group) => group.cardId !== null);
  const count = byCard.reduce((total, group) => total + group.moves.length, 0);

  // A decision that takes several cards is enumerated by `legalActions` as
  // every combination it would accept — R117.1's "up to two" is eleven answers
  // from a four-card hand and twenty-nine from a seven-card one, all of them
  // printed above "end turn". The board already answers these: click the
  // cards, then confirm. So they are folded away rather than removed, because
  // a prompt over cards the board does not show — R436's Predict, a Stacked
  // Deck's three revealed cards — is answerable *only* from this list.
  const answers = loose.flatMap((group) =>
    group.moves.filter((move) => move.action.type === "decide"),
  );
  const plain = loose.flatMap((group) =>
    group.moves.filter((move) => move.action.type !== "decide"),
  );
  const button = (move: Move, key: number) => (
    <li key={key}>
      <button className="move" onClick={() => onPlay(move)}>
        {move.label}
      </button>
    </li>
  );

  return (
    <div className="move-groups">
      {plain.length > 0 && (
        <div className="move-group">
          <ul className="moves">{plain.map(button)}</ul>
        </div>
      )}

      {/* Few enough to read at a glance stay open; a list of combinations
          does not. Four is where "pick one of these" turns into "scan". */}
      {answers.length > 0 && answers.length <= 4 && (
        <div className="move-group">
          <ul className="moves">{answers.map(button)}</ul>
        </div>
      )}
      {answers.length > 4 && (
        <details className="by-card">
          <summary>{answers.length} ways to answer</summary>
          <div className="move-group">
            <ul className="moves">{answers.map(button)}</ul>
          </div>
        </details>
      )}

      {count > 0 && (
        <details className="by-card">
          <summary>
            {count} move{count === 1 ? "" : "s"} on {byCard.length} card
            {byCard.length === 1 ? "" : "s"}
          </summary>
          {byCard.map((group) => (
        <div
          key={group.cardId ?? "anytime"}
          className={`move-group ${
            selected !== null && group.cardId === selected ? "is-focused" : ""
          }`}
        >
          <button
            className="move-group-head"
            onClick={() => onFocus(group.cardId)}
          >
            {group.heading}
          </button>
          <ul className="moves">
            {group.moves.map((move, i) => (
              <li key={i}>
                <button className="move" onClick={() => onPlay(move)}>
                  {move.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
          ))}
        </details>
      )}
    </div>
  );
}

export function Prompt({ state }: { state: GameState }) {
  const pending = state.pending;
  if (pending === null) return null;
  const { prompt } = pending;

  const wording = (): string => {
    switch (prompt.kind) {
      case "confirmOptional":
        return "perform this ability?";
      case "chooseTargets":
        return `choose a target (${prompt.remaining} to go)`;
      case "mulligan":
        return `mulligan — set aside up to ${prompt.max}`;
      case "chooseStagedBattlefield":
        return "which battlefield opens?";
      case "assignCombatDamage":
        return `assign ${prompt.remaining} damage`;
      case "orderDamage":
        return `click the replacements in the order they apply to ${nameOf(
          state,
          prompt.subject,
        )} (${prompt.amount} damage incoming)`;
      case "orderReplacements":
        return `which replacement applies to ${nameOf(state, prompt.subject)}?`;
      case "chooseMode":
        return `choose one — ${prompt.legal.length} to pick from`;
      case "chooseFromRevealed":
        return prompt.keep > 0
          ? `keep ${prompt.keep}`
          : "choose a card to recycle";
      // R436.1 — "any number" includes none, so say so: with nothing clicked
      // the confirm is a real answer rather than a stuck prompt.
      case "predict":
        return prompt.legal.length === 1
          ? "predict — recycle this card, or confirm to keep it on top"
          : `predict — click any of the ${prompt.legal.length} to recycle, then confirm`;
      case "orderPredicted":
        return "click the rest in the order they go back on top";
      // Hard Bargain — the spell's own controller is being asked, and doing
      // nothing is the answer that lets it be countered, so the choice has to
      // read as a choice rather than as a stuck prompt.
      case "payOrDecline":
        return `pay ${describeCost(prompt.cost)} to keep ${nameOf(
          state,
          prompt.legal[0] ?? "",
        )}, or confirm to let it be countered`;
      default:
        return "choose";
    }
  };

  return (
    <div className="prompt">
      <strong>{pending.player}</strong> — {wording()}
    </div>
  );
}

export function Winner({ state }: { state: GameState }) {
  if (state.winner === null) return null;
  return (
    <div className="winner">
      {state.winner.toUpperCase()} wins · {seatOf(state, state.winner).points} points
      <span className="muted">
        {" ("}
        {opponentsOf(state, state.winner)
          .map((id) => `${id.toUpperCase()} had ${seatOf(state, id).points}`)
          .join(", ")}
        {")"}
      </span>
    </div>
  );
}

export { controlOf };
