import { mightOf } from "./layers.js";
import type { TriggeredAbility } from "./triggers.js";
import type {
  CardId,
  GameState,
  Location,
  PlayerId,
  PlaySource,
} from "./state.js";

/**
 * R327–331. The Chain is a single LIFO zone that exists only while something is
 * on it. Its existence is what makes the turn a Closed State (R331.1), which is
 * why cards need [Reaction] to be played while it is up.
 *
 * Index 0 is the oldest item; the last entry is the newest and resolves first
 * (R340.1).
 */
export type ChainItem =
  | {
      kind: "spell";
      cardId: CardId;
      controller: PlayerId;
      /** Chosen when the item was played (R355), read again on resolution. */
      targets: CardId[];
      /** R356.2.b — whether the optional additional cost was paid for this play. */
      paidAdditionalCost?: true;
      /**
       * R820.3 — how many *additional* times this item's instructions run,
       * one per [Repeat] cost paid. R820.3.a: however many times it executes,
       * the spell was Played once, so this is a property of the chain item and
       * never of the play.
       */
      repeats?: number;
      /**
       * R829.1.b.1 — [Flow]'s delayed replacement: "if the spell would leave
       * the chain after becoming a finalized chain item, and leaving the chain
       * wasn't instructed by its own execution, banish it instead". Recorded
       * on the item rather than derived from the card, because it belongs to
       * *this* play: the same spell played from hand does no such thing.
       */
      banishOnLeave?: true;
      /** Which zone the spell was played from — Back Off asks (R811.1.b). */
      playedFrom?: PlaySource;
    }
  | {
      kind: "trigger";
      sourceId: CardId;
      /**
       * The ability itself, not an index into its source's rules text. Abilities
       * are data, so carrying one costs nothing — and R808.1.d.3's "note the
       * details before the card moves" then comes for free: a trigger whose
       * source has died, or whose copied rules text has since gone, still holds
       * exactly the ability that triggered.
       */
      ability: TriggeredAbility;
      controller: PlayerId;
      targets: CardId[];
      /** R383.3.a — set once the controller has answered the "you may". */
      optionalResolved?: boolean;
      /** R383.3.b.1 — set once the ability's base cost has been paid. */
      costsPaid?: true;
      /**
       * R323.4 — where the source stood when this triggered, kept only when the
       * source is no longer on the board to be asked. A live source is looked up
       * directly instead, so effects get one uniform answer for "here".
       */
      sourceLocation?: Location;
      /** R323.4 — Might as it stood at death, which printed Might won't give. */
      sourceMight?: number;
    };

/** What a chain item is identified by on the board — its card either way. */
export function chainItemCardId(item: ChainItem): CardId {
  return item.kind === "spell" ? item.cardId : item.sourceId;
}

/**
 * What "here" resolves to for a chain item: where its source is, or where it
 * stood when it triggered if it has since died (R323.4). Answering both cases
 * the same way means an effect never has to ask whether its source survived.
 */
export function sourceLocationOf(
  state: GameState,
  item: ChainItem,
): Location | undefined {
  const live = state.permanents[chainItemCardId(item)]?.location;
  if (live !== undefined) return live;
  return item.kind === "trigger" ? item.sourceLocation : undefined;
}

/**
 * A chain item's source's Might: current if it is still on the board, else the
 * value noted when it died (R323.4). R711 would give printed Might for a card
 * sitting in the trash, which is a different question from what this one was
 * when its own death trigger fired.
 */
export function sourceMightOf(
  state: GameState,
  item: ChainItem,
): number | undefined {
  const cardId = chainItemCardId(item);
  if (state.permanents[cardId] !== undefined) return mightOf(state, cardId);
  return item.kind === "trigger" ? item.sourceMight : undefined;
}

export function chainExists(state: GameState): boolean {
  return state.chain.length > 0;
}

/** R331 — Closed while a chain exists, Open otherwise. */
export function isClosedState(state: GameState): boolean {
  return chainExists(state);
}

export function newestItem(state: GameState): ChainItem | undefined {
  return state.chain[state.chain.length - 1];
}

export function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}
