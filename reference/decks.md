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

## What each card is still waiting on

Tracked against `ROADMAP.md` §3a. A card is authorable once every row it
depends on is built.

| Card | Still needs |
|---|---|
| Discipline, Punch First, Ferrous Forerunner | — *authorable* |
| Pit Rookie, First Mate, Gust, Rebuke, Star-Crossed | — *authorable* |
| Pridestalker, Kai'Sa, Vilemaw, Nidalee, Kha'Zix, Irresistible Faefolk | — *triggers built; some still want conditionals or XP* |
| En Garde, Kinkou Initiate, Pyke, Rampage, Vex Apathetic | conditional effects (`if` / `while`) |
| Noxus Hopeful, Astral Heron | cost modification |
| Inferna, Grim Apothecary, Rengar, Vilemaw, Nidalee | [Ambush] (R822) |
| Evelynn, Tideturner, Switcheroo, Back Off, Pyke | [Hidden] (R811) + the Facedown Zone |
| Boots of Swiftness | [Equip] / attachments (R718) |
| Stacked Deck, Sabotage, Sneaky Deckhand, Thrill of the Hunt | look-at-top-N, reveal hand, play-to-an-open-battlefield, play-ignoring-cost |
| Defy | counter with a cost ceiling |
| Kai'Sa | [Accelerate] |
| Kha'Zix | XP |
| Switcheroo | Swap Might (R433) |
