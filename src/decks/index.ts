import { basicRune } from "../builders.js";
import { copies } from "../deck.js";
import type { Deck, GameSetup } from "../deck.js";
import { modeFor } from "../modes-of-play.js";
import { SEATS } from "../state.js";
import type { CardId, CardInstance, Domain, PlayerId } from "../state.js";
import * as vex from "./vex.js";
import * as rengar from "./rengar.js";
import * as leblanc from "./leblanc.js";
import * as akali from "./akali.js";
import * as diana from "./diana.js";

/**
 * The two real constructed lists from `reference/decks.md`, assembled into
 * something `startGame` accepts. Each entry is `[card, count]`; `copies` gives
 * every copy its own id while they keep one name, which is what R103.2.b's
 * three-per-name limit counts.
 */
type Entry = [CardInstance, number];

/**
 * Every copy in one list, each with its own id.
 *
 * The `deck` prefix is what keeps two lists that share a card apart. Four of
 * these decks play Discipline; without it they would all call their copies
 * `discipline-1`, and two players would own the same card. R103.2.b's
 * three-per-*name* limit is unaffected — the name is what it counts, and the
 * name is untouched.
 */
/**
 * A deck as written down: cards and counts, with no ids yet.
 *
 * Ids are not part of a list because they are not part of a *deck* — they
 * belong to the copy a particular player brought to a particular game. Two
 * people can turn up with the same 40 cards, and R103 has nothing to say
 * against it; what cannot happen is one card being in both their decks at
 * once. Stamping the ids per seat is what keeps those two facts apart.
 */
export interface DeckList {
  name: string;
  legend: CardInstance;
  /** R103.2.a.1 — counted in the 40 and lifted into the Champion Zone. */
  champion: CardInstance;
  main: Entry[];
  /** R485.5 — three, of which one is used. */
  battlefields: CardInstance[];
  /** R103.3 — twelve, of the list's Domain Identity. */
  runes: [Domain, number][];
}

const VEX_MAIN: Entry[] = [
  [vex.vexApathetic, 1],
  [vex.evelynn, 3],
  [vex.enGarde, 2],
  [vex.gust, 2],
  [vex.stackedDeck, 3],
  [vex.defy, 3],
  [vex.discipline, 3],
  [vex.tideturner, 3],
  [vex.rebuke, 2],
  [vex.switcheroo, 2],
  [vex.backOff, 3],
  [vex.bootsOfSwiftness, 2],
  [vex.sneakyDeckhand, 3],
  [vex.starCrossed, 2],
  [vex.khazix, 2],
  [vex.astralHeron, 3],
  [vex.vilemaw, 1],
];

const RENGAR_MAIN: Entry[] = [
  [rengar.rengarTrophyHunter, 1],
  [rengar.sabotage, 2],
  [rengar.punchFirst, 3],
  [rengar.inferna, 3],
  [rengar.irresistibleFaefolk, 3],
  [rengar.pitRookie, 3],
  [rengar.thrillOfTheHunt, 3],
  [rengar.firstMate, 2],
  [rengar.grimApothecary, 2],
  [rengar.kinkouInitiate, 3],
  [rengar.pyke, 2],
  [rengar.rampage, 2],
  [rengar.nidalee, 3],
  [rengar.kaisa, 3],
  [rengar.noxusHopeful, 3],
  [rengar.ferrousForerunner, 2],
];

/**
 * Deck 3 — the LeBlanc Reflection list. R103.2.d caps Signature cards at three
 * across all names, which Mirror Image spends in full.
 */
const LEBLANC_MAIN: Entry[] = [
  [leblanc.leblancEverywhereAtOnce, 1],
  [leblanc.mirrorImage, 3],
  [leblanc.keeperOfMasks, 3],
  [leblanc.spriteMother, 3],
  [leblanc.spriteCall, 3],
  [leblanc.petalPixie, 2],
  [leblanc.shadowsCall, 2],
  [leblanc.sumpworksMap, 2],
  [leblanc.gemcraftSeer, 3],
  [leblanc.jeweledColossus, 2],
  [leblanc.downstageDramatics, 3],
  [leblanc.frigidTouch, 2],
  [leblanc.apprenticeMage, 3],
  [leblanc.solariSunhawk, 2],
  [leblanc.lecturingYordle, 2],
  [leblanc.dredgeUp, 2],
  [leblanc.clothArmor, 2],
];

/**
 * Deck 4 — the Akali list. Seven of its cards are the first two decks' and are
 * referenced from there rather than authored twice.
 */
