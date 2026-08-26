import { basicRune } from "../builders.js";
import { copies } from "../deck.js";
import type { Deck, GameSetup } from "../deck.js";
import type { CardId, CardInstance, Domain, PlayerId } from "../state.js";
import * as vex from "./vex.js";
import * as rengar from "./rengar.js";

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
function runes(owner: PlayerId, split: [Domain, number][]): CardInstance[] {
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

const VEX_RUNES = runes("p1", [
  ["chaos", 7],
  ["calm", 5],
]);
const RENGAR_RUNES = runes("p2", [
  ["body", 7],
  ["fury", 5],
]);

const vexMain = expand(VEX_MAIN);
const rengarMain = expand(RENGAR_MAIN);

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
  options: { p1?: string; p2?: string; seed?: number } = {},
): GameSetup {
  const order = (deck: Deck): Deck =>
    options.seed === undefined
      ? deck
      : { ...deck, mainDeck: shuffled(deck.mainDeck, options.seed) };

  return {
    cards: ALL_CARDS,
    p1: order(VEX_DECK),
    p2: order(RENGAR_DECK),
    choices: {
      p1: { battlefield: options.p1 ?? vex.abandonedHall.id },
      p2: { battlefield: options.p2 ?? rengar.seatOfPower.id },
    },
  };
}
