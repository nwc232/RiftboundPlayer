# The target decks

The project's forcing function: real constructed lists. Every mechanic gets
built because one of these cards asks for it, not because a survey said it was
common.

The first two were the MVP's pair. **Deck 3 was chosen on different grounds**
— not to play well, but to reach what the first two never touched. Between
them Vex and Rengar print nine of the engine's twenty-one keywords, and the
other twelve had been built and only ever run against test fixtures. That is
where bugs sit.

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

## Deck 3 — Deceiver (Mind / Order)

**Legend:** Deceiver — *When you conquer or hold, you may discard 1 and exhaust
me to play a ready Reflection unit token there. It becomes a copy of another
unit there. Give it [Temporary].*
**Champion:** LeBlanc, Everywhere at Once

| # | Card |
|---|---|
| 3 | Mirror Image *(signature — R103.2.d's whole allowance)* |
| 3 | Keeper of Masks |
| 3 | Sprite Mother |
| 3 | Sprite Call |
| 2 | Petal Pixie |
| 2 | Shadow's Call |
| 2 | Sumpworks Map |
| 3 | Gemcraft Seer |
| 2 | Jeweled Colossus |
| 3 | Downstage Dramatics |
| 2 | Frigid Touch |
| 3 | Apprentice Mage |
| 2 | Solari Sunhawk |
| 2 | Lecturing Yordle |
| 2 | Dredge Up |
| 2 | Cloth Armor |

**Battlefields:** Black Flame Altar · Altar to Unity · Back-Alley Bar
**Rune Pool:** 8 Mind · 4 Order

### Why this list

Mind and Order were the two domains the first two decks never covered, and
they are where the untested keywords concentrate. The list prints seven of
the twelve: **[Temporary]**, **[Repeat]**, **[Empower]**, **[Vision]**,
**[Shield]**, **[Tank]**, **[Flow]** and **[Quick-Draw]**.

The legend alone reached four things the engine could not previously say:

| What Deceiver needed | Why it did not exist |
|---|---|
| A token played *there* | "There" is the battlefield the score happened at. R107.4.b puts the Legend Zone nowhere, so `sourceLocation` — which answers "here" — had nothing to give |
| A target chosen *there* | Same reason, on the filter side rather than the destination side |
| A chosen discard as an ability cost | R422.1.a leaves *which* card to the discarding player |
| A copy granted a keyword as it enters | R477.1.b and R184.3 on the same token |

Four more came from the rest of the list:

- **Keeper of Masks** — "They become copies of **me**", a copy source that was
  never chosen and so is nowhere in `targets`.
- **Petal Pixie** — "+1 Might **for each**", an amount that is a count of the
  board rather than a number.
- **Shadow's Call** — "a friendly unit **without [Temporary]**", the first
  negative keyword filter.
- **LeBlanc, Everywhere at Once** — "Your [Temporary] effects at my
  battlefield **don't trigger**", which suppresses the ability a keyword
  stands for while leaving the keyword itself in place.

And one from a battlefield: **Back-Alley Bar**'s "when a unit moves *from
here*" wanted a movement trigger that watches an origin rather than a
destination.

---

## Decks 4 and 5 — sent by players

Two lists a pair of testers asked for. Both were audited against the engine
before a card was authored: thirteen mechanisms were missing between them, and
all thirteen were built first.

Seven cards of each were already authored for decks 1 and 2 and are referenced
rather than written twice — which is what turned up the id collision the
prefixing in `expand` now prevents: four of these decks play Discipline, and
without a per-deck prefix they would all have called their copies
`discipline-1`.

### Rogue Assassin (Calm / Fury) — the Akali list

**Legend:** Rogue Assassin · **Champion:** Akali, Deadly Weapon
**Battlefields:** Threshold of the Gray · Star Spring · Targon's Peak
**Runes:** 6 Fury · 6 Calm

What it needed that did not exist:

| Card | What was missing |
|---|---|
| Rogue Assassin | A Legend that can be **Empowered** — R107.4.c makes it a Game Object, and it has no permanent to carry the status |
| Akali, Deadly Weapon | Choosing "at a battlefield I moved **to or from**" — neither end is where she is by then |
| Thwonk!, Rogue Assassin | Choosing by **designation** — "an attacking unit", "a unit in a showdown" |
| Shuriken Flip | A target that may be **declined** — "up to one enemy unit" |
| Scuttle Crab | **Looking** at facedown cards, which R424.2.b says is explicitly not revealing |
| Brittle Steel | Killing a **chosen** thing. Only `killSelf` existed |

### Scorn of the Moon (Mind / Chaos) — the Diana list

**Legend:** Scorn of the Moon · **Champion:** Diana, Lunari
**Battlefields:** Abandoned Hall · Star Spring · Rockfall Path
**Runes:** 5 Mind · 7 Chaos

Three of its cards worked on arrival because of work done for other reasons:
the Legend's "spend this Energy only during showdowns" is the card the
resource restrictions were built for, its activated ability needed the Legend
fix, and Rockfall Path's "units can't be played here" had been a test fixture.

| Card | What was missing |
|---|---|
| Thousand-Tailed Watcher, Moonfall | Modifying **every** unit that matches. R355.5.a: criteria are not choices, so [Deflect] does not tax it |
| Moonfall | A battlefield "**where you have units**", and moving something to a *chosen* one |
| Hwei, Diana Lunari | Branching on a **card's type** — the card has to be found first, so the finding is part of the effect |
| Last Rites | A cost paid out of the **trash** |
| Fizz, Trickster | A granted **play from the trash**, waiving only the Energy half |
| Hard Bargain | Asking the **opponent** to pay, mid-resolution. The only card in the pool that does |
| Abandon | Countering **to hand** instead of the trash |

---

## Status

**All 38 distinct cards are authored**, in `src/decks/vex.ts` and
`src/decks/rengar.ts`, with both battlefield sets. `src/decks/index.ts`
assembles them into a legal `GameSetup`, and the front-end's two deck pickers
choose which two face off; `tests/decks.test.ts` checks the
R103 requirements and `tests/playthrough.test.ts` plays 25 full games.

Three things about a card are still approximations rather than the rule,
and they are written up with the rest in `mechanic-survey.md`:

| Card | Approximation |
|---|---|
| Switcheroo | "two units **at the same battlefield**" — the second choice is not tied to the first, because filters are positional and independent |
| Thrill of the Hunt | "plays it to any battlefield" — the destination is chosen at finalization rather than during the sub-play |
| Sneaky Deckhand | "an open battlefield" — the rules never define "open"; read as *uncontrolled* |