const AKALI_MAIN: Entry[] = [
  [akali.akaliDeadlyWeapon, 1],
  [akali.scuttleCrab, 3],
  [akali.zhonyasHourglass, 3],
  [akali.shurikenFlip, 3],
  [akali.stellacornHerder, 3],
  [akali.jhinMurderousArtist, 3],
  [vex.discipline, 3],
  [vex.defy, 3],
  [vex.backOff, 2],
  [akali.block, 2],
  [vex.astralHeron, 3],
  [akali.longSword, 3],
  [akali.fallingStar, 2],
  [akali.thwonk, 1],
  [akali.akaliSilent, 1],
  [akali.nasusAscended, 2],
  [akali.brittleSteel, 1],
  [akali.perfectExecution, 1],
];

/** Deck 5 — the Diana list, on the same basis. */
const DIANA_MAIN: Entry[] = [
  [diana.dianaLunari, 1],
  [diana.hweiBroodingPainter, 3],
  [vex.tideturner, 2],
  [diana.travelingMerchant, 2],
  [diana.ravenbloomStudent, 3],
  [diana.thousandTailedWatcher, 2],
  [diana.fizzTrickster, 2],
  [diana.rideTheWind, 3],
  [diana.flash, 1],
  [diana.moonfall, 3],
  [vex.gust, 3],
  [diana.eclipse, 2],
  [vex.stackedDeck, 3],
  [diana.lastRites, 1],
  [diana.theSyren, 1],
  [diana.stupefy, 3],
  [diana.abandon, 1],
  [diana.hardBargain, 1],
  [vex.starCrossed, 2],
  [vex.vexApathetic, 1],
];

const VEX_BATTLEFIELDS = [
  vex.targonsPeak,
  vex.abandonedHall,
  vex.thresholdOfTheGray,
];
const RENGAR_BATTLEFIELDS = [
  rengar.emperorsDais,
  rengar.seatOfPower,
  rengar.starSpring,
];

// R103.4.b — battlefields carry no Domain, so any three are legal under any
// identity. These are borrowed from the pool rather than authored again.
const LEBLANC_BATTLEFIELDS = [
  leblanc.blackFlameAltar,
  leblanc.altarToUnity,
  leblanc.backAlleyBar,
];

// R485.5 — three each. Both lists borrow from the pool already authored;
// Rockfall Path is the one new one.
const AKALI_BATTLEFIELDS = [
  vex.thresholdOfTheGray,
  rengar.starSpring,
  vex.targonsPeak,
];
const DIANA_BATTLEFIELDS = [
  vex.abandonedHall,
  rengar.starSpring,
  diana.rockfallPath,
];


/**
 * One player's copy of a list: the cards themselves, with ids that belong to
 * that seat.
 *
 * `copies` gives each copy of a card its own id and leaves the name alone,
 * which is what R103.2.b's three-per-*name* limit counts. The seat prefix on
 * top of that is what lets two players bring the same list: `p1-gust-1` and
 * `p2-gust-1` are two cards with one name, which is exactly what they are.
 */
export function instantiate(
  list: DeckList,
  seat: PlayerId,
): { deck: Deck; cards: CardInstance[] } {
  const stamp = (card: CardInstance): CardInstance => ({
    ...card,
    id: `${seat}-${card.id}`,
  });

  const legend = stamp(list.legend);
  const main = list.main.flatMap(([card, count]) => copies(stamp(card), count));
  const battlefields = list.battlefields.map(stamp);
  const runeCards = list.runes.flatMap(([domain, count]) =>
    Array.from({ length: count }, (_, i) =>
      basicRune(`${seat}-${domain}-${i + 1}`, domain),
    ),
  );

  return {
    deck: {
      legend: legend.id,
      // R103.2.a.1 — a champion is one copy, so `copies` leaves its id alone.
      champion: `${seat}-${list.champion.id}`,
      mainDeck: main.map((card) => card.id),
      runeDeck: runeCards.map((card) => card.id),
      battlefields: battlefields.map((card) => card.id),
    },
    cards: [legend, ...main, ...battlefields, ...runeCards],
  };
}

