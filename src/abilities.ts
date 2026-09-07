import { closedToOutsiders } from "./showdown.js";
import {
  addCosts,
  addEnergy as creditEnergy,
  addPower as creditPower,
  spend,
} from "./cost.js";
import type { GameEvent } from "./events.js";
import type {
  CardId,
  CardType,
  Cost,
  Domain,
  GameState,
  Keyword,
  Location,
  PlayerId,
  PlaySource,
  PaymentRestriction,
  PowerCount,
  PlayerState,
} from "./state.js";
import { leaveChain } from "./chain.js";
import { killUnits } from "./combat.js";
import { isSeated, opponentsOf, ownerOf, playedBy, sameLocation, seatOf, turnOrderFrom } from "./state.js";
import { burnOut, drawCards } from "./draw.js";
import { controllerOf, mightOf, restricted } from "./layers.js";
import { tokenCard } from "./tokens.js";
import type { TokenKind } from "./tokens.js";
import type {
  DelayedTiming,
  Duration,
  Modification,
  PassiveCondition,
  PassiveScope,
} from "./layers.js";
import type { TriggeredAbility } from "./triggers.js";
import { ambiguousDamage, replaceDamage } from "./replacements.js";
import type { Targeting, TargetFilter } from "./decisions.js";
import type { PlayPermission } from "./play.js";
import type { CostModifier } from "./costing.js";
import type { DeathReplacement, EntryReplacement } from "./replacements.js";
import { holds } from "./conditions.js";
import { cannotBeCountered } from "./restrictions.js";
import type { PendingDecision } from "./decisions.js";
import type { Condition } from "./conditions.js";
import { channelRunes } from "./channel.js";

/**
 * The vocabulary of what an effect can say. No behaviour lives here — these are
 * descriptions that `execute` turns into state changes. Keeping effects as data
 * is what lets other cards read and rewrite them before they run.
 */
