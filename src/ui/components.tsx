import { totals } from "../cost.js";
import { victoryScore } from "../scoring.js";
import { artFor } from "./card-art.js";
import { characteristicsOf } from "../layers.js";
import type { GameState, CardId, Location, PlayerId } from "../state.js";
import {
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
  onSelect: (cardId: CardId) => void;
  /**
   * Pointing at a card previews it full size, which is the only way to read
   * its text: a card face at hand size is about 90px wide, and no amount of
   * zooming in place makes printed rules text legible at that scale. Arena and
   * Hearthstone both answer this the same way — a big preview elsewhere on the
   * screen — rather than by growing the card in the row.
   */
  onHover: (cardId: CardId | null) => void;
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
      onClick={() => pick.onSelect(cardId)}
      onMouseEnter={() => pick.onHover(cardId)}
      onMouseLeave={() => pick.onHover(null)}
      onFocus={() => pick.onHover(cardId)}
      onBlur={() => pick.onHover(null)}
      title={cardId}
    >
      {art !== undefined && (
        <img className="card-art" src={art} alt="" aria-hidden="true" />
      )}
      <span className="card-name">{now.name}</span>
      {might !== undefined && (
        <span
          className={`card-might ${printed !== undefined && printed !== might ? "is-changed" : ""}`}
        >
          {might}
        </span>
      )}
      {cost !== undefined && <span className="card-cost">{cost}</span>}
      {sub !== undefined && <span className="card-sub">{sub}</span>}
      {permanent !== undefined && permanent.damage > 0 && (
        <span className="card-damage" title={`${permanent.damage} damage`}>
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
 * A player's side of the board. Both are rendered identically and from the
 * same data, so making one of them "theirs" later is a filter on what is
 * passed in rather than a different component.
 */
export function PlayerPanel({
  state,
  playerId,
  pick,
  acting,
}: {
  state: GameState;
  playerId: PlayerId;
  pick: Selectable;
  acting: boolean;
}) {
  const player = seatOf(state, playerId);
  const pool = totals(player.runePool);
  const base: Location = { kind: "base", player: playerId };
  const inBase = unitsAt(state, base).map((permanent) => permanent.cardId);

  // R133 — a player can be the thing an ability chooses, and a player is not
  // on the board anywhere, so the panel itself is what gets clicked.
  const choosable = pick.legal.has(playerId);

  return (
    <section
      className={[
        "panel",
        acting ? "is-acting" : "",
        choosable ? "is-legal" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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
          {player.xp > 0 && <span className="tally">{player.xp} XP</span>}
          <span className="tally">deck {player.mainDeck.length}</span>
          <span className="tally">trash {player.trash.length}</span>
        </div>
      </header>

      {/*
        R107.4.c — the Champion Legend is a Game Object, and several print an
        activated ability. It was a text label, which meant no way to read what
        it does, no way to see it exhausted, and no way to click it — so a
        Legend whose ability you were meant to use looked like a Legend that
        did nothing.
      */}
      {player.legend !== null && (
        <Row
          label="legend"
          ids={[player.legend]}
          state={state}
          pick={pick}
          exhausted={player.legendExhausted === true}
        />
      )}
      <Row
        label="hand"
        ids={player.hand}
        state={state}
        pick={pick}
        owner={playerId}
        empty="no cards"
      />
      <Row label="base" ids={inBase} state={state} pick={pick} empty="empty" />
      {player.champion !== null && (
        <Row
          label="champion"
          ids={[player.champion]}
          state={state}
          pick={pick}
          owner={playerId}
        />
      )}

      {/*
        R164 — runes are individually clickable, because exhausting and
        recycling them is how the pool gets filled. Rendering them as a tally
        would leave a player with no way to pay for anything.
      */}
      <div className="row">
        <span className="row-label">runes</span>
        <div className="row-cards">
          {player.runes.length === 0 ? (
            <span className="muted">none</span>
          ) : (
            player.runes.map((runeId) => {
              const rune = state.runes[runeId];
              if (rune === undefined) return null;
              return (
                <button
                  key={runeId}
                  title={runeId}
                  className={[
                    "rune",
                    `rune-${rune.domain}`,
                    rune.exhausted ? "is-exhausted" : "",
                    pick.selected === runeId ? "is-selected" : "",
                    pick.actionable.has(runeId) ? "is-actionable" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => pick.onSelect(runeId)}
                >
                  {rune.domain.slice(0, 2)}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="row">
        <span className="row-label">pool</span>
        <div className="row-cards">
          {pool.energy === 0 &&
          pool.universalPower === 0 &&
          Object.keys(pool.power).length === 0 ? (
            <span className="muted">empty</span>
          ) : (
            <span className="pool">
              {pool.energy > 0 && `${pool.energy} energy`}
              {Object.entries(pool.power).map(([d, n]) => ` · ${n} ${d}`)}
              {pool.universalPower > 0 && ` · ${pool.universalPower} any`}
            </span>
          )}
        </div>
      </div>
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
        const art = artFor(nameOf(state, battlefieldId));

        return (
          <div
            key={battlefieldId}
            className={`battlefield ${inCombat ? "is-showdown" : ""} ${
              contested !== null ? "is-contested" : ""
            }`}
            style={
              art === undefined
                ? undefined
                : { backgroundImage: `url(${art})` }
            }
          >
            <header>
              <button
                className={`bf-name ${pick.legal.has(battlefieldId) ? "is-legal" : ""}`}
                onClick={() => pick.onSelect(battlefieldId)}
              >
                {nameOf(state, battlefieldId)}
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
                facedown · {facedown.controller} · hidden turn{" "}
                {facedown.hiddenOnTurn}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** R327 — the chain, newest first, because that is the order it resolves in. */
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
  return (
    <div className="move-groups">
      {groups.map((group) => (
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
    </div>
  );
}

/**
 * The selected card, as printed. The engine runs the `abilities` data, never
 * this text — showing both is what lets a mismatch between them be noticed.
 */
export function CardDetail({
  state,
  cardId,
  viewer,
}: {
  state: GameState;
  cardId: CardId;
  viewer: PlayerId;
}) {
  const now = characteristicsOf(state, cardId);
  const printed = state.cards[cardId];
  const permanent = state.permanents[cardId];
  const cost = costLabel(state, viewer, cardId);

  const status = [
    permanent?.exhausted === true ? "exhausted" : "",
    permanent?.stunned === true ? "stunned" : "",
    permanent?.buffed === true ? "buffed" : "",
    permanent?.designation ?? "",
    permanent?.damage !== undefined && permanent.damage > 0
      ? `${permanent.damage} damage`
      : "",
  ].filter(Boolean);

  // The printed card, when the pool published art for it. Looked up by name
  // because ids here are authored by hand; a token or a card with no entry
  // falls through to the text below, which is the whole card either way.
  const art = artFor(now.name);

  return (
    <section className="detail">
      <h4>{now.name}</h4>
      {art !== undefined && (
        <img
          className="detail-art"
          src={art}
          // The engine's own words rather than the publisher's, so what a
          // screen reader hears is what the game is actually playing — a card
          // that has become a copy reads as what it copied.
          alt={`${now.name}. ${printed?.text ?? ""}`}
          // Not lazy: this is the one image on the panel and it is the thing
          // the click was for. Deferring it means the card you just asked to
          // look at arrives last.
          fetchPriority="high"
        />
      )}
      <div className="detail-meta">
        <span>{now.type}</span>
        {cost !== undefined && <span>{cost}</span>}
        {now.type === "unit" && (
          <span>
            {now.might} Might
            {printed?.might !== undefined && printed.might !== now.might && (
              <em> (printed {printed.might})</em>
            )}
          </span>
        )}
        {now.keywords.length > 0 && <span>{now.keywords.join(" · ")}</span>}
        {status.length > 0 && (
          <span className="detail-status">{status.join(" · ")}</span>
        )}
      </div>
      {printed?.text !== undefined && (
        <p className="detail-text">{printed.text}</p>
      )}
    </section>
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
