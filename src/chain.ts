import { seatOf } from "./state.js";
import type { GameEvent } from "./events.js";
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
       * Which arm of a "Choose one —" each execution took. One entry per
       * execution, because R820.2.a lets a repeat "choose the same mode or a
       * different one". Absent on a card with no modes.
       */
      modes?: number[];
      /**
       * R829.1.b.1 — [Flow]'s delayed replacement: "if the spell would leave
       * the chain after becoming a finalized chain item, and leaving the chain
       * wasn't instructed by its own execution, banish it instead". Recorded
       * on the item rather than derived from the card, because it belongs to
       * *this* play: the same spell played from hand does no such thing.
       */
      banishOnLeave?: true;
      /**
       * Fizz, Trickster — "Recycle that spell after you play it." The same
       * shape as `banishOnLeave` and for the same reason: it belongs to *this*
       * play, so the item is what carries it.
       */
      recycleOnLeave?: true;
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
      /** Which arm of a "Choose one —" was taken, chosen before its targets. */
      mode?: number;
      /** R383.3.b.1 — set once the ability's base cost has been paid. */
      costsPaid?: true;
      /**
       * R323.4 — where the source stood when this triggered, kept only when the
       * source is no longer on the board to be asked. A live source is looked up
       * directly instead, so effects get one uniform answer for "here".
       */
      sourceLocation?: Location;
      /**
       * Where the *inciting event* happened. Deceiver's "when you conquer or
       * hold … play a Reflection token **there**" needs the battlefield the
       * event named, and its source is a Legend — R107.4.b makes the Legend
       * Zone no location at all, so `sourceLocation` cannot answer it.
       */
      eventLocation?: Location;
      /**
       * Both ends of the move that incited this — Akali, Deadly Weapon's "a
       * unit at a battlefield I moved **to or from**". The origin is not
       * recoverable once the move has happened, so it is noted here the way
       * R323.4's death attributes are.
       */
      moveEndpoints?: Location[];
      /** R323.4 — Might as it stood at death, which printed Might won't give. */
      sourceMight?: number;
    };

/**
 * Why a spell is leaving the chain. R829.1.b.1 asks: it replaces a departure
 * only when "leaving the chain wasn't instructed by its own execution", so the
 * reason has to travel to wherever the decision is made.
 */
export type ChainExit = "resolved" | "countered" | "itsOwnExecution";

/**
 * R359.3.d — a spell that leaves the chain goes to its owner's trash. The one
 * place that happens, so that a replacement has one place to intercede: today
 * only [Flow]'s R829.1.b.1, recorded on the item as it was played.
 *
 * A triggered ability has no card to move, so this is spells only; its source
 * stays wherever it is.
 */
export function leaveChain(
  state: GameState,
  item: ChainItem,
  reason: ChainExit,
): { state: GameState; events: GameEvent[] } {
  if (item.kind !== "spell") return { state, events: [] };

  const owner = item.controller;
  const player = seatOf(state, owner);

  // R829.1.b.1 — "if the spell would leave the chain after becoming a
  // finalized chain item, and leaving the chain wasn't instructed by its own
  // execution, banish it instead."
  // R416.1 — to the bottom of the Main Deck instead of the trash.
  if (item.recycleOnLeave === true && reason !== "itsOwnExecution") {
    return {
      state: {
        ...state,
        players: {
          ...state.players,
          [owner]: { ...player, mainDeck: [...player.mainDeck, item.cardId] },
        },
      },
      events: [
        { type: "cardRecycled", playerId: owner, cardId: item.cardId },
      ],
    };
  }

  if (item.banishOnLeave === true && reason !== "itsOwnExecution") {
    return {
      state: {
        ...state,
        players: {
          ...state.players,
          [owner]: { ...player, banished: [...player.banished, item.cardId] },
        },
      },
      events: [
        {
          type: "eventReplaced",
          playerId: owner,
          cardId: item.cardId,
          subject: item.cardId,
          replaced: "leavesChain",
        },
        { type: "banished", playerId: owner, cardId: item.cardId },
      ],
    };
  }

  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [owner]: { ...player, trash: [...player.trash, item.cardId] },
      },
    },
    events: [],
  };
}

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
