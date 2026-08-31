import { basicRune } from "../builders.js";
import { copies } from "../deck.js";
import type { Deck, GameSetup } from "../deck.js";
import type { CardId, CardInstance, Domain, PlayerId } from "../state.js";
import * as vex from "./vex.js";
import * as rengar from "./rengar.js";
import * as leblanc from "./leblanc.js";

/**
 * The two real constructed lists from `reference/decks.md`, assembled into
 * something `startGame` accepts. Each entry is `[card, count]`; `copies` gives
 * every copy its own id while they keep one name, which is what R103.2.b's
 * three-per-name limit counts.
 */
type Entry = [CardInstance, number];

function expand(entries: Entry[]): CardInstance[] {
  return entries.flatMap(([card, count]) => copies(card, count));
}

/** R103.3 — twelve runes. Ids are per player, since both decks use basics. */
function runes(owner: string, split: [Domain, number][]): CardInstance[] {
  return split.flatMap(([domain, count]) =>
    Array.from({ length: count }, (_, i) =>
      basicRune(`${owner}-${domain}-${i + 1}`, domain),
    ),
  );
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

const VEX_RUNES = runes("p1", [
  ["chaos", 7],
  ["calm", 5],
]);
const RENGAR_RUNES = runes("p2", [
  ["body", 7],
  ["fury", 5],
]);

const LEBLANC_RUNES = runes("p3", [
  ["mind", 8],
  ["order", 4],
]);

const vexMain = expand(VEX_MAIN);
const rengarMain = expand(RENGAR_MAIN);
const leblancMain = expand(LEBLANC_MAIN);

/** Every card either deck needs, ready for `startGame`'s registry. */
export const ALL_CARDS: CardInstance[] = [
  vex.gloomist,
  rengar.pridestalker,
  ...vexMain,
  ...rengarMain,
  ...VEX_BATTLEFIELDS,
  ...RENGAR_BATTLEFIELDS,
  ...VEX_RUNES,
  ...RENGAR_RUNES,
  leblanc.deceiver,
  ...leblancMain,
  ...LEBLANC_BATTLEFIELDS,
  ...LEBLANC_RUNES,
];

export const VEX_DECK: Deck = {
  legend: vex.gloomist.id,
  // R103.2.a.1 — the Chosen Champion is counted in the 40 but starts in the
  // Champion Zone, so it is listed here and lifted out by setup.
  champion: vex.vexApathetic.id,
  mainDeck: vexMain.map((card) => card.id),
  runeDeck: VEX_RUNES.map((card) => card.id),
  battlefields: VEX_BATTLEFIELDS.map((card) => card.id),
};

export const RENGAR_DECK: Deck = {
  legend: rengar.pridestalker.id,
  champion: rengar.rengarTrophyHunter.id,
  mainDeck: rengarMain.map((card) => card.id),
  runeDeck: RENGAR_RUNES.map((card) => card.id),
  battlefields: RENGAR_BATTLEFIELDS.map((card) => card.id),
};

export const LEBLANC_DECK: Deck = {
  legend: leblanc.deceiver.id,
  champion: leblanc.leblancEverywhereAtOnce.id,
  mainDeck: leblancMain.map((card) => card.id),
  runeDeck: LEBLANC_RUNES.map((card) => card.id),
  battlefields: LEBLANC_BATTLEFIELDS.map((card) => card.id),
};

/** Which battlefield a list opens on when the caller does not say. */
function defaultBattlefield(deck: Deck): CardId {
  if (deck === VEX_DECK) return vex.abandonedHall.id;
  if (deck === RENGAR_DECK) return rengar.seatOfPower.id;
  return deck.battlefields[0]!;
}

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
 * R485.5 — each player brings three battlefields and one is used. Which one is
 * a choice; these are the defaults the demo and tests start from.
 *
 * `seed` shuffles both main decks. Omitting it keeps list order, which is what
 * the tests want: the same game every time.
 */
export function matchup(
  options: {
    p1?: string;
    p2?: string;
    seed?: number;
    /** Which two lists face off. Defaults to the first two. */
    decks?: [Deck, Deck];
  } = {},
): GameSetup {
  const order = (deck: Deck): Deck =>
    options.seed === undefined
      ? deck
      : { ...deck, mainDeck: shuffled(deck.mainDeck, options.seed) };

  const [first, second] = options.decks ?? [VEX_DECK, RENGAR_DECK];

  return {
    cards: ALL_CARDS,
    p1: order(first),
    p2: order(second),
    choices: {
      // The first two lists keep the battlefields they have always opened on,
      // so the 25 tested games stay the same 25 games.
      p1: { battlefield: options.p1 ?? defaultBattlefield(first) },
      p2: { battlefield: options.p2 ?? defaultBattlefield(second) },
    },
  };
}
