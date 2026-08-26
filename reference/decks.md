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
depends on is built. **14 of ~38 are authorable now**, up from 3 when the
lists were first measured.

### Authorable today

Discipline · Punch First · Ferrous Forerunner · Rebuke · En Garde ·
Pridestalker · Rengar, Trophy Hunter · Inferna · Irresistible Faefolk ·
Grim Apothecary · Kinkou Initiate · Nidalee, Cat Form · Noxus Hopeful ·
Pit Rookie · First Mate · Gust

### One thing away

| Card | Missing |
|---|---|
| Star-Crossed | two targets with *different* filters — the prompt carries one |
| Back Off | "if you played this from your hand" — a condition on the play's source zone |
| Evelynn, Entrancing | a "played from facedown" trigger gate |
| Kai'Sa, Survivor | [Accelerate] |
| Vilemaw | a passive comparing an enemy's Might to the source's |
| Sneaky Deckhand | "an open battlefield" — one more play permission, and the rules never define "open" |

### Still blocked

| Card | Needs |
|---|---|
| Gloomist | a *cost* on a triggered ability (R383.3.b) — "exhaust me to draw 1" |
| Vex, Apathetic | [Deflect] (R809); a target taken from the trigger's own event; a movement restriction |
| Kha'Zix, Mutating Horror | XP |
| Pyke, Dockside Butcher · Rampage | optional additional costs (R349, R355.1.a) |
| Astral Heron | a one-shot "your next card costs less" |
| Switcheroo | Swap Might (R433) |
| Boots of Swiftness | [Equip] / attachments (R718) |
| Stacked Deck · Sabotage · Thrill of the Hunt | look at the top N, reveal a hand, play a card ignoring its cost |
| Defy | counter with a cost ceiling — targets a chain item, not a permanent |
| Tideturner | swap two units' locations |
