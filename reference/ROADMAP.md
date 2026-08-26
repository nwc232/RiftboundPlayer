# Road to a playable MVP

What "MVP" means here: **two real decks, two players, played start to
finish by clicking, with the engine enforcing the rules.**

Counts below come from the 1180-card pool in `riftbound-cards-full.json`
and the Core Rules, not from estimation. Deviations already tracked live
at the end of `mechanic-survey.md`; this file is about what is *absent*
rather than what is subtly wrong.

---

## 1. Where the engine stands

Built and tested (174 tests):

| Area | State |
|---|---|
| Turn structure (R314–317) | All phases as queue tasks; R335 gating |
| Resources (R160s) | Rune pool, restriction buckets, Energy vs Power, Wild |
| Movement, Contested, Showdowns (R341–348) | Complete for 1v1 |
| Combat (R464–466) | Damage assignment as a player choice |
| Scoring (R467–471) | Conquer, Hold, victory at 8 |
| The Chain (R327–340) | LIFO, priority, timing from printed keywords |
| Triggered abilities (R383) | 8 conditions with subjects; gates (R383.2.a.1) |
| Playing a card (R355.2) | Valid locations, and permissions that widen them |
| Layers (R473–479) | 3 layers, fixpoint, dependency, snapshotting |
| Durations + delayed effects | `thisTurn`, `thisCombat`, `endOfTurn` |
| Tokens + copy (R179–187, R477.1.b) | Creation, ceasing to exist, copy-of-copy |
| Decisions | Engine suspends and asks; nothing proceeds until answered |

The decision mechanism matters more than its size suggests: **it is the
same shape a UI needs.** "Engine stops, offers a legal set, waits" maps
directly onto "highlight these cards, wait for a click."

---

## 2. Missing engine mechanics, ranked by cards unlocked

Counts are distinct cards in the pool carrying the keyword.

### Tier 1 — blocks a legal game

| Missing | Why it blocks |
|---|---|
| **Legend Zone + Champion Zone** | R103 *requires* a Champion Legend and a Chosen Champion. There is no zone for either, and `CardType: "legend"` is unused. A deck cannot legally exist without this. |
| ~~Deck construction + setup~~ | Done — R103 validation, R114–117 setup, R485 mode-of-play. |
| **Banishment zone (R427)** | Referenced by several cards; no zone exists. |
| **Win/loss beyond points** | Burn Out (R431) — decking out — is not modelled. |

### Tier 2 — big mechanisms, many cards

| Missing | Cards | Notes |
|---|---|---|
| **Replacement effects (R369–375)** | ~30+ | "As X happens", "instead". Also closes R808.1.d.1 (a replaced death removing its own trigger). The largest single unbuilt mechanism. |
| **Conditional effects** (`if X then Y`) | 102 clauses | Second most common structural word after "when". Needed by the Poros, LeBlanc, Renekton. |
| **[Equip] / attachments (R718, R818, R821)** | 50 | Attached cards append rules text (R477.2.c) and Might bonuses (R477.3.d) — the layer system already has the slots. |
| **[Hidden] (R811)** | 44 | Needs a hidden zone and a second play timing. |
| **[Empower] / [Empowered] (R827–828)** | 42 / 39 | A status plus a conditional-ability gate. |
| **[Deflect] (R809)** | 39 | A targeting tax — interacts with target legality. |
| **XP / [Level] / [Hunt]** | ~10 | A per-player resource the engine has no concept of. |

### Tier 3 — smaller keywords

[Ganking] 34 (partly present), [Accelerate] 26, [Repeat] 24, [Flow] 17,
[Ambush] 14, [Weaponmaster] 12, [Legion] 10, [Vision] 9, [Quick-Draw] 5,
[Unique] 3.

### Tier 4 — card vocabulary

86 distinct leading verbs. The real action verbs and their clause counts:

`deal` 50 · `choose` 47 · `give` 41 · `draw` 41 · `play` 29 · `kill` 25 ·
`spend` 25 · `move` 24 · `recycle` 19 · `use` 18 · `return` 11 ·
`disempower` 11

