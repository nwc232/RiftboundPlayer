/**
 * The abilities `unreached.test.ts` exercises by building the board each one
 * names, rather than waiting for a random playthrough to assemble it.
 *
 * `coverage.test.ts` reads this to complete its account: the soak measures
 * what random play reaches, this covers what it cannot, and between them
 * nothing authored should go unexercised. Both ends are checked — the test
 * file asserts this list matches what it actually fired, and the soak asserts
 * the two together leave nothing out — so it cannot drift into a list of good
 * intentions.
 */
export const TARGETED: readonly string[] = [
  "Akali, Silent#1",
  "Astral Heron#0",
  "Diana, Lunari#0",
  "Falling Star#0",
  "Ferrous Forerunner#0",
  "First Mate#0",
  "Hard Bargain#0",
  "Hwei, Brooding Painter#0",
  "Jhin, Murderous Artist#0",
  "Kha'Zix, Mutating Horror#0",
  "Kinkou Initiate#0",
  "Mirror Image#0",
  "Nidalee, Cat Form#0",
  "Perfect Execution#0",
  "Pyke, Dockside Butcher#1",
  "Sprite Mother#0",
  "Stellacorn Herder#0",
  "Thousand-Tailed Watcher#0",
  "Thwonk!#0",
  "Vilemaw#1",
];