export type Effect =
  /**
   * R160 — [Add]. Five cards add resources that are not fully general: "use
   * only to play spells", "spend this Energy only during showdowns". The
   * restriction travels with the resources into their own bucket, so it is a
   * property of what was added rather than of the pool.
   */
  | { op: "addEnergy"; amount: number; restriction?: PaymentRestriction }
  | {
      op: "addPower";
      domain: Domain | "selfDomain";
      amount: number;
      restriction?: PaymentRestriction;
    }
  /** `targetIndex` picks from the choices made when the item was played. */
  | { op: "dealDamage"; amount: number; targetIndex: number }
  /** `targetIndex` names a chosen *player* — "each player draws 1". */
  | { op: "draw"; count: number; targetIndex?: number }
  /**
   * R359.3.d — a countered spell goes to its owner's trash. Abandon returns
   * it to their hand instead, which is a redirect on the way off the chain
   * rather than a different kind of counter — the same shape [Flow]'s banish
   * takes (R829.1.b.1).
   */
  | { op: "counterSpell"; targetIndex: number; to?: "hand" }
  /**
   * R432.1 — modulate a target's Might for a duration. `min`/`max` are
   * R477.3.b's limitation: applied once, at this moment, and remembered at the
   * limited level. `double` computes the amount from current Might instead.
   */
  | {
      op: "modifyMight";
      amount?: number;
      double?: true;
      duration: Duration;
      min?: number;
      max?: number;
      targetIndex: number;
    }
  /**
   * Thousand-Tailed Watcher — "give enemy units -3 [M] this turn, to a minimum
   * of 1"; Moonfall — "give enemy units *there* -2 [M] this turn".
   *
   * R355.5.a is why this is not targeting: "this does not include cards that
   * affect one or more Game Objects based on criteria". Nothing is chosen, so
   * nothing is a target — which also means [Deflect] does not tax it and a
   * unit that can't be chosen is still caught.
   */
  | {
      op: "modifyMightEach";
      /** Relative to the effect's controller. */
      who: "enemy" | "friendly";
      /** Confined to the location a chosen battlefield names, when given. */
      atTargetIndex?: number;
      amount: number;
      duration: Duration;
      /** R477.3.b's limitation — "to a minimum of 1". */
      min?: number;
    }
  /** Fortified Position — "It gains [Shield 2] this combat." */
  | {
      op: "grantKeywordFor";
      keyword: Keyword;
      value?: number;
      duration: Duration;
      targetIndex: number;
    }
  /**
   * R180/R184 — create a token on the board. R184.1 lets the creating effect
   * override the default entering state, and R184.2 restrict its location.
   */
  | {
      op: "createToken";
      token: TokenKind;
      count: number;
      /** R184.1 — units default to entering exhausted (R185.2.d). */
      ready?: true;
      /**
       * Where it enters; defaults to the controller's base.
       *
       * `eventLocation` is Deceiver's "when you conquer or hold … play a
       * Reflection token **there**". "There" is the battlefield the event
       * named, which is not `sourceLocation`: the source is a Legend, and
       * R107.4.b makes the Legend Zone no location at all.
       */
      to?: "base" | "sourceLocation" | "eventLocation";
      /** R477.1.b — becomes a copy of the chosen target as it enters. */
      copyOfTarget?: number;
      /**
       * Keeper of Masks — "play two Reflection unit tokens here. **They become
       * copies of me**." The same trait-layer copy, of a source that was never
       * chosen and so is nowhere in `targets`.
       */
      copyOfSource?: true;
      /** R184.3 — the creating effect may grant abilities to the token. */
      grants?: Keyword[];
    }
  /**
   * Possession — "Take control of it and recall it." Control is a trait-layer
   * effect (R477.1.a), so a durational one (Hostile Takeover's "lose control
   * at end of turn") just expires rather than needing an undo.
   */
  | {
      op: "takeControl";
      duration: Duration;
      /** R454 — recall is not a move; it sends the unit to its base. */
      recall?: true;
      targetIndex: number;
    }
  /**
   * R317.1.a — schedule an effect for a later moment. Distinct from a duration:
   * a modifier stops applying, a delayed effect *fires*. Hostile Takeover's
   * "lose control of that unit and recall it at end of turn" needs both.
   */
  | { op: "delay"; at: DelayedTiming; effect: Effect }
  /**
   * Scuttle Crab — "You can look at their facedown cards this turn." R424.2.b
   * keeps this out of R424 entirely: showing Private information "does not
   * count as revealing and does not trigger any effects that trigger when
   * cards are revealed". So it grants the *looking* and nothing else.
   *
   * In 1v1 "their" is the only opponent, so the grant is simply "this player
   * may look at facedown cards". Written up as an approximation for the day a
   * format has more than two players.
   */
  | { op: "seeFacedown"; duration: Duration; targetIndex?: number }
  /** R454 — a recall sends a unit to its controller's base and is not a move. */
  | { op: "recall"; targetIndex: number }
  /** R816 — what [Temporary] does. Kills the ability's own source. */
  | { op: "killSelf" }
  /**
   * Brittle Steel — "Kill a gear"; Rocket Barrage's second mode. R412's kill,
   * pointed at something chosen rather than at the source, so R372's death
   * replacements apply exactly as they do to any other death.
   */
  | { op: "kill"; targetIndex: number }
  /** Gust, Rebuke, Star-Crossed — back to its *owner's* hand (R56). */
  | { op: "returnToHand"; targetIndex: number }
  /** R415 — readying an already-ready unit does nothing (R415.1.c). */
  | { op: "ready"; targetIndex: number }
  /** R426 — place a Buff counter, worth +1 Might (R703). At most one. */
  | { op: "buff"; targetIndex: number }
  /** R427 — straight to Banishment, and not a kill or a discard (R427.2.a/b). */
  | { op: "banish"; targetIndex: number }
  /** R423 — a binary status, not a kill. */
  | { op: "stun"; targetIndex: number }
  /** R420 — moving as an *effect*, which is a Limited Action, not a move. */
  /**
   * R420 — moving as an *effect*, which is a Limited Action rather than a move.
   *
   * `chosenBattlefield` is Moonfall's "move up to one enemy unit to **that**
   * battlefield" — the destination is one of the spell's own choices, made at
   * R355.4 alongside its targets, so it arrives as another index rather than
   * as a place the effect works out for itself.
   */
  | {
      op: "moveUnit";
      targetIndex: number;
      /**
       * `eventLocation` is "that battlefield" — the one the inciting event
       * named, noted when the condition was fulfilled (R359.3.f.3). Distinct
       * from `sourceLocation`, which is wherever the source is *now* and is
       * therefore gone if it has left the board.
       */
      to: "sourceLocation" | "eventLocation" | "base" | "chosenBattlefield";
      /** Which chosen battlefield, for `chosenBattlefield`. */
      atTargetIndex?: number;
    }
  /**
   * R383.2.a.1's second half — a conditional statement that is *not*
   * immediately after the trigger condition is part of the effect, so it is
   * asked here, on resolution. Loose Cannon's "draw 1 if you have one or fewer
   * cards in your hand" is this; Sona's "if I'm at a battlefield" is not.
   */
  | { op: "conditional"; test: Condition; then: Effect; otherwise?: Effect }
  /**
   * Hwei — "draw 1, then discard 1. Then, do the following based on the
   * discarded card's type"; Diana, Lunari — "reveal the top card of your Main
   * Deck. If it's a spell, draw it."
   *
   * One op rather than two because the branch is the same question either way:
   * a card's type decides what happens next. The card has to be *found* first,
   * and `of` is which of the two ways this card does that — the arms cannot
   * name a card the effect has not produced yet.
   */
  | {
      op: "branchOnCardType";
      /** R422's discard, or R424's reveal of the top of the Main Deck. */
      of: "discardOne" | "revealTop";
      /** Nothing happens for a type with no arm, which is R383.2's default. */
      arms: Partial<Record<CardType, Effect>>;
    }
  /**
   * Fizz, Trickster — "you may play a spell from your trash with Energy cost
   * no more than [3], ignoring its Energy cost. Recycle that spell after you
   * play it."
   *
   * Grants the permission rather than performing the play. The card reads as
   * one thing happening now; this makes it a thing the player may then do,
   * which is what lets the spell go through R354's actual steps and choose its
   * own targets. Written up as a timing deviation.
   */
  | {
      op: "grantPlayFromTrash";
      cardType?: CardType;
      maxEnergy?: number;
      waiveEnergy?: true;
      recycleOnLeave?: true;
      duration: Duration;
    }
  /**
   * Hard Bargain — "Counter a spell **unless its controller pays [2]**".
   *
   * The only effect in the pool that asks the *opponent* a question while it
   * resolves. R320.1's decision machinery already names the player it is
   * addressed to, so this needed no new mechanism — just the first card to use
   * it that way.
   */
  | { op: "counterUnlessPaid"; targetIndex: number; cost: Cost }
  /** The continuation of `counterUnlessPaid`, once its controller has answered. */
  | { op: "resolveUnlessPaid"; targetId: CardId; cost: Cost }
  /** R730.1 — Kha'Zix, Mutating Horror's "gain 2 XP". */
  | { op: "gainXP"; amount: number }
  /**
   * "Choose an opponent. They score 1 point." R470 makes scoring the usual
   * *consequence* of holding a battlefield; a handful of cards score directly,
   * and R471.1's near-victory restriction does not apply to them because they
   * are not conquering.
   *
   * `targetIndex` points at a chosen *player* (R133), which reaches the effect
   * through `context.targets` exactly as a chosen card does.
   */
  | { op: "scorePoint"; amount: number; targetIndex?: number }
  /**
   * "Each player draws 1", "each opponent reveals the top card of their Main
   * Deck". R133 makes each player a subject in turn, so this runs `each` once
   * per player with that player supplied as its chosen one.
   *
   * The inner effect reads it at `targetIndex`, which is appended to whatever
   * targets the outer effect already chose — so "each player discards 1" is
   * `forEachPlayer(discard(1, 0))` with nothing else chosen.
   */
  | {
      op: "forEachPlayer";
      /** Relative to the effect's controller. */
      who: "each" | "eachOpponent";
      each: Effect;
    }
  /**
   * A continuation, not card vocabulary: what `forEachPlayer` becomes when one
   * player's step stopped to ask something. It holds the players who have not
   * had their turn at it yet.
   *
   * R303.2.a is why the order is fixed rather than simultaneous — "Turn Order
   * is referenced to organize the sequence of actions" — and King's Edict,
   * Party Favors, Promising Future and Whirlwind all open with "Starting with
   * the next player", which is that sequence written on a card.
   */
  | {
      op: "forEachPlayerRest";
      each: Effect;
      players: PlayerId[];
      /**
       * How many targets the *outer* effect had. Each player is appended to
       * the list as their step runs, so resuming has to drop the last one's
       * before appending the next.
       */
      baseTargets: number;
    }
  /**
   * R433 — Switcheroo's "Swap the Might of two units at the same battlefield
   * this turn." R433.1.b: find the difference and apply it as an increase to
   * the lower and a decrease to the higher, for the stated duration.
   */
  | { op: "swapMight"; duration: Duration; targetIndex: number; otherIndex: number }
  /** Tideturner — "Move me to its location and it to my original location." */
  | { op: "swapLocations"; targetIndex: number }
  /** Rampage — "They deal damage equal to their Mights to each other." */
  | { op: "mutualDamage"; targetIndex: number; otherIndex: number }
  /** Targon's Peak — "ready 2 runes at the end of this turn". */
  | { op: "readyRunes"; count: number }
  /** Threshold of the Gray — "the attacker and defender each [Add] [1]". */
  | { op: "addEnergyToEach"; amount: number }
  /** Seat of Power — "draw 1 for each other battlefield you or allies control". */
  | { op: "drawPerBattlefield"; excludeSource?: true }
  /** Vex, Apathetic — "They can't move it this turn." */
  | { op: "restrictMovement"; duration: Duration; targetIndex: number }
  /**
   * Brynhir Thundersong — "opponents can't play cards this turn"; Lilting
   * Lullaby — "its controller can't play spells this turn".
   *
   * The same restriction the printed ones express, with a *duration* — which
   * is why it goes on the modifier list rather than being read off a card:
   * R317.2.c is what ends it. `targetIndex` names the restricted player, whom
   * R133 makes a Game Object like any other, so `forEachPlayer` supplies one
   * per opponent for Brynhir and a chosen one for Lilting Lullaby.
   */
  | {
      op: "restrictPlayer";
      restriction: Omit<BoardRestriction, "affects">;
      duration: Duration;
      targetIndex: number;
    }
  /**
   * Thrill of the Hunt — "Banish a friendly unit, then its owner plays it to
   * any battlefield, ignoring its cost." Two choices: the unit, then where it
   * comes back. R356.1.b.1 sets both base costs to zero.
   */
  | { op: "banishThenPlay"; targetIndex: number; destinationIndex: number }
  /** R434 / R818.1.c.2 — "[Cost]: Attach this gear to a unit you control." */
  | { op: "attachSelf"; targetIndex: number }
  /**
   * R821 — [Weaponmaster]'s "you may [Equip] one of your Equipment to me for
   * [A] less, even if it's already attached". The mirror of `attachSelf`: the
   * chosen card attaches to the *source*, not the other way round.
   *
   * R821.1.c.6 — "The Equip ability is not activated this way", so this pays
   * that ability's cost directly rather than going through the chain, and the
   * unit being equipped is not *chosen* (no Deflect tax, R809).
   */
  | { op: "equipChosen"; targetIndex: number; reduce: Cost }
  /**
   * R441 — the Empower game action, which R827.1.b has the [Empower] keyword
   * perform on its own source. R441.1.b/c: Empowering something already
   * Empowered does nothing at all, rather than being illegal.
   */
  | { op: "empowerSelf" }
  /**
   * R442 — Disempowering "is the act of removing the Empowered status".
   * R442.1.a.1: doing it to something that is not Empowered "will do nothing",
   * so this is a no-op rather than a failure. Omit `targetIndex` for "this".
   */
  | { op: "disempower"; targetIndex?: number }
  /**
   * Stacked Deck — "Look at the top 3 cards of your Main Deck. Put 1 into your
   * hand and recycle the rest." The choice is made on resolution, not at
   * finalization, so this enqueues a task the queue can suspend on.
   */
  | { op: "lookAtTop"; count: number; keep: number }
  /**
   * R436 — "Predict X". Look at X from the top of your Main Deck, Recycle any
   * number of them, and put the rest back on top in any order. Distinct from
   * `lookAtTop`: nothing is drawn, the count kept is the player's choice
   * rather than fixed, and R436.4.a exempts it from Burn Out when the deck is
   * short. [Vision] (R817) is this with X = 1.
   */
  | { op: "predict"; count: number }
  /**
   * R416 — "Recycle N cards from your hand": the chosen cards go to the bottom
   * of the Main Deck. Distinct from `predict`, which recycles from the *top of
   * the deck*, and from `takeRevealed`, which is a continuation.
   *
   * R416 is a game action a card names outright, and R383's "when you recycle
   * one or more cards" watches for it, so it emits `cardRecycled` per card the
   * same way every other route to the bottom of the deck does.
   */
  | { op: "recycleFromHand"; count: number }
  /**
   * R422 — "Discard X": from a hand straight to that player's trash, "without
   * activating or executing its normal rules text" (R422.1.a).
   *
   * R422.1.a gives the choice to the player *doing* the discarding, not to
   * whoever wrote the effect — "Choose a player. They discard 1" asks them.
   * R422.4 makes an effect discard as many as possible and ignore the rest,
   * which is why a short hand is not a failure here (R422.3's cost is where it
   * is, and that is a different rule).
   */
  | { op: "discard"; count: number; targetIndex?: number }
  /** A continuation: `discard` once that player has said which cards. */
  | { op: "takeDiscarded"; player: PlayerId; from: CardId[] }
  /**
   * R440 — "Burn X": from the top of a Main Deck to that player's trash.
   * R440.4 runs it into Burn Out when the deck is short — "they burn that many
   * cards, burn out and then burn the rest".
   */
  | { op: "burn"; count: number; targetIndex?: number }
  /**
   * R424 — "Reveal cards from [zone]". R424.1.a.2 is what makes this its own
   * op rather than a move: "cards remain in the zone they are being Revealed
   * from", so nothing changes hands. All it does is make them known, which is
   * what "if you revealed a unit" then asks about.
   *
   * R424.3.a — omitting the count reveals the whole zone, which is what
   * "reveal your hand" means.
   */
  | {
      op: "reveal";
      from: "mainDeck" | "hand";
      count?: number;
      /** Whose zone. Omitted is the effect's own controller. */
      targetIndex?: number;
    }
  /**
   * A continuation: `recycleFromHand` once the player has said which. They
   * arrive on `context.answer`.
   */
  | { op: "takeRecycled"; from: CardId[] }
  /**
   * A continuation, not card vocabulary: `predict` once the player has said
   * which of the revealed cards to Recycle. They arrive on `context.answer`.
   */
  | { op: "takePredicted"; revealed: CardId[] }
  /**
   * A continuation: R436.1.a's "in any order" for the cards a Predict did not
   * Recycle. `context.answer` is the order, top first.
   */
  | { op: "orderPredicted"; cards: CardId[] }
  /**
   * Sabotage — "Choose an opponent. They reveal their hand. Choose a non-unit
   * card from it, and recycle that card." Same shape: the choice comes after
   * the reveal.
   */
  | {
      op: "recycleFromOpponentHand";
      exclude?: "unit";
      /**
       * Sabotage opens "Choose an opponent." — a real choice once a mode
       * seats more than one, and a forced one in a Duel. This indexes
       * `context.targets`; absent means the sole opponent, which is what the
       * two-player game always had.
       */
      playerIndex?: number;
    }
  /**
   * A continuation, not card vocabulary: what `lookAtTop` and
   * `recycleFromOpponentHand` become once the player has answered. It reads
   * the chosen cards out of `context.answer`.
   */
  | {
      op: "takeRevealed";
      from: "mainDeck" | "opponentHand";
      revealed: CardId[];
      /**
       * Which opponent's hand, for the `opponentHand` form. A continuation
       * the engine writes rather than card text, so the player it already
       * settled on is carried here rather than re-derived after the pause.
       */
      player?: PlayerId;
    }
  /**
   * A continuation: damage whose R372 ordering has been asked about. The
   * chosen order arrives on `context.answer`.
   */
  | { op: "applyDamage"; targetId: CardId; amount: number }
  /** Astral Heron — "your next card costs [2][A][A] less". */
  | { op: "discountNextCard"; reduce: Cost }
  /** Lotus Trap — "Double all damage that would be dealt to it this turn." */
  | { op: "scaleDamage"; targetIndex: number; factor: number; duration: Duration }
  /**
   * R437 — "Prevent the next X [source] damage that would be dealt to a
   * [unit] this turn." Unyielding Spirit prevents all of it, from spells and
   * abilities, for everyone.
   */
  | {
      op: "preventDamage";
      amount: number | "all";
      from: "any" | "spellOrAbility";
      duration: Duration;
      /** Absent means every unit, which is R437.1.b.1.b's "All". */
      targetIndex?: number;
    }
  /** R142 — clear marked damage. Soraka's "instead heal it". */
  | { op: "heal"; targetIndex: number }
  /** R414 — the other half of "heal it, **exhaust it**, and recall it". */
  | { op: "exhaust"; targetIndex: number }
  /**
   * R431.2.c — the point a Burn Out gives away. Not card vocabulary: the
   * engine writes it when a deck runs dry, and the burned-out player's answer
   * says which opponent gains it. With one opponent it never has to ask.
   */
  | { op: "burnOutPoint" }
  /**
   * R194.3.a — "Some game modes or card effects may alter the Victory Score."
   * Aspirant's Climb: "Increase the points needed to win the game by 1."
   */
  | { op: "raiseVictoryScore"; by: number }
  /**
   * R716 — the inverse of attaching. Angle Shot detaches an Equipment from a
   * unit; Strike Down and Veiled Temple detach one they have just used. The
   * Equipment stays on the board and R149.3's cleanup takes it home from a
   * battlefield, because an unattached gear does not belong at one.
   */
  | { op: "detach"; targetIndex: number }
  /**
   * R430.4.b — "Players may also Channel runes when Game Effects direct them
   * to do so." R430.5 gives the printed form: "Channel X rune(s)", optionally
   * followed by conditions — and one of those conditions is common enough to
   * be part of the op rather than a separate test, because nothing else can
   * see how many arrived.
   */
  | {
      op: "channel";
      count: number;
      /** R430.2 — "Channel 1 rune exhausted"; R430.2.a defaults to readied. */
      exhausted?: true;
      /**
       * R430.3 left the player short. "Channel 2 runes exhausted. If you
       * couldn't channel 2 runes this way, draw 1." — Catalyst of Aeons.
       */
      ifShort?: Effect;
    }
  | { op: "seq"; steps: Effect[] };

export type AbilityCost =
  | { kind: "exhaustSelf" }
  | { kind: "recycleSelf" }
  /** Emperor's Dais — "you may pay [1] and…". R383.3.b makes it a base cost. */
  | { kind: "pay"; cost: Cost }
  /**
   * R728–733 — "Spend 3 XP, [exhaust]: Draw 1." XP is a plain number on the
   * player, so spending it is a cost like any other: unaffordable if the
   * player is short, and gone once paid.
   */
  | { kind: "spendXP"; amount: number }
  /**
   * R701–705 — "Spend my buff: give me +4 [M] this turn." A buff is a binary
   * status on the permanent, so spending it is removing it.
   */
  | { kind: "spendBuff" }
  /**
   * R442 — "Disempower me, [1]: …". R442.1.a means an unempowered source
   * cannot pay it, which as a *cost* is a refusal rather than a no-op.
   */
  | { kind: "disempowerSelf" }
  /**
   * A cost that names something to *choose*: "kill a friendly unit", "you may
   * exhaust a friendly unit", "spend a buff", "discard 1".
   *
   * R355.1 puts every Relevant Choice at the *start* of playing a card, which
   * is the moment the action is submitted — so the choice rides in the action
   * beside `targets` rather than suspending the play to ask. Nothing about
   * finalization has to stop, which is why this needed no new machinery: a
   * chosen card reaches `payAbilityCost` the way a target reaches an effect.
   *
   * R422.3 — "When Discarding is listed as a Cost, then the Action must be
   * able to be completed for the cost to be paid." Unlike R422.4's effect,
   * which discards as many as it can, a cost of Discard 2 with one card in
   * hand simply cannot be paid. The same holds for every verb here.
   */
  | {
      kind: "chosen";
      /**
       * R412 Kill, R414 Exhaust, R422 Discard, R56 return to owner's hand, and
       * R701–705's spending of a Buff. The verb also carries its own
       * requirement — R414.1.b will not exhaust what is already exhausted, and
       * an unbuffed unit has no buff to spend — which is the game action's
       * business rather than the filter's.
       */
      does: "kill" | "exhaust" | "spendBuff" | "returnToHand" | "discard" | "recycle";
      /**
       * What may be chosen. Omitted means the controller's hand, which is a
       * different search from the board and the only pool a Discard uses.
       */
      from?: TargetFilter;
      /**
       * Last Rites — "Recycle 2 cards **from your trash**". A third pool: not
       * the board, which `from` searches, and not the hand, which is the
       * default. R416.1 sends them to the bottom of the Main Deck.
       */
      fromTrash?: true;
      /**
       * "Kill *any number of* friendly units" — Commander Ledros, Kraken
       * Hunter. R355.8 makes zero a legal answer to "any number", so this is
       * not the same as a count the player happens to be able to meet.
       */
      count: number | "any";
    }
  /**
   * "You may exhaust your legend as an additional cost." R107.4.c — the
   * Champion Legend has no permanent, so its exhausted state lives on the
   * player, which is also why this is not `exhaustSelf` on another source.
   */
  | { kind: "exhaustLegend" };