**17 effect ops exist today.** `deal`, `draw`, `give`, `kill`, `play`
(tokens) and `move` are covered or nearly so; `choose`, `spend`,
`recycle`, `return`, `use` are not. Another ~10 ops covers the bulk.

Trigger conditions: **8 built** (`unitPlayed`, `spellPlayed`,
`permanentKilled`, `battlefieldScored`, `phaseBegan`, `designated`,
`combatWon`, `unitMoved`), each carrying a subject — `self`, `friendly` or
`enemy` — which is how the card text distinguishes "when you play me" from
"when you play a unit" from "when an opponent plays a unit". That covers the
~9 families in the survey. Still absent: "when you play *another* card"
(~15), which needs a subject that excludes the source.

---

## 3. How many cards for a first trial

R103 sets the floor, and it is lower than it looks because of the
3-copies rule (R103.2.b):

| Requirement | Rule | Distinct cards needed |
|---|---|---|
| Champion Legend | R103.1 | 1 |
| Main Deck ≥ 40, max 3 copies per name | R103.2 | **~14–15** |
| Rune Deck = 12 | R103.3 | 1–6 (basic runes repeat) |
| Battlefields | R103.4 | 2–3 |

So **one legal deck ≈ 18–20 distinct cards**, and two decks ≈ **30–40**
if they share nothing.

**Recommendation:** two decks of ~15 distinct main-deck cards each, built
around two real Champion Legends, chosen so that between them they
exercise Tier-2 mechanics rather than 30 vanilla units. A deliberately
chosen 30 proves far more than an arbitrary 100.

Worth noting: a first trial does **not** need Tier 2 complete. A deck of
units, combat tricks and Deathknells is legal and playable on what exists
today, once Tier 1 is done.

---

## 3a. What two real decks actually demand

Measured against two real constructed lists — **Gloomist (Vex)** and
**Pridestalker (Rengar)**. Both are fully present in the card pool; the
Legends are filed under their titles alone (`Gloomist`, `Pridestalker`)
rather than the deckbuilder convention of "Vex, Gloomist".

**Authorable today: 3 of ~38 distinct cards** — Discipline, Punch First,
Ferrous Forerunner. That is the honest number, and it is the argument for
having measured rather than started authoring.

The demand is concentrated, and several of these are far smaller than the
Tier 2 list assumed:

| Mechanism | Cards | Rule | Size |
|---|---|---|---|
| ~~Conditional effects (`if`/`while`)~~ | 7 | R383.2.a.1 | Done — two forms, split by where the clause sits in the text |
| ~~**[Ambush]**~~ | 6 | R822 | Done — plus R355.2, which was never enforced at all |
| **[Hidden]** | 5 | R811, R107.3 | large — needs the Facedown Zone |
| ~~New trigger conditions (attack/defend/conquer/hold/move/win-combat/spell-played)~~ | ~8 | R383 | Done — plus the Legend Zone as a trigger source |
| ~~Return to hand~~ | 4 | R426 | Done |
| ~~**Buffs**~~ | 2 | R701–705 | Done |
| Cost modification ("costs 2 less") | 2 | R477.3 | small — the arithmetic layer already covers cost |
| ~~Move as an effect~~ | 4 | R454 | Done |
| Additional costs ("you may pay X as an additional cost") | 2 | R349 | medium |
| ~~**[Stun]**~~ | 2 | R423 | Done |
| ~~Ready a unit~~ | 2 | — | Done |
| ~~Banish~~ | 1 | R427 | Done |
| XP | 1 | — | medium — a new per-player resource |
| Swap Might | 1 | R433 | small |
| [Equip] / attachments | 1 | R718 | large |
| [Accelerate], [Legion], reveal-hand, tags | 4 | — | one card each |

**Reading of this:** the two big lifts are [Hidden] and [Equip]. Almost
everything else is a small effect op or a new trigger condition, and the
long tail of one-card mechanisms can wait.

