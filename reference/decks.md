# The two target decks

The MVP's forcing function: two real constructed lists, pulled from online.
Every mechanic gets built because one of these cards asks for it, not because
a survey said it was common.

Both are fully present in `riftbound-cards-full.json`. The Legends are filed
under their titles alone — `Gloomist`, `Pridestalker` — rather than the
deckbuilder convention of "Vex, Gloomist".

---

## Deck 1 — Vex, Gloomist (Chaos / Calm)

**Legend:** Gloomist — *When you or an ally hold, you may exhaust me to draw 1.*
**Champion:** Vex, Apathetic

| # | Card |
|---|---|
| 3 | Evelynn, Entrancing |
| 2 | En Garde |
| 2 | Gust |
| 3 | Stacked Deck |
| 3 | Defy |
| 3 | Discipline |
| 3 | Tideturner |
| 2 | Rebuke |
| 2 | Switcheroo |
| 3 | Back Off |
| 2 | Boots of Swiftness |
| 3 | Sneaky Deckhand |
| 2 | Star-Crossed |
| 2 | Kha'Zix, Mutating Horror |
| 3 | Astral Heron |
| 1 | Vilemaw |

**Battlefields:** Targon's Peak · Abandoned Hall · Threshold of the Gray
**Rune Pool:** 7 Chaos · 5 Calm
**Sideboard:** 1 Decree of Focus · 3 Gust Monk · 1 Hard Bargain ·
1 Not So Fast · 3 Disarming Rake · 1 Baron Nashor

---

## Deck 2 — Rengar, Pridestalker (Body / Fury)

**Legend:** Pridestalker — *When you play a unit, give a unit +1 Might this turn.*
**Champion:** Rengar, Trophy Hunter

| # | Card |
|---|---|
| 2 | Sabotage |
| 3 | Punch First |
| 3 | Inferna |
| 3 | Irresistible Faefolk |
| 3 | Pit Rookie |
| 3 | Thrill of the Hunt |
| 2 | First Mate |
| 2 | Grim Apothecary |
| 3 | Kinkou Initiate |
| 2 | Pyke, Dockside Butcher |
| 2 | Rampage |
| 3 | Nidalee, Cat Form |
| 3 | Kai'Sa, Survivor |
| 3 | Noxus Hopeful |
| 2 | Ferrous Forerunner |

**Battlefields:** Emperor's Dais · Seat of Power · Star Spring
**Rune Pool:** 7 Body · 5 Fury
**Sideboard:** 2 Decree of Strength · 1 Unyielding Spirit · 2 Brittle Steel ·
2 Darius, Trifarian · 1 Thermo Beam · 2 Brynhir Thundersong

---

## Status

**All 38 distinct cards are authored**, in `src/decks/vex.ts` and
`src/decks/rengar.ts`, with both battlefield sets. `src/decks/index.ts`
assembles them into a legal `GameSetup`; `tests/decks.test.ts` checks the
R103 requirements and `tests/playthrough.test.ts` plays 25 full games.

Three things about a card are still approximations rather than the rule,
and they are written up with the rest in `mechanic-survey.md`:

| Card | Approximation |
|---|---|
| Switcheroo | "two units **at the same battlefield**" — the second choice is not tied to the first, because filters are positional and independent |
| Thrill of the Hunt | "plays it to any battlefield" — the destination is chosen at finalization rather than during the sub-play |
| Sneaky Deckhand | "an open battlefield" — the rules never define "open"; read as *uncontrolled* |
