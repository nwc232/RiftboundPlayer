import type { Ability } from "./abilities.js";
import type { DelayedTiming, Duration } from "./layers.js";
import type { TokenKind } from "./tokens.js";
import type {
  CardId,
  Cost,
  Designation,
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
  /**
   * R464.2.c.3 — a unit gains the Attacker or Defender designation. R464.2.e
   * makes this its own trigger moment ("Add items to the Combat Chain if
   * establishing Attacker and Defender has caused Triggered Abilities to become
   * Pending"), which is what "when I attack" and "when I defend" watch.
   */
  | {
      type: "designated";
      playerId: PlayerId;
      cardId: CardId;
      designation: Designation;
    }
  /**
   * R466.3 — the Combat Result, determined in its own step after the Combat
   * Cleanup's heal and recall. `winner`/`loser` are null on R466.3.d's "No
   * Result", which is what a repelled attack produces.
   */
  | {
      type: "combatResolved";
      battlefieldId: CardId;
      winner: PlayerId | null;
      loser: PlayerId | null;
    }
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
  /** R730.1 — XP is a plain number on the player, and public (R729.2). */
  | { type: "xpGained"; playerId: PlayerId; amount: number }
  /** R431 — drew from an empty deck; trash recycled, opponent gains a point. */
  | { type: "burnedOut"; playerId: PlayerId }
  | { type: "mulliganed"; playerId: PlayerId; count: number }
  /**
   * R421 — a card placed facedown at a battlefield. R107.3.f makes the zone
   * public but its contents private, so a per-player view of the event stream
   * has to withhold `cardId` from the opponent.
   */
  | {
      type: "cardHidden";
      playerId: PlayerId;
      cardId: CardId;
      battlefieldId: CardId;
    }
  /** R323.7 / R107.3.d — losing the battlefield trashes what was hidden there. */
  | {
      type: "facedownRemoved";
      playerId: PlayerId;
      cardId: CardId;
      battlefieldId: CardId;
    }
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
      /**
       * Its rules text as it stood, which R808.1.d.3 also says to note. A copy
       * effect is keyed to the permanent, so once that is gone the card reads
       * as printed again — and a Reflection's printed text is blank.
       */
      abilities: Ability[];
    }
  | { type: "unitRecalled"; playerId: PlayerId; cardId: CardId }
  | { type: "returnedToHand"; playerId: PlayerId; cardId: CardId }
  | { type: "banished"; playerId: PlayerId; cardId: CardId }
  | { type: "buffed"; playerId: PlayerId; cardId: CardId }
  | { type: "stunned"; playerId: PlayerId; cardId: CardId }
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
      type: "effectScheduled";
      playerId: PlayerId;
      cardId: CardId;
      at: DelayedTiming;
    }
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
