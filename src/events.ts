import type {
  CardId,
  Cost,
  Domain,
  GameState,
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
  | { type: "abilityDeclined"; playerId: PlayerId; cardId: CardId };

export interface Progress {
  state: GameState;
  events: GameEvent[];
}
