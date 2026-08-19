import type { CardId, GameState, Location, PlayerId } from "./state.js";

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
    }
  | {
      kind: "trigger";
      sourceId: CardId;
      abilityIndex: number;
      controller: PlayerId;
      targets: CardId[];
      /** R383.3.a — set once the controller has answered the "you may". */
      optionalResolved?: boolean;
      /**
       * R323.4 — where the source stood when this triggered, kept only when the
       * source is no longer on the board to be asked. A live source is looked up
       * directly instead, so effects get one uniform answer for "here".
       */
      sourceLocation?: Location;
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
