import type { RejectionReason } from "../actions.js";

/**
 * A refusal, in words a player can act on.
 *
 * The engine's reasons are named for the rule they enforce, which is right for
 * the engine and useless at the table: "decisionPending" tells you nothing
 * about what to do next. This is the only place they are translated, and the
 * mapping is exhaustive so a new reason cannot quietly reach a player as a
 * camel-case identifier.
 *
 * Three of these come up constantly once more than two people are playing,
 * because the server is authoritative and two players clicking at the same
 * moment is normal: the second one's move arrives against a board that has
 * already moved on. Those say so plainly rather than sounding like a fault.
 */
const SAID: Record<RejectionReason, string> = {
  // The three that a shared game produces on its own.
  decisionPending: "Someone is being asked to choose — this has to wait.",
  notYourPriority: "It is not your window to act yet.",
  notYourFocus: "Someone else has Focus in this showdown.",

  // Timing.
  notYourTurn: "It is not your turn.",
  wrongPhase: "Not during this phase.",
  wrongTiming:
    "This cannot be played now — it needs [Action] or [Reaction] timing.",
  notOpenState: "Not while this is resolving.",
  showdownInProgress: "Not during a showdown.",
  noShowdown: "There is no showdown or chain to act on.",
  gameOver: "The game is over.",

  // Decisions.
  noDecision: "There is nothing to answer.",
  notYourDecision: "That choice belongs to another player.",
  wrongTargetCount: "That is the wrong number of choices.",
  invalidTarget: "That is not one of the options.",
  invalidMode: "That is not one of this card's modes.",
  wrongModeCount: "Choose the right number of modes.",

  // Costs.
  cannotAffordCost: "Not enough energy or power.",
  cannotPayAbilityCost: "That ability's cost cannot be paid right now.",
  noAdditionalCost: "This card has no optional additional cost to pay.",
  wrongCostChoiceCount: "That cost needs a different number of choices.",

  // The board.
  cannotMove: "Something is stopping this unit from moving.",
  cannotPlay: "Something in play forbids this.",
  invalidDestination: "It cannot go there.",
  alreadyThere: "It is already there.",
  alreadyExhausted: "It is exhausted.",
  battlefieldNotControlled: "You do not control that battlefield.",
  facedownZoneOccupied: "There is already a card hidden there.",
  notAPermanent: "That is not something that can be moved.",
  notOnBoard: "That is not on the board.",
  sourceNotControlled: "You do not control that.",

  // Zones and cards.
  notInHand: "That card is not somewhere you can play it from.",
  cardNotFound: "That card is not in this game.",
  wrongCardType: "That is the wrong kind of card for this.",
  notHidden: "That card is not hidden at a battlefield.",
  deckEmpty: "Your deck is empty.",
  runeDeckEmpty: "Your rune deck is empty.",
  runeNotFound: "That rune is not in this game.",
  runeNotControlled: "That is not your rune.",
  runeAlreadyExhausted: "That rune is already exhausted.",
  abilityNotFound: "That ability is not there.",
};

/**
 * Whether a refusal is the ordinary consequence of a shared board rather than
 * a mistake — worth showing more quietly, since nobody did anything wrong.
 */
const RACES: ReadonlySet<string> = new Set([
  "decisionPending",
  "notYourPriority",
  "notYourFocus",
  "notYourTurn",
]);

export interface Refusal {
  text: string;
  /** True when the move was simply too early, not wrong. */
  race: boolean;
}

export function explain(reason: string | null): Refusal | null {
  if (reason === null) return null;
  const said = SAID[reason as RejectionReason];
  return {
    // A reason with no translation still has to reach the player, because a
    // silent refusal is worse than an ugly one.
    text: said ?? reason,
    race: RACES.has(reason),
  };
}