Sensible order: trigger conditions and the small effect ops first (return,
ready, buff, banish, move, stun, cost modification), then conditionals,
then [Ambush], then [Hidden]. That takes both decks from 3 authorable
cards to most of the way there before either of the large keywords.

**Progress:** effect ops, trigger conditions, conditionals and [Ambush]
are done. Cost modification turned out not to belong with the small ops —
see §3b. Next is [Hidden], the last of the two large keywords, after which
both decks are mostly authorable.

Building [Ambush] turned up a bigger gap than the keyword: **R355.2 was
never enforced.** A unit could be played to any location at all. R355.2.a
limits it to "the controller's Base or a Battlefield the controller
controls", and R355.2.b is the hook every play permission hangs off —
[Ambush] is just the first one. `legalActions` picked the restriction up
for free, because it filters candidates through `applyAction`.

The lists themselves are recorded in `decks.md`, along with what each
individual card is still waiting on.

---

## 3b. Why cost modification was split out

It was grouped with the small effect ops on the assumption that "costs 2
less" is an arithmetic-layer modification like "+2 Might". It is not, and
the reason is the subject:

- **Might** is modified on a *permanent*. `characteristicsOf` runs the R477
  pipeline over `state.permanents`, and R711 says anything off the board is
  read on printed values alone.
- **Cost** is modified on a *card in hand*, which has no permanent at all.
  The pipeline returns printed values for it by design.

So neither of the two cards is a layer op away:

- **Noxus Hopeful** — `[Legion] — I cost 2 less` is a passive on a card in
  hand, gated on "you've played another card this turn", which the engine
  does not count.
- **Astral Heron** — "your *next* card costs 2 [A][A] less" is a one-shot
  reduction with a lifetime of its own, closer to a delayed effect than to a
  modifier that expires.

Both also want the conditional machinery. Conditionals first, then cost.

---

## 4. Front-end

**The engine is already the right shape for one.** It is pure and
immutable — `applyAction(state, action) → { ok, state, events }` — so a UI
is a renderer over state plus a dispatcher of actions. Nothing needs
rewriting. What is missing is the seam:

| Needed | Why |
|---|---|
| ~~`legalActions(state, playerId)`~~ | Done. Enumerates candidates and filters them through `applyAction`, so it cannot disagree with the dispatcher. The demo's action list is driven by it. |
| **Serialization** | `GameState` is plain data already, but `Ability` objects contain no functions *by design* — worth an explicit round-trip test so it stays true. |
| **Client/server boundary** | Even single-machine, deciding now whether the UI holds state or asks an authority avoids a rewrite. Hidden information (hands, [Hidden] cards) makes a per-player *view* of state necessary, not optional. |
| **Animation-friendly events** | The event stream already exists and is ordered — it is what a UI animates from. |

**Click-to-select maps onto the decision mechanism directly.** `pending`
already carries `legal: CardId[]`; the UI highlights exactly that set and
sends `{ type: "decide", targets: [clicked] }`. Targeting, damage
assignment and staged-showdown choice all work this way today.

Stack suggestion (unopinionated, since none of it is built): the engine is
plain TypeScript with no Node-only dependencies in the core, so it runs
unchanged in a browser. React or Svelte over the same `applyAction`.

---

## 5. Suggested order

1. ~~**Tier 1**~~ — done.
2. ~~**`legalActions`**~~ — done.
3. **Two decks** of ~15 distinct cards each, on current mechanics. Play
   them start to finish in the CLI. This will surface bugs no unit test
   has, because real decks combine things.
4. **Front-end** over `legalActions` + `pending` + events.
5. **Tier 2**, driven by which cards the two decks actually want —
   replacement effects and conditionals first, since they are structural
   rather than per-keyword.
6. **Tier 3/4** as card authoring demands them.

The ordering principle throughout has been: build the mechanism when a
real card needs it, and write down what is deliberately absent. That is
worth keeping — most of the deviations closed so far closed as a
side-effect of building the right mechanism, not by being chased.
