import { totals } from "../cost.js";
import { VICTORY_SCORE } from "../scoring.js";
import { characteristicsOf } from "../layers.js";
import type { GameState, CardId, Location, PlayerId } from "../state.js";
import { OPPONENT, controlOf, costLabel, nameOf, unitsAt } from "./game.js";
import type { Move, MoveGroup } from "./game.js";

interface Selectable {
  selected: CardId | null;
  /** Cards clicked toward a multi-card answer, not yet confirmed. */
  staged: ReadonlySet<CardId>;
  legal: ReadonlySet<CardId>;
  actionable: ReadonlySet<CardId>;
  onSelect: (cardId: CardId) => void;
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
}: {
  state: GameState;
  cardId: CardId;
  sub?: string | undefined;
  /** Shown for a card still in hand, so its price is visible before clicking. */
  cost?: string | undefined;
  pick: Selectable;
}) {
  const now = characteristicsOf(state, cardId);
  const permanent = state.permanents[cardId];
  const printed = state.cards[cardId]?.might;
  const classes = [
    "card",
    `type-${now.type}`,
    pick.selected === cardId || pick.staged.has(cardId) ? "is-selected" : "",
    pick.legal.has(cardId) ? "is-legal" : "",
    pick.actionable.has(cardId) ? "is-actionable" : "",
    permanent?.exhausted === true ? "is-exhausted" : "",
    permanent?.stunned === true ? "is-stunned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} onClick={() => pick.onSelect(cardId)} title={cardId}>
      <span className="card-name">{now.name}</span>
      {now.type === "unit" && (
        <span className="card-might">
          {now.might}
          {printed !== undefined && printed !== now.might && (
            <em> ({printed})</em>
          )}
        </span>
      )}
      {sub !== undefined && <span className="card-sub">{sub}</span>}
      {cost !== undefined && <span className="card-cost">{cost}</span>}
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
}: {
  label: string;
  ids: CardId[];
  state: GameState;
  pick: Selectable;
  empty?: string;
  /** When given, each card shows what it would cost this player. */
  owner?: PlayerId;
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
  const player = state.players[playerId];
  const pool = totals(player.runePool);
  const base: Location = { kind: "base", player: playerId };
  const inBase = unitsAt(state, base).map((permanent) => permanent.cardId);

  return (
    <section className={`panel ${acting ? "is-acting" : ""}`}>
      <header className="panel-head">
        <h2>
          {playerId.toUpperCase()}
          {player.legend !== null && (
            <span className="legend">
              {nameOf(state, player.legend)}
              {player.legendExhausted === true && <em> · exhausted</em>}
            </span>
          )}
        </h2>
        <div className="tallies">
          <span className="score">
            {player.points}
            <em>/{VICTORY_SCORE}</em>
          </span>
          {player.xp > 0 && <span className="tally">{player.xp} XP</span>}
          <span className="tally">deck {player.mainDeck.length}</span>
          <span className="tally">trash {player.trash.length}</span>
        </div>
      </header>

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

        return (
          <div
            key={battlefieldId}
            className={`battlefield ${inCombat ? "is-showdown" : ""} ${
              contested !== null ? "is-contested" : ""
            }`}
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

  return (
    <section className="detail">
      <h4>{now.name}</h4>
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
      {state.winner.toUpperCase()} wins · {state.players[state.winner].points} points
      <span className="muted"> ({OPPONENT[state.winner]} had {state.players[OPPONENT[state.winner]].points})</span>
    </div>
  );
}

export { controlOf };