/** Recorded from the card, but not yet enforced — that needs the chain. */
export type AbilityTiming = "reaction" | "action" | "default";

/**
 * One arm of a "Choose one —". A mode is an effect *plus its own choices*:
 * Rocket Barrage's two are "deal 4 to a unit in a base" and "kill a gear",
 * which want different things, so the targeting travels with the mode rather
 * than sitting on the ability.
 */
export interface Mode {
  effect: Effect;
  targeting?: Targeting;
}

export interface ActivatedAbility {
  kind: "activated";
  timing: AbilityTiming;
  costs: AbilityCost[];
  /** Ignored when `modes` is present — the chosen mode supplies it instead. */
  effect: Effect;
  /**
   * "Choose one — A. [or] B." R820.2 makes the choice one of the Relevant
   * Choices made as the card is played, alongside targets, not something asked
   * on resolution.
   */
  modes?: Mode[];
  /**
   * Curtain Call — "Choose one **you haven't already chosen**". Only bites
   * when a [Repeat] gives one play more than one execution (R820.2.a).
   */
  distinctModes?: true;
  /**
   * R355.5 — a spell's own choices, made as it is played. Absent means the
   * ability chooses nothing, which is not the same as choosing zero things:
   * R355.8 only demands valid choices exist for what is actually asked for.
   */
  targeting?: Targeting;
  /**
   * R827.1.c.1 — "Play only if not Empowered." A printed restriction on
   * *playing* the ability rather than on what it does, so `legalActions` stops
   * offering it once it no longer holds.
   */
  when?: Condition;
  /**
   * "Use only once per turn." R383.3.e keeps the same kind of tally for
   * triggered abilities; this is the activated half, counted against the same
   * `triggeredThisTurn` record and cleared as each turn opens.
   */
  usesPerTurn?: number;
}

/**
 * R477 — a continuous effect that modifies characteristics rather than doing
 * anything when it resolves. Passives never go on the chain; they are read
 * live by the layer pipeline, so removing the source removes the effect.
 */
export interface PassiveAbility {
  kind: "passive";
  scope: PassiveScope;
  condition?: PassiveCondition;
  /**
   * Ambessa — "I can't be dealt damage *unless* I'm in combat". The rules
   * write several continuous effects as an exception rather than a condition,
   * and negating one is not the same as stating the opposite: "unless I'm in
   * combat" and "while I'm not attacking" differ for a defender.
   */
  unless?: PassiveCondition;
  modification: Modification;
}

/**
 * R355.2.b / R822.1.d — rules text that widens where a unit may be played.
 * Separate from PassiveAbility because it is read off a card in hand, which
 * the R477 layer pipeline never sees.
 */
export interface PlayPermissionAbility {
  kind: "playPermission";
  permission: PlayPermission;
}

/**
 * R812 — Noxus Hopeful's "[Legion] — I cost [2] less". Like a play permission,
 * this is read off a card in hand and so never reaches the R477 pipeline.
 */
export interface CostModifierAbility extends CostModifier {
  kind: "costModifier";
}

/**
 * R356.2 — Pyke, Dockside Butcher's "You may pay [Fury] as an additional cost
 * to play me"; Rampage's "As you play this, you may pay [Body]…". Read off the
 * card in hand, like the other two non-resolving ability kinds.
 */
export interface AdditionalCostAbility {
  kind: "additionalCost";
  /** R356.2.b.1 — the word "may". Absent makes it mandatory (R356.2.a.1). */
  optional?: true;
  /**
   * R356.2 does not say "resources": the pool prints "you may discard 1", "you
   * may spend 3 XP", "you may exhaust your legend" as additional costs. So this
   * is what an ability costs generally, like [Repeat]'s and [Flow]'s.
   */
  costs: AbilityCost[];
}

/**
 * R820 — "[Repeat] [Cost]". R820.1.d makes it short for "You may pay [Cost] as
 * an additional cost as you play this. If you do, execute the instructions of
 * this chain item one additional time during resolution."
 *
 * Its own ability kind rather than an `additionalCost` with a flag, because
 * R820.1.c.2 makes several of them independent of each other: Curtain Call
 * prints three, each payable on its own, and R820.1.c.3 caps each at one
 * payment. Which subset was paid is therefore the answer, not a count.
 *
 * R820.4 makes it a *characteristic*, so this entry is only how a card
 * declares its printed instances: `characteristicsOf` collects them into
 * `costKeywords`, where a granted one is indistinguishable from a printed one.
 */
export interface RepeatAbility {
  kind: "repeat";
  /**
   * R820.1.c.2 — "costs may include both resource costs and non-resource costs",
   * so this is a list of `AbilityCost` rather than a bare `Cost`. Square Up's
   * "[Repeat] — Discard 1" is the printed case.
   */
  costs: AbilityCost[];
}

/**
 * R829 — "[Flow] [Cost]". R829.1.b makes it short for "You may play this from
 * your trash for its flow cost. Then banish it."
 *
 * A passive that widens where the card may be played from, so it is read off
 * the card in hand — or rather, off the card in the *trash* — like the other
 * non-resolving kinds. R829.1.c.3 allows several with different costs, which
 * is why `playZonesFor` hands back a list.
 */
export interface FlowAbility {
  kind: "flow";
  /** R829.1.c.1 — an Alternate Cost: it replaces the base cost, not adds to it. */
  /**
   * R829.1.c.2 — "costs may include both resource costs and non-resource costs",
   * so this is a list of `AbilityCost` rather than a bare `Cost`. Square Up's
   * "[Repeat] — Discard 1" is the printed case.
   */
  costs: AbilityCost[];
}

/**
 * R827 — "[Empower] [Cost]". R827.1.c.1 makes it short for "[Cost]: Empower
 * this. Play only if not Empowered."
 *
 * Its own ability kind rather than a keyword, for the same reason [Repeat] and
 * [Flow] are: the value it carries is a `Cost`, and the layer system grants
 * keywords whose values are numbers. R827.3 makes several of them "equivalent
 * to multiple activated abilities", so a card may carry more than one.
 */
export interface EmpowerAbility {
  kind: "empower";
  /**
   * R827.1.c.2 — "costs may include both resource costs and non-resource costs",
   * so this is a list of `AbilityCost` rather than a bare `Cost`. Square Up's
   * "[Repeat] — Discard 1" is the printed case.
   */
  costs: AbilityCost[];
}

/**
 * R356.3 / R356.4 — an ability on the *board* that changes what *other* cards
 * cost, as opposed to `CostModifierAbility`, which a card carries about
 * itself. Helm of Suppression's "opponents' spells cost [1] more", Vaults of
 * Helia's "your non-token units cost [1] more to play this turn".
 *
 * It has to sit outside the layer pipeline for the same reason cost
 * modification does (ROADMAP §3b): the cards it reaches are in a hand, and
 * R711 reads anything off the board on printed values alone. So this is swept
 * from the board when a cost is asked for, rather than applied to a permanent.
 */
export interface CostAuraAbility {
  kind: "costAura";
  /** Whose cards it reaches, relative to the ability's own controller. */
  affects: "friendly" | "enemy" | "any";
  /** Narrowed to some of them. Absent reaches every card. */
  match?: {
    type?: CardType;
    keyword?: Keyword;
    /** Vaults of Helia — "your **non-token** units". */
    nonToken?: true;
  };
  /** R356.3 — applied before reductions, and never below zero. */
  increase?: Partial<Cost>;
  /** R356.4 — applied after increases. */
  reduce?: Partial<Cost>;
  /** Vex, Cheerless — "…less, **to a minimum of [1]**". */
  minimum?: Partial<Cost>;
  /** "While I'm in a showdown", "if this is [Empowered]". Absent means always. */
  when?: Condition;
}

/**
 * Syndra, Transcendent — "While I'm in a showdown, your spells have [Repeat]
 * [2][Chaos]." A board ability granting a *keyword* to cards that are not
 * permanents, which is the mirror of `CostAuraAbility` and exists for the same
 * reason: R711 reads anything off the board on printed values, so the board is
 * swept when the question is asked rather than the card being modified.
 *
 * Cost-valued keywords only. A plain keyword granted to a card in a hand has
 * no printed card asking for it.
 */
export interface KeywordAuraAbility {
  kind: "keywordAura";
  affects: "friendly" | "enemy" | "any";
  match?: { type?: CardType; nonToken?: true };
  keyword: "repeat" | "flow" | "empower";
  costs: AbilityCost[];
  when?: Condition;
}

/**
 * A restriction whose subject is *not* a permanent — a player, a battlefield,
 * or a spell on the chain. The mirror of `CostAuraAbility`, and off the layer
 * pipeline for the same reason: R711 reads anything off the board on printed
 * values, so the board is swept when the question is asked rather than the
 * subject being modified.
 *
 * The permanent-subject half lives in `layers.ts` as a `Restriction`, because
 * a permanent *is* in the pipeline. Ten cards are here and seven are there,
 * and the split is exactly R711's line.
 */
export interface BoardRestriction {
  what:
    /** Tianna Crownguard, Forgotten Monument. */
    | "score"
    /** Brynhir, Lilting Lullaby, Fallen Feline, Mageseeker Warden, Rockfall Path. */
    | "play"
    /** Mel, Newly Awakened — "your spells and abilities can't be countered". */
    | "beCountered"
    /**
     * Noxus Saboteur — "Your opponents' [Hidden] cards can't be revealed
     * here." R421.4 is the only thing in the game that reveals a facedown
     * card, so this forbids that and nothing else.
     */
    | "beRevealed";
  /**
   * Whose action it forbids, relative to this ability's own controller.
   * R190.6.d is why that matters for a battlefield: an uncontrolled one has no
   * "you", so an aura that names a side contributes nothing there — but
   * Rockfall Path's "Units can't be played here" names no side and applies
   * whoever holds it.
   */
  affects: "friendly" | "enemy" | "any";
  /** "…*here*" — only at the source's own battlefield. */
  here?: true;
  /** Fallen Feline — "…spells with that name"; Rockfall Path — "Units…". */
  match?: { type?: CardType; name?: string };
  /**
   * Mageseeker Warden — "opponents can only play units to *their base*", which
   * forbids everywhere else rather than everywhere.
   */
  exceptToBase?: true;
  /** Forgotten Monument — "…until their third turn". */
  untilTurn?: number;
}

export interface RestrictionAuraAbility extends BoardRestriction {
  kind: "restrictionAura";
  /** "While I'm at a battlefield", "[Empowered]". Absent means always. */
  when?: Condition;
}

/**
 * R369.3 — "I enter ready", and the conditional forms of it. Read off a card
 * in hand like the other non-resolving kinds, because it has to be known
 * before the permanent exists.
 */
export interface EntryReplacementAbility extends EntryReplacement {
  kind: "entryReplacement";
}

/**
 * R369 — a replacement effect that intercedes in another object's event.
 * Soraka, Wanderer: "If another unit you control here would die, if it has
 * less Might than me, instead heal it, exhaust it, and recall it."
 */
export interface ReplacementAbility extends DeathReplacement {
  kind: "replacement";
  /** Only deaths so far; damage is the next chokepoint. */
  on: "dies";
}

