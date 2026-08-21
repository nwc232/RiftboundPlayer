import type { Duration } from "./layers.js";
import type { TokenKind } from "./tokens.js";
import type {
  CardId,
  Cost,
  Domain,
  GameState,
  Keyword,
  Location,
  PlayerId,
} from "./state.js";
import type { ScoreMethod } from "./scoring.js";
import type { Phase } from "./turn.js";

export type GameEvent =
  | { type: "cardDrawn"; playerId: PlayerId; cardId: CardId }
  | { type: "unitPlayed"; playerId: PlayerId; cardId: CardId }
  | { type: "runeChanneled"; playerId: PlayerId; cardId: CardId }
  | { type: "runeRecycled"; playerId: PlayerId; cardId: CardId }
  | { type: "energyAdded"; playerId: PlayerId; amount: number }
  | { type: "powerAdded"; playerId: PlayerId; domain: Domain; amount: number }
  | { type: "costPaid"; playerId: PlayerId; cardId: CardId; cost: Cost }
  | { type: "turnBegan"; playerId: PlayerId; turn: number }
  | { type: "phaseBegan"; playerId: PlayerId; phase: Phase }
  | { type: "objectReadied"; playerId: PlayerId; cardId: CardId }
  | { type: "poolEmptied"; playerId: PlayerId }
  | {
      type: "unitMoved";
      playerId: PlayerId;
      cardId: CardId;
      from: Location;
      to: Location;
    }
  | { type: "showdownOpened"; battlefieldId: CardId; attacker: PlayerId }
  | { type: "focusPassed"; playerId: PlayerId }
  | { type: "showdownClosed"; battlefieldId: CardId }
  | { type: "battlefieldControlled"; playerId: PlayerId; battlefieldId: CardId }
  | { type: "battlefieldControlLost"; playerId: PlayerId; battlefieldId: CardId }
  | {
      type: "battlefieldScored";
      playerId: PlayerId;
      battlefieldId: CardId;
      method: ScoreMethod;
    }
  | { type: "pointGained"; playerId: PlayerId; points: number }
  | { type: "gameWon"; playerId: PlayerId; points: number }
  | {
      type: "combatDamageDealt";
      battlefieldId: CardId;
      attacker: PlayerId;
      attackerMight: number;
      defenderMight: number;
    }
  /**
   * R323.4 — the cleanup notes a dying unit's location *before* R323.5 moves it
   * to the trash, because a death trigger's "here" has to mean where it stood.
   * Carried on the event so any death-watching ability can read it, not just
   * Deathknell.
   */
  | {
      type: "unitKilled";
      playerId: PlayerId;
      cardId: CardId;
      location: Location;
      /**
       * Might as it stood on the board, which R323.4 also says to note. Once
       * layer effects exist this diverges from the printed value the card keeps
       * in `state.cards` — a buffed unit was Mighty (R708) when it died even
       * though its printed Might says otherwise.
       */
      might: number;
    }
  | { type: "unitRecalled"; playerId: PlayerId; cardId: CardId }
  | { type: "damageDealt"; playerId: PlayerId; cardId: CardId; amount: number }
  | { type: "spellPlayed"; playerId: PlayerId; cardId: CardId }
  | { type: "spellResolved"; playerId: PlayerId; cardId: CardId }
  | { type: "spellCountered"; playerId: PlayerId; cardId: CardId }
  | { type: "priorityPassed"; playerId: PlayerId }
  | { type: "abilityTriggered"; playerId: PlayerId; cardId: CardId }
  | { type: "triggerResolved"; playerId: PlayerId; cardId: CardId }
  | { type: "decisionRequired"; playerId: PlayerId; kind: string }
  | { type: "targetsChosen"; playerId: PlayerId; targets: CardId[] }
  | { type: "abilityDeclined"; playerId: PlayerId; cardId: CardId }
  /** The amount here is the snapshotted one (R477.3.b), not what was asked for. */
  | {
      type: "mightModified";
      playerId: PlayerId;
      cardId: CardId;
      amount: number;
      duration: Duration;
    }
  | {
      type: "keywordGranted";
      playerId: PlayerId;
      cardId: CardId;
      keyword: Keyword;
      duration: Duration;
    }
  | { type: "modifiersExpired"; duration: Duration }
  | {
      type: "controlTaken";
      playerId: PlayerId;
      cardId: CardId;
      duration: Duration;
    }
  | {
      type: "tokenCreated";
      playerId: PlayerId;
      cardId: CardId;
      token: TokenKind;
    };

export interface Progress {
  state: GameState;
  events: GameEvent[];
}