export const DECK_LISTS: DeckList[] = [
  {
    name: "Vex, Gloomist",
    legend: vex.gloomist,
    champion: vex.vexApathetic,
    main: VEX_MAIN,
    battlefields: VEX_BATTLEFIELDS,
    runes: [["chaos", 7], ["calm", 5]],
  },
  {
    name: "Rengar, Pridestalker",
    legend: rengar.pridestalker,
    champion: rengar.rengarTrophyHunter,
    main: RENGAR_MAIN,
    battlefields: RENGAR_BATTLEFIELDS,
    runes: [["body", 7], ["fury", 5]],
  },
  {
    name: "Deceiver (LeBlanc)",
    legend: leblanc.deceiver,
    champion: leblanc.leblancEverywhereAtOnce,
    main: LEBLANC_MAIN,
    battlefields: LEBLANC_BATTLEFIELDS,
    runes: [["mind", 8], ["order", 4]],
  },
  {
    name: "Rogue Assassin (Akali)",
    legend: akali.rogueAssassin,
    champion: akali.akaliDeadlyWeapon,
    main: AKALI_MAIN,
    battlefields: AKALI_BATTLEFIELDS,
    runes: [["fury", 6], ["calm", 6]],
  },
  {
    name: "Scorn of the Moon (Diana)",
    legend: diana.scornOfTheMoon,
    champion: diana.dianaLunari,
    main: DIANA_MAIN,
    battlefields: DIANA_BATTLEFIELDS,
    runes: [["mind", 5], ["chaos", 7]],
  },
];

/**
 * A deterministic shuffle. The engine has no RNG on purpose — deck order is
 * taken as given so a game replays exactly — so shuffling belongs here, at
 * setup, where a seed makes it reproducible.
 */
function shuffled(ids: CardId[], seed: number): CardId[] {
  let s = (seed || 1) >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * One seed, many shuffles. R114 asks for the Main and Rune Decks to be shuffled
 * "separately", and every seat shuffles its own — so a single seed has to yield
 * a different stream per seat and per deck rather than one permutation applied
 * everywhere. Without the salt a mirror match deals both players the same cards
 * in the same order, which is not a shuffle at all.
 */
function stream(seed: number, ...salts: number[]): number {
  let s = seed >>> 0;
  for (const salt of salts) {
    s = (s ^ (salt + 0x9e3779b9 + (s << 6) + (s >>> 2))) >>> 0;
  }
  return s;
}

/**
 * R485.5 — each player brings three battlefields and one is used. Which one is
 * a choice; the first of each list is the default the demo and tests open on.
 *
 * `seed` shuffles every deck. Omitting it keeps list order, which is what the
 * tests want: the same game every time.
 */
export function matchup(
  options: {
    seed?: number;
    /**
     * Which lists play, by index into `DECK_LISTS`, in turn order. Two by
     * default; three or four seats a Skirmish (R487) or a War (R488).
     */
    decks?: number[];
    /** Battlefield overrides, by seat, for a test that needs a given one. */
    battlefields?: Partial<Record<PlayerId, CardId>>;
  } = {},
): GameSetup {
  const picks = options.decks ?? [0, 1];
  const mode = modeFor(picks.length);
  const turnOrder = SEATS.slice(0, picks.length);

  // R114 — "Each player shuffles their Main and Rune Decks, separately." The
  // rune deck matters more than it looks: a deck list names its runes in
  // domain blocks (`[["chaos", 7], ["calm", 5]]`), so an unshuffled rune deck
  // channels seven Chaos and then five Calm, in that order, every single game.
  const order = (deck: Deck, at: number): Deck =>
    options.seed === undefined
      ? deck
      : {
          ...deck,
          mainDeck: shuffled(deck.mainDeck, stream(options.seed, at, 1)),
          runeDeck: shuffled(deck.runeDeck, stream(options.seed, at, 2)),
        };

  const cards: CardInstance[] = [];
  const seats: GameSetup["seats"] = {};
  picks.forEach((pick, at) => {
    const id = turnOrder[at]!;
    // Ids are stamped per seat, so the same list at two seats is two sets of
    // cards — which is what makes a mirror match, and a four-player game with
    // repeats, possible at all.
    const seated = instantiate(DECK_LISTS[pick] ?? DECK_LISTS[0]!, id);
    cards.push(...seated.cards);
    // R488.4.b — "The player who is taking the first turn removes their
    // Battlefields." Only a War does this, and it is why four seats put three
    // battlefields on the table rather than four.
    const presents = at > 0 || mode.firstPlayerPresentsBattlefield;
    // R485.5 — a player brings three battlefields and *chooses* which to
    // present. The first of the list is the default the tests open on, but a
    // seeded setup varies it: fixing it meant two of every deck's three
    // battlefields had never been in a game, so their abilities had never run
    // in any playthrough, only in the tests written for them by name.
    const bringing = seated.deck.battlefields;
    const presented =
      options.battlefields?.[id] ??
      (options.seed === undefined
        ? bringing[0]!
        : bringing[stream(options.seed, at, 3) % bringing.length]!);
    seats[id] = {
      deck: order(seated.deck, at),
      ...(presents ? { battlefield: presented } : {}),
    };
  });

  return { cards, turnOrder: [...turnOrder], seats, mode: mode.id };
}