export type Ability =
  | ActivatedAbility
  | EntryReplacementAbility
  | ReplacementAbility
  | AdditionalCostAbility
  | CostAuraAbility
  | KeywordAuraAbility
  | RestrictionAuraAbility
  | RepeatAbility
  | FlowAbility
  | EmpowerAbility
  | TriggeredAbility
  | PassiveAbility
  | PlayPermissionAbility
  | CostModifierAbility;

/**
 * The property names an `Effect` uses to point into `context.targets`. Every op
 * that chooses something indexes it by one of these, which is what lets
 * `shiftTargets` be written once instead of as a case per op — and what keeps
 * it correct as ops are added. A new op that indexes targets under some other
 * name would silently escape it, so the convention is the contract.
 */
const TARGET_INDEX_FIELDS = ["targetIndex", "otherIndex", "destinationIndex"];

/**
 * The same effect, reading a later slice of `context.targets`.
 *
 * R820.2.a — "Choices made for the additional execution do not have to be the
 * same as the choices made for the initial execution." A repeated effect is
 * therefore not the same effect run twice: it is the same instructions aimed
 * at a second set of choices. Since abilities are data, that is a rewrite of
 * the indices rather than a second context, which is what lets the whole
 * repeat be expressed as one `seq` — pauses and all.
 */
/**
 * What an ability actually does and chooses, once its mode is known. A card
 * with no "Choose one —" has one implicit mode: its own effect and targeting.
 *
 * Everything downstream — finalization, `legalActions`, resolution — asks this
 * rather than reading `effect` directly, so a modal card is not a special case
 * at any of those sites.
 */
export function modeOf(
  ability: { effect: Effect; targeting?: Targeting; modes?: Mode[] },
  index = 0,
): Mode {
  const chosen = ability.modes?.[index];
  if (chosen !== undefined) return chosen;
  return {
    effect: ability.effect,
    ...(ability.targeting !== undefined ? { targeting: ability.targeting } : {}),
  };
}

export function shiftTargets<T>(effect: T, offset: number): T {
  if (offset === 0 || effect === null || typeof effect !== "object") {
    return effect;
  }
  if (Array.isArray(effect)) {
    return effect.map((each) => shiftTargets(each, offset)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(effect)) {
    out[key] =
      TARGET_INDEX_FIELDS.includes(key) && typeof value === "number"
        ? value + offset
        : shiftTargets(value, offset);
  }
  return out as T;
}

export interface EffectContext {
  controller: PlayerId;
  sourceId: CardId;
  /** Targets chosen while playing (R355.5). Empty for most abilities. */
  targets: CardId[];
  /**
   * Where the source is — or, if it has since died, where it was when the
   * ability triggered (R323.4). This is what "here" resolves against.
   */
  sourceLocation?: Location;
  /**
   * Where the *inciting event* happened, which is not always where the source
   * is. Deceiver's "when you conquer or hold … play a Reflection token
   * **there**" is triggered by a Legend, and R107.4.b makes the Legend Zone no
   * location at all — so "there" can only mean the battlefield the event
   * named. `sourceLocation` answers "here"; this answers "there".
   */
  eventLocation?: Location;
  /** R356.2.b — whether this play's optional additional cost was paid. */
  paidAdditionalCost?: boolean;
  /** Which zone a resolving spell was played from (R811.3). */
  playedFrom?: PlaySource;
  /**
   * The answer to the decision that paused this effect. Set by the queue when
   * the resumed effect runs, and read by the continuation op that asked.
   */
  answer?: CardId[];
}

/**
 * R321 — a chain item resolves in one go, but some of what it does is a choice
 * the player has to make partway through: Stacked Deck's "put 1 into your
 * hand", R372's order for two replacements landing on the same event.
 *
 * `execute` is synchronous and cannot stop to ask, so instead it hands back
 * what is *left* of the effect. The caller parks that on the task queue, which
 * suspends and asks the way it does for every other decision.
 *
 * `resume` is an ordinary `Effect`, and the answer reaches it through
 * `context.answer`. Both are plain data on purpose: abilities carry no
 * functions, which is what keeps `GameState` serializable.
 */
export interface EffectPause {
  decision: PendingDecision;
  resume: Effect;
  context: EffectContext;
}

export interface EffectOutcome {
  state: GameState;
  events: GameEvent[];
  pause?: EffectPause;
}

/**
 * R369.2 — damage through the replacement chokepoint, then onto the unit.
 * R372's ordering is asked for when more than one replacement applies and no
 * order has been given yet; `execute` hands back the rest of itself and the
 * queue asks.
 */
function dealAfterReplacement(
  state: GameState,
  targetId: CardId,
  amount: number,
  context: EffectContext,
  order?: CardId[],
): EffectOutcome {
  const permanent = state.permanents[targetId];
  if (permanent === undefined) return { state, events: [] };

  const sources =
    order === undefined
      ? ambiguousDamage(state, targetId, "spellOrAbility")
      : undefined;

  if (sources !== undefined) {
    return {
      state,
      events: [],
      pause: {
        decision: {
          // R372 — the controller of the object being acted on.
          player: controllerOf(state, targetId),
          prompt: { kind: "orderDamage", subject: targetId, amount, legal: sources },
        },
        resume: { op: "applyDamage", targetId, amount },
        context,
      },
    };
  }

  const replaced = replaceDamage(
    state,
    targetId,
    amount,
    "spellOrAbility",
    order ?? [],
  );

  return {
    state: {
      ...replaced.state,
      permanents: {
        ...replaced.state.permanents,
        [targetId]: {
          ...permanent,
          damage: permanent.damage + replaced.amount,
        },
      },
    },
    events: [
      ...replaced.events,
      {
        type: "damageDealt",
        playerId: context.controller,
        cardId: targetId,
        amount: replaced.amount,
      },
    ],
  };
}

function resolveDomain(
  state: GameState,
  domain: Domain | "selfDomain",
  context: EffectContext,
): Domain | undefined {
  if (domain !== "selfDomain") {
    return domain;
  }
  return state.cards[context.sourceId]?.domain;
}

function withPool(
  state: GameState,
  playerId: PlayerId,
  update: (pool: PlayerState["runePool"]) => PlayerState["runePool"],
): GameState {
  const player = seatOf(state, playerId);
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, runePool: update(player.runePool) },
    },
  };
}

/**
 * The interpreter. Every card's effect flows through this one function, which
 * is the only place that knows how to turn an Effect into a state change.
 */
/**
 * The opponent an effect is aimed at: the one its ability chose, or — when it
 * names none — the only one there is. R483.2.b makes "the opponent" singular
 * in a Duel and a list in every other mode, so an effect with no choice to
 * read has an unambiguous answer only when the mode seats two.
 */
function chosenOpponent(
  state: GameState,
  context: EffectContext,
  playerIndex: number | undefined,
): PlayerId | undefined {
  const opponents = opponentsOf(state, context.controller);
  if (playerIndex === undefined) return opponents[0];

  const chosen = context.targets[playerIndex];
  return opponents.find((id) => id === chosen);
}

/**
 * One effect, run once per player, in order — and able to stop and ask.
 *
 * The stopping is the whole point. `execute` returns a single pause, so an
 * "each player" step that asked a question used to strand everyone after it;
 * that was written up as a deviation and is what King's Edict ("each other
 * player chooses a unit you don't control") needs closed. When a player's step
 * pauses, the rest of the queue is folded into the resume: finish that
 * player's effect, then carry on down the list.
 */
function eachInTurn(
  state: GameState,
  each: Effect,
  context: EffectContext,
  players: PlayerId[],
  baseTargets: number,
): EffectOutcome {
  let current = state;
  const events: GameEvent[] = [];
  // R355.5 — the outer effect's own targets. Each player is appended past
  // them, so a resumed run has to trim the previous player's off first.
  const outer = context.targets.slice(0, baseTargets);

  for (let at = 0; at < players.length; at += 1) {
    const player = players[at]!;
    // An answer belongs to the step that asked for it, never to a player's
    // fresh turn at this effect. On a resumed run `seq` has already handed it
    // to the paused step ahead of us; carrying it in here would make the next
    // player "answer" with it and skip their own question.
    // `exactOptionalPropertyTypes` wants it absent, not undefined.
    const { answer: _theirs, ...clean } = context;
    const outcome = execute(current, each, {
      ...clean,
      targets: [...outer, player],
    });
    current = outcome.state;
    events.push(...outcome.events);
    if (outcome.pause === undefined) continue;

    const rest = players.slice(at + 1);
    const resume: Effect =
      rest.length === 0
        ? outcome.pause.resume
        : {
            op: "seq",
            steps: [
              outcome.pause.resume,
              { op: "forEachPlayerRest", each, players: rest, baseTargets },
            ],
          };
    return {
      state: current,
      events,
      pause: { decision: outcome.pause.decision, resume, context: outcome.pause.context },
    };
  }

  return { state: current, events };
}

export function execute(
  state: GameState,
  effect: Effect,
  context: EffectContext,
): EffectOutcome {
  switch (effect.op) {
    case "addEnergy":
      return {
        state: withPool(state, context.controller, (pool) =>
          creditEnergy(pool, effect.amount, effect.restriction ?? null),
        ),
        events: [
          {
            type: "energyAdded",
            playerId: context.controller,
            amount: effect.amount,
          },
        ],
      };

    case "addPower": {
      const domain = resolveDomain(state, effect.domain, context);
      if (domain === undefined) {
        return { state, events: [] };
      }
      return {
        state: withPool(state, context.controller, (pool) =>
          creditPower(pool, domain, effect.amount, effect.restriction ?? null),
        ),
        events: [
          {
            type: "powerAdded",
            playerId: context.controller,
            domain,
            amount: effect.amount,
          },
        ],
      };
    }

    // R142.3 — damage is marked on the unit. Lethal damage kills it in the
    // cleanup that follows (R428.1.a.2), not immediately.
    case "dealDamage": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };

      // R369.2 — a replacement intercedes before the damage lands, and R372
      // lets the unit's controller order them when more than one applies.
      return dealAfterReplacement(state, targetId, effect.amount, context);
    }

    case "applyDamage": {
      const permanent = state.permanents[effect.targetId];
      if (permanent === undefined) return { state, events: [] };
      return dealAfterReplacement(
        state,
        effect.targetId,
        effect.amount,
        context,
        context.answer,
      );
    }


    case "draw": {
      const chosen =
        effect.targetIndex === undefined
          ? context.controller
          : context.targets[effect.targetIndex];
      if (!isSeated(state, chosen)) return { state, events: [] };
      return drawCards(state, chosen, effect.count);
    }

    // R359.3.d — a countered spell never executes; it goes to its owner's
    // trash as if it had resolved. Cards like Abandon replace that destination.
    case "counterSpell": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      // R359.3.d targets a spell; a triggered ability is not counterable here.
      const index = state.chain.findIndex(
        (item) => item.kind === "spell" && item.cardId === targetId,
      );
      if (index === -1) return { state, events: [] };

      // "This can't be countered." A spell on the chain is not a permanent, so
      // R711 leaves the printed keyword as the thing to read.
      if ((state.cards[targetId]?.keywords ?? []).includes("uncounterable")) {
        return { state, events: [] };
      }
      // Mel, Newly Awakened — "your spells and abilities can't be countered",
      // which is the same restriction arriving from the board instead.
      const owner = state.chain[index]?.controller;
      if (owner !== undefined && cannotBeCountered(state, targetId, owner)) {
        return { state, events: [] };
      }

      const countered = state.chain[index]!;
      // The second way off the chain, and it goes through the same door: a
      // [Flow] spell that is countered is banished too (R829.1.b.1).
      const off = { ...state, chain: state.chain.filter((_, i) => i !== index) };
      // Abandon — "Return it to its owner's hand instead of putting it in
      // their trash." R56 makes that the *owner's* hand, and it replaces
      // R359.3.d's destination rather than adding to it, so `leaveChain` is
      // skipped entirely.
      // R56 names the *owner's* hand. A spell reaches the chain only from its
      // own controller's zones and never changes decks, so the item's
      // controller is that owner — and it is the one thing still known about a
      // card that has just left every zone.
      const owns = countered.controller;
      const left =
        effect.to === "hand"
          ? {
              state: {
                ...off,
                players: {
                  ...off.players,
                  [owns]: {
                    ...seatOf(off, owns),
                    hand: [...seatOf(off, owns).hand, targetId],
                  },
                },
              },
              events: [
                {
                  type: "returnedToHand" as const,
                  playerId: owns,
                  cardId: targetId,
                },
              ],
            }
          : leaveChain(off, countered, "countered");
      return {
        state: left.state,
        events: [
          {
            type: "spellCountered",
            playerId: context.controller,
            cardId: targetId,
          },
          ...left.events,
        ],
      };
    }

    /**
     * R477.3.b — the limitation applies *now* and the effect is remembered at
     * that limited level. "-4 Might to a min of 1" on a 2-Might unit generates
     * -1, and stays -1 even if the unit is buffed afterwards.
     */
    /**
     * The same arithmetic as `modifyMight`, applied to everything matching the
     * criteria instead of to one chosen unit. R477.3.b's limitation is applied
     * per unit, because "to a minimum of 1" is about each of them.
     */
    /**
     * Finds a card, then runs the arm its type names. The finding is part of
     * the effect because the arms refer to what it found — there is no way to
     * write "the discarded card" as a target chosen ahead of time.
     */
    case "grantPlayFromTrash":
      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `trashplay-${state.modifiers.length}-${context.controller}`,
              targetId: context.controller,
              modification: {
                layer: "ability",
                op: "playFromTrash",
                ...(effect.cardType !== undefined
                  ? { cardType: effect.cardType }
                  : {}),
                ...(effect.maxEnergy !== undefined
                  ? { maxEnergy: effect.maxEnergy }
                  : {}),
                ...(effect.waiveEnergy !== undefined
                  ? { waiveEnergy: effect.waiveEnergy }
                  : {}),
                ...(effect.recycleOnLeave !== undefined
                  ? { recycleOnLeave: effect.recycleOnLeave }
                  : {}),
              },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };

    /**
     * Asks the countered spell's controller whether they would rather pay.
     * The prompt is answered with the spell itself to pay, or with nothing to
     * decline — the same shape every other "any number, including none" answer
     * takes, so no new answering machinery was needed.
     */
    case "counterUnlessPaid": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const item = state.chain.find(
        (each) => each.kind === "spell" && each.cardId === targetId,
      );
      if (item === undefined) return { state, events: [] };

      return {
        state,
        events: [],
        pause: {
          decision: {
            // R383.3 — it is their spell, so it is their choice.
            player: item.controller,
            prompt: { kind: "payOrDecline", cost: effect.cost, legal: [targetId] },
          },
          resume: {
            op: "resolveUnlessPaid",
            targetId,
            cost: effect.cost,
          },
          context,
        },
      };
    }

    case "resolveUnlessPaid": {
      const item = state.chain.find(
        (each) => each.kind === "spell" && each.cardId === effect.targetId,
      );
      if (item === undefined) return { state, events: [] };

      const paying = (context.answer ?? []).includes(effect.targetId);
      if (!paying) {
        return execute(
          state,
          { op: "counterSpell", targetIndex: 0 },
          { ...context, targets: [effect.targetId] },
        );
      }

      // They said yes, so the cost is taken now. R356 is not involved: this is
      // not a cost of playing anything, it is what the spell asked for.
      const player = seatOf(state, item.controller);
      const remaining = spend(player.runePool, effect.cost, {
        kind: "activateAbility",
        inShowdown: state.showdown !== null,
      });
      if (remaining === undefined) {
        // They could not actually pay, so the counter stands.
        return execute(
          state,
          { op: "counterSpell", targetIndex: 0 },
          { ...context, targets: [effect.targetId] },
        );
      }

      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [item.controller]: { ...player, runePool: remaining },
          },
        },
        events: [
          {
            type: "costPaid",
            playerId: item.controller,
            cardId: effect.targetId,
            cost: effect.cost,
          },
        ],
      };
    }

    case "branchOnCardType": {
      const player = seatOf(state, context.controller);
      let current = state;
      const events: GameEvent[] = [];
      let found: CardId | undefined;

      if (effect.of === "discardOne") {
        // R422.4 — "a player must Discard as many cards as possible", so an
        // empty hand discards nothing and the branch simply has no card.
        // Which card is not asked: R355 puts choices at the start of playing,
        // and this is resolution. Taken from the front, as the front of the
        // hand is where an unchosen discard has always come from here.
        found = player.hand[0];
        if (found === undefined) return { state, events: [] };
        current = {
          ...current,
          players: {
            ...current.players,
            [context.controller]: {
              ...player,
              hand: player.hand.slice(1),
              trash: [...player.trash, found],
            },
          },
        };
        events.push({
          type: "cardDiscarded",
          playerId: context.controller,
          cardId: found,
        });
      } else {
        // R424.1.a.2 — a revealed card stays where it is; this only makes it
        // known, and the arm decides whether it then moves.
        found = player.mainDeck[0];
        if (found === undefined) return { state, events: [] };
        current = { ...current, revealed: [...current.revealed, found] };
        events.push({
          type: "cardRevealed",
          playerId: context.controller,
          cardId: found,
        });
      }

      const type = current.cards[found]?.type;
      const arm = type === undefined ? undefined : effect.arms[type];
      if (arm === undefined) return { state: current, events };

      const outcome = execute(current, arm, context);
      return {
        ...outcome,
        state: outcome.state,
        events: [...events, ...outcome.events],
      };
    }

    case "modifyMightEach": {
      const mine = context.controller;
      const where =
        effect.atTargetIndex === undefined
          ? undefined
          : context.targets[effect.atTargetIndex];
      const at: Location | undefined =
        where === undefined ? undefined : { kind: "battlefield", id: where };

      const caught = Object.values(state.permanents).filter((permanent) => {
        if (state.cards[permanent.cardId]?.type !== "unit") return false;
        const theirs = controllerOf(state, permanent.cardId);
        if (effect.who === "enemy" && theirs === mine) return false;
        if (effect.who === "friendly" && theirs !== mine) return false;
        if (at !== undefined && !sameLocation(at, permanent.location)) return false;
        return true;
      });

      let current = state;
      const events: GameEvent[] = [];
      for (const permanent of caught) {
        const was = mightOf(current, permanent.cardId);
        let limited = was + effect.amount;
        if (effect.min !== undefined) limited = Math.max(effect.min, limited);
        const amount = limited - was;
        if (amount === 0) continue;

        current = {
          ...current,
          modifiers: [
            ...current.modifiers,
            {
              id: `each-${current.modifiers.length}-${permanent.cardId}`,
              targetId: permanent.cardId,
              modification: { layer: "arithmetic", op: "addMight", amount },
              duration: effect.duration,
            },
          ],
        };
        events.push({
          type: "mightModified",
          playerId: controllerOf(current, permanent.cardId),
          cardId: permanent.cardId,
          amount,
          duration: effect.duration,
        });
      }
      return { state: current, events };
    }

    case "modifyMight": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };

      const current = mightOf(state, targetId);
      // R432.1.a — doubling reads current Might, so Shield counts toward it.
      const requested = effect.double === true ? current : (effect.amount ?? 0);
      // R477.3.c — a player cannot increase an attribute by a negative amount.
      const raw = effect.double === true ? Math.max(0, requested) : requested;

      let limited = current + raw;
      if (effect.min !== undefined) limited = Math.max(effect.min, limited);
      if (effect.max !== undefined) limited = Math.min(effect.max, limited);
      const amount = limited - current;

      if (amount === 0) return { state, events: [] };
      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `mod-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: { layer: "arithmetic", op: "addMight", amount },
              duration: effect.duration,
            },
          ],
        },
        events: [
          {
            type: "mightModified",
            playerId: context.controller,
            cardId: targetId,
            amount,
            duration: effect.duration,
          },
        ],
      };
    }

    case "grantKeywordFor": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `mod-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: {
                layer: "ability",
                op: "grantKeyword",
                keyword: effect.keyword,
                ...(effect.value !== undefined ? { value: effect.value } : {}),
              },
              duration: effect.duration,
            },
          ],
        },
        events: [
          {
            type: "keywordGranted",
            playerId: context.controller,
            cardId: targetId,
            keyword: effect.keyword,
            duration: effect.duration,
          },
        ],
      };
    }

    case "takeControl": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };

      const events: GameEvent[] = [
        {
          type: "controlTaken",
          playerId: context.controller,
          cardId: targetId,
          duration: effect.duration,
        },
      ];

      // R454 — a recall sends it to the *new* controller's base, and is not a
      // move, so it does not contest anything on arrival.
      const permanents =
        effect.recall === true
          ? {
              ...state.permanents,
              [targetId]: {
                ...permanent,
                location: {
                  kind: "base" as const,
                  player: context.controller,
                },
              },
            }
          : state.permanents;
      if (effect.recall === true) {
        events.push({
          type: "unitRecalled",
          playerId: context.controller,
          cardId: targetId,
        });
      }

      return {
        state: {
          ...state,
          permanents,
          modifiers: [
            ...state.modifiers,
            {
              id: `control-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: {
                layer: "trait",
                op: "setController",
                player: context.controller,
              },
              duration: effect.duration,
            },
          ],
        },
        events,
      };
    }

    case "createToken": {
      let current = state;
      const events: GameEvent[] = [];
      const copySourceId =
        effect.copyOfSource === true
          ? context.sourceId
          : effect.copyOfTarget === undefined
            ? undefined
            : context.targets[effect.copyOfTarget];

      for (let i = 0; i < effect.count; i += 1) {
        const index = current.tokensCreated;
        const tokenId = `token-${effect.token}-${index}`;
        const card = tokenCard(effect.token, tokenId);

        const wanted: Location =
          effect.to === "sourceLocation" && context.sourceLocation !== undefined
            ? context.sourceLocation
            : effect.to === "eventLocation" &&
                context.eventLocation !== undefined
              ? context.eventLocation
              : { kind: "base", player: context.controller };
        // R462.2.a — "If an effect would require a Unit be played to a
        // Battlefield with a Staged Combat or a Combat in Progress, where the
        // controller of the played unit is not a participant, instead the Unit
        // is played to its controller's Base." R462.2.b reassigns "here" with
        // it, which is what returning the Base here amounts to.
        const location: Location =
          wanted.kind === "battlefield" &&
          closedToOutsiders(current, wanted.id, context.controller)
            ? { kind: "base", player: context.controller }
            : wanted;

        current = {
          ...current,
          tokensCreated: index + 1,
          cards: { ...current.cards, [tokenId]: card },
          permanents: {
            ...current.permanents,
            [tokenId]: {
              cardId: tokenId,
              // R182/R183 — both come from whoever controlled this effect.
              controller: context.controller,
              owner: context.controller,
              exhausted: effect.ready !== true,
              location,
              damage: 0,
            },
          },
          // R477.1.b — the copy is a trait-layer effect on the token, not a
          // rewrite of it, so it lives as a modifier like any other. R184.3's
          // granted keywords ride along the same way.
          modifiers: [
            ...current.modifiers,
            ...(copySourceId === undefined
              ? []
              : [
                  {
                    id: `copy-${tokenId}`,
                    targetId: tokenId,
                    modification: {
                      layer: "trait" as const,
                      op: "copyOf" as const,
                      sourceId: copySourceId,
                    },
                    duration: "permanent" as const,
                  },
                ]),
            ...(effect.grants ?? []).map((keyword, n) => ({
              id: `grant-${tokenId}-${n}`,
              targetId: tokenId,
              modification: {
                layer: "ability" as const,
                op: "grantKeyword" as const,
                keyword,
              },
              duration: "permanent" as const,
            })),
          ],
        };

        events.push({
          type: "tokenCreated",
          playerId: context.controller,
          cardId: tokenId,
          token: effect.token,
        });
      }

      return { state: current, events };
    }

    case "delay":
      return {
        state: {
          ...state,
          delayed: [
            ...state.delayed,
            {
              id: `delayed-${state.delayed.length}-${context.sourceId}`,
              at: effect.at,
              controller: context.controller,
              sourceId: context.sourceId,
              effect: effect.effect,
              // R355.5 — the choices were made when this was scheduled.
              targets: [...context.targets],
            },
          ],
        },
        events: [
          {
            type: "effectScheduled",
            playerId: context.controller,
            cardId: context.sourceId,
            at: effect.at,
          },
        ],
      };

    case "recall": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };

      const to = controllerOf(state, targetId);
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: {
              ...permanent,
              location: { kind: "base", player: to },
            },
          },
        },
        events: [{ type: "unitRecalled", playerId: to, cardId: targetId }],
      };
    }

    case "returnToHand": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }
      // R56 — it is the *owner's* hand, not the current controller's.
      const owner = ownerOf(permanent);
      const { [targetId]: _gone, ...permanents } = state.permanents;
      return {
        state: {
          ...state,
          permanents,
          players: {
            ...state.players,
            [owner]: {
              ...seatOf(state, owner),
              hand: [...seatOf(state, owner).hand, targetId],
            },
          },
        },
        events: [{ type: "returnedToHand", playerId: owner, cardId: targetId }],
      };
    }

    case "banish": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }
      const owner = ownerOf(permanent);
      const { [targetId]: _gone, ...permanents } = state.permanents;
      return {
        state: {
          ...state,
          permanents,
          players: {
            ...state.players,
            [owner]: {
              ...seatOf(state, owner),
              banished: [...seatOf(state, owner).banished, targetId],
            },
          },
        },
        events: [{ type: "banished", playerId: owner, cardId: targetId }],
      };
    }

    case "ready":
    case "buff":
    case "stun": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }

      // Maduli the Gatekeeper — "I can't be readied"; Mageseeker Warden —
      // "spells and abilities can't ready enemy units and gear". This is a
      // spell or ability doing it, which is the half the Warden restricts;
      // R315.1's Awaken asks the same question without that flag.
      if (
        effect.op === "ready" &&
        restricted(state, targetId, "beReadied", { bySpellOrAbility: true })
      ) {
        return { state, events: [] };
      }

      // R415.1.c, R426.1.b.1, R423.1.a.1 — all three are no-ops on a unit that
      // is already in the target state, and R426.1.c makes that observable:
      // "if it was buffed this way" is false, so a linked effect will not fire.
      const already =
        (effect.op === "ready" && !permanent.exhausted) ||
        (effect.op === "buff" && permanent.buffed === true) ||
        (effect.op === "stun" && permanent.stunned === true);
      if (already) return { state, events: [] };

      const updated =
        effect.op === "ready"
          ? { ...permanent, exhausted: false }
          : effect.op === "buff"
            ? { ...permanent, buffed: true as const }
            : { ...permanent, stunned: true as const };

      return {
        state: { ...state, permanents: { ...state.permanents, [targetId]: updated } },
        events: [
          {
            type: effect.op === "ready" ? "objectReadied" : effect.op === "buff" ? "buffed" : "stunned",
            playerId: context.controller,
            cardId: targetId,
          },
        ],
      };
    }

    case "moveUnit": {
      const targetId = context.targets[effect.targetIndex];
      const permanent = targetId === undefined ? undefined : state.permanents[targetId];
      if (targetId === undefined || permanent === undefined) {
        return { state, events: [] };
      }
      // Moonfall's "that battlefield" — one of the spell's own choices, so it
      // arrives as an index rather than being worked out here. A choice that
      // named nothing leaves the unit where it is, which is what R355.8's
      // declined optional target amounts to.
      const chosen =
        effect.to === "chosenBattlefield" && effect.atTargetIndex !== undefined
          ? context.targets[effect.atTargetIndex]
          : undefined;
      if (effect.to === "chosenBattlefield") {
        if (chosen === undefined || state.battlefields[chosen] === undefined) {
          return { state, events: [] };
        }
      }

      const mover = controllerOf(state, targetId);
      const named =
        effect.to === "eventLocation"
          ? context.eventLocation
          : effect.to === "sourceLocation"
            ? context.sourceLocation
            : undefined;
      // A destination the effect names but cannot resolve is not an excuse to
      // pick a different one. "Move an enemy unit to that battlefield" once
      // fell through to *the unit's own base* when the battlefield could not
      // be worked out, which is a different effect wearing the same name.
      if (chosen === undefined && effect.to !== "base" && named === undefined) {
        return { state, events: [] };
      }
      const wanted: Location =
        chosen !== undefined
          ? { kind: "battlefield", id: chosen }
          : (named ?? { kind: "base", player: mover });
      // R447.2.c — "If an action would require a Move that would cause a Unit
      // to become present in a Location where it cannot move for any reason …
      // it instead Recalls." A recall goes to the controller's Base (R455).
      const to: Location =
        wanted.kind === "battlefield" &&
        closedToOutsiders(state, wanted.id, mover)
          ? { kind: "base", player: mover }
          : wanted;

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: { ...permanent, location: to },
          },
        },
        events: [
          {
            type: "unitMoved",
            playerId: controllerOf(state, targetId),
            cardId: targetId,
            from: permanent.location,
            to,
          },
        ],
      };
    }

    case "kill": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };
      return killUnits(state, [targetId]);
    }

    case "killSelf": {
      if (state.permanents[context.sourceId] === undefined) {
        return { state, events: [] };
      }
      return killUnits(state, [context.sourceId]);
    }

    case "gainXP": {
      const player = seatOf(state, context.controller);
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [context.controller]: { ...player, xp: player.xp + effect.amount },
          },
        },
        events: [
          {
            type: "xpGained",
            playerId: context.controller,
            amount: effect.amount,
          },
        ],
      };
    }

    case "addEnergyToEach": {
      let current = state;
      const events: GameEvent[] = [];
      for (const playerId of ["p1", "p2"] as const) {
        current = withPool(current, playerId, (pool) =>
          creditEnergy(pool, effect.amount),
        );
        events.push({ type: "energyAdded", playerId, amount: effect.amount });
      }
      return { state: current, events };
    }

    case "swapMight": {
      const a = context.targets[effect.targetIndex];
      const b = context.targets[effect.otherIndex];
      if (a === undefined || b === undefined) return { state, events: [] };
      if (state.permanents[a] === undefined) return { state, events: [] };
      if (state.permanents[b] === undefined) return { state, events: [] };

      const mightA = mightOf(state, a);
      const mightB = mightOf(state, b);
      // R433.1.c — "If both attributes are the same numeric value, Swapping
      // has no effect." Not merely invisible: nothing is created to expire.
      if (mightA === mightB) return { state, events: [] };

      const difference = Math.abs(mightA - mightB);
      const raise = mightA < mightB ? a : b;
      const lower = mightA < mightB ? b : a;

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `swap-up-${state.modifiers.length}-${raise}`,
              targetId: raise,
              modification: {
                layer: "arithmetic",
                op: "addMight",
                amount: difference,
              },
              duration: effect.duration,
            },
            {
              id: `swap-down-${state.modifiers.length}-${lower}`,
              targetId: lower,
              modification: {
                layer: "arithmetic",
                op: "addMight",
                amount: -difference,
              },
              duration: effect.duration,
            },
          ],
        },
        events: [
          {
            type: "mightModified",
            playerId: context.controller,
            cardId: raise,
            amount: difference,
            duration: effect.duration,
          },
          {
            type: "mightModified",
            playerId: context.controller,
            cardId: lower,
            amount: -difference,
            duration: effect.duration,
          },
        ],
      };
    }

    case "swapLocations": {
      const targetId = context.targets[effect.targetIndex];
      const source = state.permanents[context.sourceId];
      if (targetId === undefined || source === undefined) {
        return { state, events: [] };
      }
      const target = state.permanents[targetId];
      if (target === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [context.sourceId]: { ...source, location: target.location },
            [targetId]: { ...target, location: source.location },
          },
        },
        events: [
          {
            type: "unitMoved",
            playerId: context.controller,
            cardId: context.sourceId,
            from: source.location,
            to: target.location,
          },
          {
            type: "unitMoved",
            playerId: controllerOf(state, targetId),
            cardId: targetId,
            from: target.location,
            to: source.location,
          },
        ],
      };
    }

    case "mutualDamage": {
      const a = context.targets[effect.targetIndex];
      const b = context.targets[effect.otherIndex];
      if (a === undefined || b === undefined) return { state, events: [] };
      if (state.permanents[a] === undefined) return { state, events: [] };
      if (state.permanents[b] === undefined) return { state, events: [] };

      // R465.2.c.1.a's principle: both amounts are read before either lands, so
      // a unit that dies still dealt its Might.
      const damageFromA = mightOf(state, a);
      const damageFromB = mightOf(state, b);

      // Both amounts were read above, before either lands; each is then put
      // through R369.2's replacements on its own way in.
      const toA = replaceDamage(state, a, damageFromB, "spellOrAbility");
      const toB = replaceDamage(toA.state, b, damageFromA, "spellOrAbility");

      const permanents = { ...toB.state.permanents };
      permanents[a] = { ...permanents[a]!, damage: permanents[a]!.damage + toA.amount };
      permanents[b] = { ...permanents[b]!, damage: permanents[b]!.damage + toB.amount };

      return {
        state: { ...toB.state, permanents },
        events: [
          ...toA.events,
          ...toB.events,
          {
            type: "damageDealt",
            playerId: controllerOf(state, a),
            cardId: a,
            amount: toA.amount,
          },
          {
            type: "damageDealt",
            playerId: controllerOf(state, b),
            cardId: b,
            amount: toB.amount,
          },
        ],
      };
    }

    case "readyRunes": {
      const player = seatOf(state, context.controller);
      const runes = { ...state.runes };
      const events: GameEvent[] = [];
      let left = effect.count;

      // R414.1 — readying an already-ready rune does nothing, so the count is
      // spent on the exhausted ones in the order they were channeled.
      for (const runeId of player.runes) {
        if (left === 0) break;
        const rune = runes[runeId];
        if (rune === undefined || !rune.exhausted) continue;
        runes[runeId] = { ...rune, exhausted: false };
        events.push({
          type: "objectReadied",
          playerId: context.controller,
          cardId: runeId,
        });
        left -= 1;
      }

      return { state: { ...state, runes }, events };
    }

    case "drawPerBattlefield": {
      const count = state.battlefieldOrder.filter(
        (battlefieldId) =>
          state.battlefields[battlefieldId]?.controller === context.controller &&
          !(effect.excludeSource === true && battlefieldId === context.sourceId),
      ).length;
      if (count === 0) return { state, events: [] };
      return drawCards(state, context.controller, count);
    }

    /**
     * Brynhir, Lilting Lullaby — a board restriction for a duration, installed
     * on a *player*. The restriction itself names no side: it is already
     * pointed at whoever was chosen, so `affects` has nothing to be relative
     * to and `restrictions.ts` reads the target directly.
     */
    case "restrictPlayer": {
      const playerId = context.targets[effect.targetIndex];
      if (!isSeated(state, playerId)) return { state, events: [] };

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `noPlay-${state.modifiers.length}-${playerId}`,
              targetId: playerId,
              modification: {
                layer: "ability",
                op: "restrictPlayer",
                restriction: effect.restriction,
              },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };
    }

    case "seeFacedown": {
      const looker =
        effect.targetIndex === undefined
          ? context.controller
          : context.targets[effect.targetIndex];
      if (!isSeated(state, looker)) return { state, events: [] };

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `look-${state.modifiers.length}-${looker}`,
              targetId: looker,
              modification: { layer: "ability", op: "seeFacedown" },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };
    }

    case "restrictMovement": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      if (state.permanents[targetId] === undefined) return { state, events: [] };

      return {
        state: {
          ...state,
          modifiers: [
            ...state.modifiers,
            {
              id: `noMove-${state.modifiers.length}-${targetId}`,
              targetId,
              modification: {
                layer: "ability",
                op: "restrict",
                restriction: { what: "move" },
              },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };
    }

    case "scaleDamage": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      return {
        state: {
          ...state,
          damageReplacements: [
            ...state.damageReplacements,
            {
              id: `scale-${state.damageReplacements.length}-${targetId}`,
              sourceId: context.sourceId,
              targetId,
              from: "any",
              op: { kind: "scale", factor: effect.factor },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };
    }

    case "preventDamage": {
      const targetId =
        effect.targetIndex === undefined
          ? undefined
          : context.targets[effect.targetIndex];
      if (effect.targetIndex !== undefined && targetId === undefined) {
        return { state, events: [] };
      }
      return {
        state: {
          ...state,
          damageReplacements: [
            ...state.damageReplacements,
            {
              id: `prevent-${state.damageReplacements.length}-${targetId ?? "all"}`,
              sourceId: context.sourceId,
              ...(targetId !== undefined ? { targetId } : {}),
              from: effect.from,
              op: { kind: "prevent", amount: effect.amount },
              duration: effect.duration,
            },
          ],
        },
        events: [],
      };
    }

    case "heal": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      if (permanent === undefined || permanent.damage === 0) {
        return { state, events: [] };
      }
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: { ...permanent, damage: 0 },
          },
        },
        events: [
          { type: "healed", playerId: context.controller, cardId: targetId },
        ],
      };
    }

    case "exhaust": {
      const targetId = context.targets[effect.targetIndex];
      if (targetId === undefined) return { state, events: [] };
      const permanent = state.permanents[targetId];
      // R414.1.b — exhausting something already exhausted does nothing.
      if (permanent === undefined || permanent.exhausted) {
        return { state, events: [] };
      }
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [targetId]: { ...permanent, exhausted: true },
          },
        },
        events: [
          { type: "objectExhausted", playerId: context.controller, cardId: targetId },
        ],
      };
    }

    case "discountNextCard":
      return {
        state: {
          ...state,
          pendingDiscounts: [
            ...state.pendingDiscounts,
            { player: context.controller, reduce: effect.reduce },
          ],
        },
        events: [],
      };

    case "lookAtTop": {
      const player = seatOf(state, context.controller);
      const revealed = player.mainDeck.slice(0, effect.count);
      if (revealed.length === 0) return { state, events: [] };

      const keep = Math.min(effect.keep, revealed.length);
      const rest: Effect = { op: "takeRevealed", from: "mainDeck", revealed };

      // Nothing to ask when every revealed card is kept.
      if (keep >= revealed.length) {
        return execute(state, rest, { ...context, answer: revealed });
      }

      return {
        state,
        events: [],
        pause: {
          decision: {
            player: context.controller,
            prompt: { kind: "chooseFromRevealed", legal: revealed, keep },
          },
          resume: rest,
          context,
        },
      };
    }

    case "recycleFromHand": {
      const player = seatOf(state, context.controller);
      // R416 cannot recycle more than there is; a short hand recycles all of it.
      const count = Math.min(effect.count, player.hand.length);
      if (count === 0) return { state, events: [] };

      const rest: Effect = { op: "takeRecycled", from: [...player.hand] };
      // Nothing to ask when the whole hand is going.
      if (count >= player.hand.length) {
        return execute(state, rest, { ...context, answer: [...player.hand] });
      }
      return {
        state,
        events: [],
        pause: {
          decision: {
            player: context.controller,
            prompt: {
              kind: "chooseFromRevealed",
              legal: [...player.hand],
              keep: count,
            },
          },
          resume: rest,
          context,
        },
      };
    }

    case "takeRecycled": {
      const chosen = (context.answer ?? []).filter((id) =>
        effect.from.includes(id),
      );
      if (chosen.length === 0) return { state, events: [] };
      const player = seatOf(state, context.controller);

      // R416.1 — recycling puts a card on the *bottom* of the Main Deck.
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [context.controller]: {
              ...player,
              hand: player.hand.filter((id) => !chosen.includes(id)),
              mainDeck: [...player.mainDeck, ...chosen],
            },
          },
        },
        events: chosen.map((cardId) => ({
          type: "cardRecycled" as const,
          playerId: context.controller,
          cardId,
        })),
      };
    }

    case "reveal": {
      const chosen =
        effect.targetIndex === undefined
          ? context.controller
          : context.targets[effect.targetIndex];
      if (!isSeated(state, chosen)) return { state, events: [] };

      const player = seatOf(state, chosen);
      const zone = effect.from === "hand" ? player.hand : player.mainDeck;
      // R424.3.a — "when the zone is instructed to be Revealed without
      // indicating a number, that refers to all cards currently in the zone."
      const shown =
        effect.count === undefined ? [...zone] : zone.slice(0, effect.count);
      if (shown.length === 0) return { state, events: [] };

      return {
        state: {
          ...state,
          // R424.1.a.2 — the cards do not move. This is the note that they are
          // known, and nothing else (R424.1.b).
          revealed: [...state.revealed, ...shown],
        },
        events: shown.map((cardId) => ({
          type: "cardRevealed" as const,
          playerId: chosen,
          cardId,
        })),
      };
    }

    case "discard": {
      // R422.1 — a player discards from their *own* hand, so the effect names
      // whose hand, and that same player makes the choice (R422.1.a).
      const chosen =
        effect.targetIndex === undefined
          ? context.controller
          : context.targets[effect.targetIndex];
      if (!isSeated(state, chosen)) return { state, events: [] };

      const hand = seatOf(state, chosen).hand;
      // R422.4 — "a player must Discard as many cards as possible… If
      // instructed to discard more than they have, further instructions are
      // ignored." So an empty hand is a no-op, not a failure.
      const count = Math.min(effect.count, hand.length);
      if (count === 0) return { state, events: [] };

      const rest: Effect = {
        op: "takeDiscarded",
        player: chosen,
        from: [...hand],
      };
      if (count >= hand.length) {
        return execute(state, rest, { ...context, answer: [...hand] });
      }
      return {
        state,
        events: [],
        pause: {
          decision: {
            // R422.1.a — "the player who is performing the action chooses
            // which cards to send to their Trash, and may use Private
            // Information to do so." Not the effect's controller.
            player: chosen,
            prompt: { kind: "chooseFromRevealed", legal: [...hand], keep: count },
          },
          resume: rest,
          context,
        },
      };
    }

    case "takeDiscarded": {
      const chosen = (context.answer ?? []).filter((id) =>
        effect.from.includes(id),
      );
      if (chosen.length === 0) return { state, events: [] };
      const player = seatOf(state, effect.player);

      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [effect.player]: {
              ...player,
              hand: player.hand.filter((id) => !chosen.includes(id)),
              trash: [...player.trash, ...chosen],
            },
          },
        },
        // R422.1.b — "when I am discarded" abilities run *after* the discard,
        // so this reports it rather than doing anything else itself.
        events: chosen.map((cardId) => ({
          type: "cardDiscarded" as const,
          playerId: effect.player,
          cardId,
        })),
      };
    }

    case "burn": {
      const chosen =
        effect.targetIndex === undefined
          ? context.controller
          : context.targets[effect.targetIndex];
      if (!isSeated(state, chosen)) return { state, events: [] };

      let current = state;
      const events: GameEvent[] = [];
      // R440.4 — "if instructed to burn more cards than they have in their
      // main deck, they burn that many cards, burn out and then burn the
      // rest." So the burn out does not consume one of the burns: the count is
      // of cards actually burned, and the loop goes round again after it.
      let burned = 0;
      while (burned < effect.count) {
        const player = seatOf(current, chosen);
        const [top, ...rest] = player.mainDeck;

        if (top === undefined) {
          // R431 recycles the trash into the deck. With both empty there is
          // nothing to recycle and no progress to be made, so this stops
          // rather than burning out forever for a point a time.
          if (player.trash.length === 0) break;
          const out = burnOut(current, chosen);
          current = out.state;
          events.push(...out.events);
          continue;
        }

        current = {
          ...current,
          players: {
            ...current.players,
            [chosen]: {
              ...player,
              mainDeck: rest,
              trash: [...player.trash, top],
            },
          },
        };
        events.push({ type: "cardBurned", playerId: chosen, cardId: top });
        burned += 1;
      }
      return { state: current, events };
    }

    case "predict": {
      const player = seatOf(state, context.controller);
      // R436.4 — "If a player attempts to Predict more cards than are
      // available, they will Predict as many as possible instead", and
      // R436.4.a is explicit that this never causes a Burn Out.
      const revealed = player.mainDeck.slice(0, effect.count);
      if (revealed.length === 0) return { state, events: [] };

      // Always asked, even for one card: R436.1's choice is whether to Recycle
      // it, so a single revealed card is still a genuine decision.
      return {
        state,
        events: [],
        pause: {
          decision: {
            player: context.controller,
            prompt: { kind: "predict", legal: revealed },
          },
          resume: { op: "takePredicted", revealed },
          context,
        },
      };
    }

    case "takePredicted": {
      const recycled = context.answer ?? [];
      const player = seatOf(state, context.controller);
      const kept = effect.revealed.filter((id) => !recycled.includes(id));

      // R416.1 — Recycling puts a card on the *bottom*. The kept cards go back
      // on top, ahead of everything the Predict never looked at.
      const next: GameState = {
        ...state,
        players: {
          ...state.players,
          [context.controller]: {
            ...player,
            mainDeck: [
              ...kept,
              ...player.mainDeck.slice(effect.revealed.length),
              ...recycled,
            ],
          },
        },
      };
      const events: GameEvent[] = recycled.map((cardId) => ({
        type: "cardRecycled" as const,
        playerId: context.controller,
        cardId,
      }));

      // R436.1.a — the rest go back "in any order", which is only a choice
      // when more than one survived.
      if (kept.length < 2) return { state: next, events };

      return {
        state: next,
        events,
        pause: {
          decision: {
            player: context.controller,
            prompt: { kind: "orderPredicted", legal: kept },
          },
          resume: { op: "orderPredicted", cards: kept },
          context,
        },
      };
    }

    case "orderPredicted": {
      const order = context.answer ?? [];
      // `takePredicted` already left these on top in their revealed order, so
      // an answer that is not a permutation of them simply leaves that order.
      if (
        order.length !== effect.cards.length ||
        !order.every((id) => effect.cards.includes(id))
      ) {
        return { state, events: [] };
      }
      const player = seatOf(state, context.controller);
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [context.controller]: {
              ...player,
              mainDeck: [...order, ...player.mainDeck.slice(order.length)],
            },
          },
        },
        events: [],
      };
    }

    case "recycleFromOpponentHand": {
      const opponent = chosenOpponent(state, context, effect.playerIndex);
      if (opponent === undefined) return { state, events: [] };
      const legal = seatOf(state, opponent).hand.filter(
        (cardId) =>
          effect.exclude === undefined ||
          state.cards[cardId]?.type !== effect.exclude,
      );
      if (legal.length === 0) return { state, events: [] };

      const rest: Effect = {
        op: "takeRevealed",
        from: "opponentHand",
        revealed: legal,
        player: opponent,
      };
      if (legal.length === 1) {
        return execute(state, rest, { ...context, answer: legal });
      }

      return {
        state,
        events: [],
        pause: {
          decision: {
            // R355.5 — "Choose a non-unit card from it" is the *spell's*
            // controller choosing, not the player revealing.
            player: context.controller,
            prompt: { kind: "chooseFromRevealed", legal, keep: 0 },
          },
          resume: rest,
          context,
        },
      };
    }

    /**
     * R416.1 — recycling puts a card on the bottom of the deck it came from.
     * For `lookAtTop` the answer is what goes to hand and the rest is
     * recycled; for the opponent's hand the answer *is* what is recycled.
     */
    case "takeRevealed": {
      const chosen = context.answer ?? [];

      if (effect.from === "mainDeck") {
        const player = seatOf(state, context.controller);
        const rest = effect.revealed.filter((id) => !chosen.includes(id));
        return {
          state: {
            ...state,
            players: {
              ...state.players,
              [context.controller]: {
                ...player,
                hand: [...player.hand, ...chosen],
                mainDeck: [
                  ...player.mainDeck.slice(effect.revealed.length),
                  ...rest,
                ],
              },
            },
          },
          events: chosen.map((cardId) => ({
            type: "cardDrawn" as const,
            playerId: context.controller,
            cardId,
          })),
        };
      }

      const opponent =
        effect.player ?? opponentsOf(state, context.controller)[0];
      if (opponent === undefined) return { state, events: [] };
      const theirs = seatOf(state, opponent);
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [opponent]: {
              ...theirs,
              hand: theirs.hand.filter((id) => !chosen.includes(id)),
              mainDeck: [...theirs.mainDeck, ...chosen],
            },
          },
        },
        events: chosen.map((cardId) => ({
          type: "cardRecycled" as const,
          playerId: opponent,
          cardId,
        })),
      };
    }

    case "attachSelf": {
      const targetId = context.targets[effect.targetIndex];
      const gear = state.permanents[context.sourceId];
      if (targetId === undefined || gear === undefined) {
        return { state, events: [] };
      }
      const host = state.permanents[targetId];
      if (host === undefined) return { state, events: [] };
      // R434.1.g/h — attaching to its current Top-Most Card does nothing.
      if (gear.attachedTo === targetId) return { state, events: [] };

      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            // R434.1.f — attaching elsewhere detaches from wherever it was;
            // R434.4 — its location becomes the new Top-Most Card's.
            [context.sourceId]: {
              ...gear,
              attachedTo: targetId,
              location: host.location,
            },
          },
        },
        events: [{ type: "attached", playerId: context.controller, cardId: context.sourceId, to: targetId }],
      };
    }

    case "equipChosen": {
      const gearId = context.targets[effect.targetIndex];
      const host = state.permanents[context.sourceId];
      if (gearId === undefined || host === undefined) {
        return { state, events: [] };
      }
      const gear = state.permanents[gearId];
      if (gear === undefined) return { state, events: [] };

      // R821.1.c.2 — the cost is the Equip ability's, "determined as though
      // that Equip ability was being activated". An Equip ability is the one
      // that attaches its own card (R818.1.b).
      const equip = (state.cards[gearId]?.abilities ?? []).find(
        (ability) =>
          ability.kind === "activated" && ability.effect.op === "attachSelf",
      );
      // R821.1.c.4 — "If the chosen card doesn't have an Equip cost, it can't
      // be paid", so nothing happens.
      if (equip === undefined || equip.kind !== "activated") {
        return { state, events: [] };
      }
      const resourceCosts = equip.costs.filter((cost) => cost.kind === "pay");
      if (resourceCosts.length !== equip.costs.length) {
        // A non-resource Equip cost (a few print "Recycle 2 cards", "Kill a
        // friendly unit", "Spend 1 XP"). Nothing here can pay one; R821.1.c.5
        // then leaves the card exactly where it was.
        return { state, events: [] };
      }

      let cost = resourceCosts.reduce(
        (total, each) => addCosts(total, each.cost),
        { energy: 0, power: {}, anyPower: 0 } as Cost,
      );
      // R821.1.c.3 — "If the chosen card's Equip cost does not contain [A], it
      // can still be paid, but will not be reduced." So this takes what is
      // there rather than going negative.
      const reducedPower: PowerCount = { ...cost.power };
      for (const [domain, amount] of Object.entries(effect.reduce.power)) {
        const key = domain as keyof PowerCount;
        reducedPower[key] = Math.max(0, (reducedPower[key] ?? 0) - amount);
      }
      cost = {
        energy: Math.max(0, cost.energy - effect.reduce.energy),
        power: reducedPower,
        anyPower: Math.max(0, cost.anyPower - effect.reduce.anyPower),
      };

      const player = seatOf(state, context.controller);
      const sourceCard = state.cards[context.sourceId];
      const remaining = spend(player.runePool, cost, {
        kind: "activateAbility",
        ...(sourceCard === undefined ? {} : { sourceType: sourceCard.type }),
        inShowdown: state.showdown !== null,
      });
      // R821.1.c.5 — "If the chosen card's Equip cost can't be paid … it stays
      // in its current location, Attached to anything it was already Attached
      // to." Not an error: the ability simply does nothing.
      if (remaining === undefined) return { state, events: [] };

      // R434.1.g/h — re-attaching to the same Top-Most Card does nothing, and
      // R821.1.c.5's "stays where it was" covers it, so the cost is not spent.
      if (gear.attachedTo === context.sourceId) return { state, events: [] };

      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [context.controller]: { ...player, runePool: remaining },
          },
          permanents: {
            ...state.permanents,
            // R434.1.f/R434.4 — attaching elsewhere detaches it from wherever
            // it was, and its location becomes its new host's.
            [gearId]: {
              ...gear,
              attachedTo: context.sourceId,
              location: host.location,
            },
          },
        },
        events: [
          {
            type: "costPaid",
            playerId: context.controller,
            cardId: gearId,
            cost,
          },
          {
            type: "attached",
            playerId: context.controller,
            cardId: gearId,
            to: context.sourceId,
          },
        ],
      };
    }

    case "disempower": {
      const targetId =
        effect.targetIndex === undefined
          ? context.sourceId
          : context.targets[effect.targetIndex];
      const permanent =
        targetId === undefined ? undefined : state.permanents[targetId];
      // R442.1.a — "Disempowering affects only cards that are currently
      // Empowered", and R442.1.a.1 makes the rest silent.
      if (permanent === undefined || permanent.empowered !== true) {
        return { state, events: [] };
      }
      const { empowered: _gone, ...rest } = permanent;
      return {
        state: {
          ...state,
          permanents: { ...state.permanents, [targetId!]: rest },
        },
        events: [
          {
            type: "disempowered",
            playerId: controllerOf(state, targetId!),
            cardId: targetId!,
          },
        ],
      };
    }

    case "forEachPlayer": {
      // R303.2.a sequences everything simultaneous by turn order "starting
      // with the current Turn Player"; for an effect, the natural reading of
      // "each player" starts with its controller and goes round from there.
      const players: PlayerId[] =
        effect.who === "eachOpponent"
          ? opponentsOf(state, context.controller)
          : turnOrderFrom(state, context.controller);

      return eachInTurn(state, effect.each, context, players, context.targets.length);
    }

    case "forEachPlayerRest":
      return eachInTurn(
        state,
        effect.each,
        context,
        effect.players,
        effect.baseTargets,
      );

    case "raiseVictoryScore": {
      return {
        state: {
          ...state,
          victoryScoreBonus: (state.victoryScoreBonus ?? 0) + effect.by,
        },
        events: [{ type: "victoryScoreRaised", by: effect.by }],
      };
    }

    case "detach": {
      const targetId = context.targets[effect.targetIndex];
      const gear = targetId === undefined ? undefined : state.permanents[targetId];
      // Nothing to detach, or it was not attached to begin with.
      if (targetId === undefined || gear?.attachedTo === undefined) {
        return { state, events: [] };
      }

      const { attachedTo: host, ...loose } = gear;
      return {
        state: {
          ...state,
          permanents: { ...state.permanents, [targetId]: loose },
        },
        events: [
          {
            type: "detached",
            playerId: gear.controller,
            cardId: targetId,
            fromCardId: host,
          },
        ],
      };
    }

    case "channel": {
      const done = channelRunes(
        state,
        context.controller,
        effect.count,
        effect.exhausted === true,
      );
      if (done.channelled >= effect.count || effect.ifShort === undefined) {
        return { state: done.state, events: done.events };
      }
      // R430.3 short-changed them, so the card's own fallback runs.
      const fallback = execute(done.state, effect.ifShort, context);
      return {
        state: fallback.state,
        events: [...done.events, ...fallback.events],
        ...(fallback.pause === undefined ? {} : { pause: fallback.pause }),
      };
    }

    case "burnOutPoint": {
      const opponents = opponentsOf(state, context.controller);
      const answered = context.answer?.[0];
      const chosen =
        opponents.find((id) => id === answered) ??
        (opponents.length === 1 ? opponents[0] : undefined);
      if (chosen === undefined) {
        // More than one opponent and no answer yet, so R431.2.c is a real
        // choice. It belongs to the player who burned out.
        return {
          state,
          events: [],
          pause: {
            decision: {
              player: context.controller,
              prompt: { kind: "chooseOpponent", legal: opponents },
            },
            resume: { op: "burnOutPoint" },
            context,
          },
        };
      }

      const them = seatOf(state, chosen);
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [chosen]: { ...them, points: them.points + 1 },
          },
        },
        events: [{ type: "pointGained", playerId: chosen, points: 1 }],
      };
    }

    case "scorePoint": {
      const chosen =
        effect.targetIndex === undefined
          ? context.controller
          : context.targets[effect.targetIndex];
      // A player id is the only thing this can name; anything else is a card,
      // and a card cannot score.
      if (!isSeated(state, chosen)) return { state, events: [] };

      const player = seatOf(state, chosen);
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [chosen]: { ...player, points: player.points + effect.amount },
          },
        },
        events: [
          { type: "pointGained", playerId: chosen, points: effect.amount },
        ],
      };
    }

    case "empowerSelf": {
      // R107.4.c — the Champion Legend is a Game Object and can be Empowered,
      // and has no permanent to carry the status. Same shape as its exhausted
      // state, and for the same reason.
      const player = seatOf(state, context.controller);
      if (player.legend === context.sourceId) {
        if (player.legendEmpowered === true) return { state, events: [] };
        return {
          state: {
            ...state,
            players: {
              ...state.players,
              [context.controller]: { ...player, legendEmpowered: true },
            },
          },
          events: [
            {
              type: "empowered",
              playerId: context.controller,
              cardId: context.sourceId,
            },
          ],
        };
      }

      const permanent = state.permanents[context.sourceId];
      // R441.1.c — "if a Game Object is instructed to be Empowered when it is
      // already Empowered, nothing additional happens."
      if (permanent === undefined || permanent.empowered === true) {
        return { state, events: [] };
      }
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            [context.sourceId]: { ...permanent, empowered: true },
          },
        },
        // R827.2.a — becoming Empowered "is an event other Game Effects and
        // Triggered Abilities can reference", so it is reported.
        events: [
          {
            type: "empowered",
            playerId: context.controller,
            cardId: context.sourceId,
          },
        ],
      };
    }

    case "banishThenPlay": {
      const targetId = context.targets[effect.targetIndex];
      const battlefieldId = context.targets[effect.destinationIndex];
      if (targetId === undefined || battlefieldId === undefined) {
        return { state, events: [] };
      }
      const permanent = state.permanents[targetId];
      if (permanent === undefined) return { state, events: [] };
      if (state.battlefields[battlefieldId] === undefined) {
        return { state, events: [] };
      }

      // R427 — banished first, and R186.1 means a token banished this way
      // ceases to exist rather than coming back.
      const owner = ownerOf(permanent);
      if (state.cards[targetId]?.isToken === true) {
        const { [targetId]: _gone, ...rest } = state.permanents;
        return {
          state: { ...state, permanents: rest },
          events: [{ type: "banished", playerId: owner, cardId: targetId }],
        };
      }

      // R462.2.a — "If an effect would require a Unit be played to a
      // Battlefield with a Staged Combat or a Combat in Progress, where the
      // controller of the played unit is not a participant, instead the Unit
      // is played to its controller's Base", and R449.2 closes a battlefield
      // two *other* players already stand on. The same redirect the token and
      // move effects already make, and this was the one play path without it:
      // "banish a friendly unit, then its owner plays it to any battlefield"
      // takes the battlefield as a chosen target, and nothing stopped that
      // choice being a fight two other people were already having. Found by a
      // soak of 520 games — once, in a three-seat game, and unreachable in a
      // Duel where there is no third side to be.
      const destination: Location =
        closedToOutsiders(state, battlefieldId, owner)
          ? { kind: "base", player: owner }
          : { kind: "battlefield", id: battlefieldId };
      return {
        state: {
          ...state,
          permanents: {
            ...state.permanents,
            // R359.2.c — it is played, so it enters exhausted at the chosen
            // location. Its owner plays it, so its owner controls it (R56).
            [targetId]: {
              ...permanent,
              controller: owner,
              exhausted: true,
              location: destination,
              damage: 0,
            },
          },
          playedThisTurn: {
            ...state.playedThisTurn,
            [owner]: [...playedBy(state, owner), targetId],
          },
        },
        events: [
          { type: "banished", playerId: owner, cardId: targetId },
          // A real play, so R383.4.a's play effects trigger off it.
          { type: "unitPlayed", playerId: owner, cardId: targetId },
        ],
      };
    }

    case "conditional": {
      const branch = holds(state, effect.test, context)
        ? effect.then
        : effect.otherwise;
      if (branch === undefined) return { state, events: [] };
      return execute(state, branch, context);
    }

    case "seq": {
      let current = state;
      const events: GameEvent[] = [];

      for (const [index, step] of effect.steps.entries()) {
        const outcome = execute(current, step, context);
        current = outcome.state;
        events.push(...outcome.events);

        // A step that stopped to ask takes the rest of the sequence with it,
        // or the steps after it would run before the answer arrived — which is
        // how "look at the top 3, keep 1" used to draw a card that was still
        // among the three on offer.
        if (outcome.pause !== undefined) {
          const rest = effect.steps.slice(index + 1);
          return {
            state: current,
            events,
            pause: {
              ...outcome.pause,
              resume:
                rest.length === 0
                  ? outcome.pause.resume
                  : { op: "seq", steps: [outcome.pause.resume, ...rest] },
            },
          };
        }
      }

      return { state: current, events };
    }

    default: {
      const unhandled: never = effect;
      return { state, events: [] };
    }
  }
}
