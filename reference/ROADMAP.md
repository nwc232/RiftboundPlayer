# Road to a playable MVP

What "MVP" means here: **two real decks, two players, played start to
finish by clicking, with the engine enforcing the rules.**

Counts below come from the 1180-card pool in `riftbound-cards-full.json`
and the Core Rules, not from estimation. Deviations already tracked live
at the end of `mechanic-survey.md`; this file is about what is *absent*
rather than what is subtly wrong.

---

## 1. Where the engine stands

Built and tested (724 tests):

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
| Facedown Zone (R107.3, R421, R811) | Hide, the free play a turn later, R323.7 sweep |
| Costs (R356) | Base modification, additional costs, discounts, [Deflect] |
| Attachments (R434, R718, R818) | Effect Text, Might Bonus, [Equip] |
| XP (R728–733) | A number on the player |
| Two real decks | 38 cards, 6 battlefields, played start to finish |
| Front-end | React over `legalActions` + `pending` + the event stream |
| Replacement effects (R369.3) | How a unit enters the board |
| Replacement effects (R369–372) | Deaths, with R372's ordering through the queue |
| Replacement effects (R369.2, R437) | Damage: doubling, and Prevent with a consumable value |
| Resumable resolution (R321, R372) | An effect can stop mid-resolution and ask |
| Layers (R473–479) | 3 layers, fixpoint, dependency, snapshotting |
| Durations + delayed effects | `thisTurn`, `thisCombat`, `endOfTurn` |
| Tokens + copy (R179–187, R477.1.b) | Creation, ceasing to exist, copy-of-copy |
| Decisions | Engine suspends and asks; nothing proceeds until answered |
| Predict (R436) + [Vision] | Look at the top X, recycle any, order the rest |
| [Quick-Draw] (R819) | [Reaction] plus an attach-on-play, both derived |
| [Repeat] (R820) | Several costs, independent choices per execution |
| [Unique] (R825) | Deck construction only, which is all R825.4 asks |
| [Weaponmaster] (R821) | Equip on the way in, at a discount, ignoring timing |
| [Flow] (R829) | Played from the trash for an alternate cost, then banished |
| Play zones | Hand, Champion Zone, Facedown Zone, trash — one shape |
| Tags (R133.8) + supertypes (R133.7) | Copyable; deck construction, filters, scopes |
| Dependent keywords (R824, R828) | [Level N] and [Empowered], one mechanism |
| [Empower] (R827) + the Empower action (R441) | A binary status on the permanent |
| [Hunt] (R823) | Conquer-or-Hold XP, with summed values |
| Modal effects | "Choose one —", per arm targeting, per execution |
| Cost-valued keywords | Granted [Repeat]/[Flow]/[Empower]; instance counts |
| Tier 4 verbs | Recycle from hand, spend XP, spend a buff, once per turn |
| Per-player views (R107) | `viewOf` — hands, decks and facedown cards hidden |
| Players as subjects (R133) | A card can choose a player, not just a card |
| Discard (R422), Burn (R440), Reveal (R424), Disempower (R442) | Effects and costs |

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

Of these, only **replacement effects** remain untouched. Conditionals,
[Equip], [Hidden] and [Deflect] are built; [Empower] and XP/[Level] have
their foundations (XP is a number now; [Level] is one Condition away).


| Missing | Cards | Notes |
|---|---|---|
| **Replacement effects (R369–375)** | ~30+ | "As X happens", "instead". Also closes R808.1.d.1 (a replaced death removing its own trigger). The largest single unbuilt mechanism. |
| **Conditional effects** (`if X then Y`) | 102 clauses | Second most common structural word after "when". Needed by the Poros, LeBlanc, Renekton. |
| **[Equip] / attachments (R718, R818, R821)** | 50 | Attached cards append rules text (R477.2.c) and Might bonuses (R477.3.d) — the layer system already has the slots. |
| **[Hidden] (R811)** | 44 | Needs a hidden zone and a second play timing. |
| ~~**[Empower] / [Empowered] (R827–828)**~~ | 46 / 42 | Done — a status plus a conditional-ability gate, which is exactly what it turned out to be. |
| **[Deflect] (R809)** | 39 | A targeting tax — interacts with target legality. |
| **XP / [Level] / [Hunt]** | ~10 | A per-player resource the engine has no concept of. |

### Tier 3 — smaller keywords

**Done.** [Ganking] 34, [Accelerate] 26, [Repeat] 24, [Flow] 17,
[Ambush] 14, [Weaponmaster] 12, [Legion] 10, [Vision] 9, [Quick-Draw] 5,
[Unique] 3.

[Ganking] was the one already "partly present", and partly was the
problem: it read the printed card, so Boots of Swiftness could grant it and
the unit wearing them still could not gank.

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
| ~~**[Hidden]**~~ | 5 | R811, R107.3 | Done — the zone, Hide, and the free play |
| ~~New trigger conditions (attack/defend/conquer/hold/move/win-combat/spell-played)~~ | ~8 | R383 | Done — plus the Legend Zone as a trigger source |
| ~~Return to hand~~ | 4 | R426 | Done |
| ~~**Buffs**~~ | 2 | R701–705 | Done |
| Cost modification ("costs 2 less") | 2 | R812 | Half done — static reductions work; a one-shot "your next card" does not |
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

**Progress: done.** All 38 distinct cards and both battlefield sets are
authored in `src/decks/`, and the CLI opens on the matchup. The three
places where a card is an approximation rather than the rule are listed in
`decks.md` and written up in `mechanic-survey.md`.

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

Both also want the conditional machinery.

**Resolved for the static half.** `costOf(state, player, card)` reads a
card's cost outside the layer pipeline, starting from
`characteristicsOf(...).cost` so a copy pays what it copied
(R477.1.b.1.a lists Cost among the copyable traits), then applying
`costModifier` abilities read off the printed card. [Legion] became a
Condition — R812.1.c's "a card different than the one with the Legion
ability has been Finalized by you on the same turn" — which needs
`playedThisTurn` on the state, cleared as each turn opens.

**Still open: Astral Heron.** "Your *next* card costs [2][A][A] less" is a
one-shot reduction with a lifetime, not a passive on the card being
reduced. It is closer to a delayed effect than to a `costModifier`, and it
also wants a "first card each turn" trigger — both of which the engine can
now express the pieces of, but neither of which is built.

---

## 4. Front-end

**The engine is already the right shape for one.** It is pure and
immutable — `applyAction(state, action) → { ok, state, events }` — so a UI
is a renderer over state plus a dispatcher of actions. Nothing needs
rewriting. What is missing is the seam:

| Needed | Why |
|---|---|
| ~~`legalActions(state, playerId)`~~ | Done. Enumerates candidates and filters them through `applyAction`, so it cannot disagree with the dispatcher. The demo's action list is driven by it. |
| ~~**Serialization**~~ | Done — `tests/decks.test.ts` round-trips every authored card through JSON, so "abilities are data" stays true rather than being a claim. |
| ~~Per-player views~~ | Done — `viewOf(state, player)` in `src/view.ts`, and the UI can render through one. |
| **Client/server boundary** | The remaining half: where the authority runs, and how two clients reach it. `viewOf` is what makes it a filter on what is *sent* rather than a rewrite. |
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
3. ~~**Two decks**, played start to finish in the CLI.~~ Done — and it
   did what it was supposed to. Two bugs no unit test could have found:
   a trigger with nothing legal to choose deadlocked the game (R355.8),
   and `legalActions` never offered a two-target spell, so four cards
   were unreachable. The second is the instructive one — a unit test
   casting Star-Crossed just passes the targets in; only something that
   has to *discover* the move could miss it, which is exactly a UI's
   position.
4. ~~**Front-end** over `legalActions` + `pending` + events.~~ Done —
   React + Vite in `src/ui/`, run with `npm run ui`. Hotseat for now; the
   panels are rendered symmetrically from the same data so "two windows,
   one per player" becomes a filter on what is passed in.
5. ~~**Replacement effects, Tier A**~~ (R369.3) — done. 66 cards, and
   [Accelerate] stopped being a special case: R805.1.a's "If you do, I
   enter ready" is now literally a conditional entry replacement.
6. ~~**Replacement effects, Tier B**~~ — deaths and damage both go through
   chokepoints. R372's ordering is asked for deaths through the task
   queue; for damage it is applied in creation order, because damage is
   dealt inside `execute`, which cannot suspend.
7. ~~**A resumable `execute`.**~~ Done. `execute` hands back what is left
   of a paused effect, `seq` carries its remaining steps into it, and the
   queue asks. Closed both outstanding replacement deviations: R372's
   ordering for damage, and a `seq` step running before a resolution-time
   choice was answered.

8. ~~**Tier 3**~~ — done, all ten keywords. Three of them paid for
   themselves by turning up bugs underneath: [Repeat] found a queue bug
   where a task's own enqueued work was discarded, silently truncating
   *any* effect that had to stop and ask twice (R372's death ordering and
   delayed effects were on that path); [Quick-Draw] found that a permanent
   simply *having* [Reaction] could not be played at Reaction timing at
   all; [Ganking] was reading the printed card rather than the
   characteristic.

9. ~~**Tags** (R133.8) and supertypes (R133.7)~~ — built, and with them
   R103.2.a.2 *in full* (both the champion tag and the Champion supertype),
   all of R103.2.d's Signature-card limits, R150's Equipment tag, and
   tag-scoped passives.

10. ~~**Dependent keywords**~~ — done. [Empowered] (R828.1.b.1) and
    [Level N] (R824.1.b.1) are the same sentence with different conditions —
    "while X, this card gains '[Text]'" — so both are one new layer
    modification, `grantAbility`. [Empower] (R827) and R441's Empower action
    came with them, because without a way to *become* Empowered the other
    half can never switch on. 103 cards between them.

    It turned up two bugs, both first exposed by [Empower] being the first
    keyword to expand into an *activated* ability: `legalActions` enumerated
    abilities off the printed card while `activateAbility` indexed
    `abilitiesOf`, so a derived activated ability was playable but never
    offered — and on a copied card the two indexed different abilities
    entirely. And a passive granted to the permanent granting it was
    collected too late to apply to itself.

11. ~~**Tier 4 verbs**~~ — done, and smaller than the leading-verb count
    suggested once each was read properly. `choose` was two things: 47
    clauses of *targeting*, long built, and 11 cards of "Choose one —",
    which is now built and finishes [Repeat]. `spend` was three: XP as an
    ability cost, a buff as an ability cost, and a resource restriction
    (still narrow — see the survey). `recycle` needed one op for "from your
    hand"; every other route to the bottom of the deck already existed.
    `use` was not a verb at all — twelve cards of *restrictions*, which
    `when` and `usesPerTurn` now cover.

12. ~~**Granting a keyword whose value is a Cost**~~ — done, and it closed
    the multiplicity gap with it, because they were the same gap: a set can
    neither hold a Cost nor count to two. `costKeywords` and
    `keywordCounts` sit beside `keywords` in `Characteristics`.

13. ~~**[Hunt]**~~ — done. The keyword glossary (R805–R829) is complete.

14. **A passive that reaches cards which are not permanents.** The one
    shape left over from everything above, and it has three claimants:
    Syndra's "your spells have [Repeat]", Marai Spire reducing a Repeat
    cost, and §3b's cost modification. R711 reads off-board objects on
    printed values, so this needs a scope the rules allow explicitly.

15. ~~**`viewOf`**~~ — done. R107's private zones filtered out of the state
    by the *engine*, so a client that never receives a card's identity
    cannot leak it however it is written. `npm run ui` has a seat selector;
    hotseat is still the default. The property the whole client/server
    split rests on is a test: `legalActions(viewOf(state, p), p)` equals
    `legalActions(state, p)`, so a view is a complete world to play from.

16. **The online server.** Deferred by decision (2026-08-28) until the
    engine is complete, and wanted as a piece of work in its own right —
    caching, sockets, authentication — rather than the smallest transport
    that would work. `viewOf` is the half every transport needs and is
    done. See §4 and §6 below.

---

## 6. What a complete engine still needs

Measured against the 1180-card pool on 2026-08-28, not estimated. Counts are
distinct card *names* whose printed text matches.

**Treat every count here as a lower bound on error, not a fact.** Two were
materially wrong when checked against the actual clauses: cost increases were
4, not 20 (most matches were "costs *no more than* X", a target filter built
months earlier), and modal effects were 11, not 47 (most `choose` clauses are
"choose a unit", which is targeting). A regex counts idioms, not mechanics.
Read the clauses before trusting a number to plan with.

### 6a. Named game actions the engine does not have

Each of these is an action the Core Rules define in its own R4xx section, so
none is a card-specific special case.

| Action | Rule | Cards | Note |
|---|---|---|---|
| ~~**Discard**~~ | R422 | 34 | Done — both halves. R422.4's effect discards as many as it can; R422.3's cost cannot be paid short. |
| ~~**Reveal**~~ | R424 | 26 | Done — a temporary *state* (R424.1.a), not a move, cleared when the spell finishes resolving (R424.1.a.3). |
| ~~**Disempower**~~ | R442 | 12 | Done — silent as an effect (R442.1.a.1), a refusal as a cost. |
| ~~**Burn**~~ | R440 | 8 | Done, including R440.4's burn-out-then-continue. |
| **Skip** | R443 | 1 | A replacement that replaces an event *with nothing* — including a whole phase. |

### 6b. Costs

The engine's costs are resources, almost everywhere. Several rules say
otherwise, and this one fix closes five separate deviations at once.

| Gap | Rule | Cards |
|---|---|---|
| ~~**Non-resource keyword costs**~~ | R820.1.c.2, R827.1.c.2, R829.1.c.2 | ~4 | Done — [Repeat], [Flow] and [Empower] hold an `AbilityCost[]`. |
| ~~**Cost *increases***~~ | R356.3 | 4 | Done — and all four are auras, so they needed the board sweep rather than the empty slot. |
| ~~**Non-resource *additional* costs**~~ (R356.2) | R356.2, R818 | ~10 | Done — an additional cost holds an `AbilityCost[]`. |
| ~~**Costs that choose**~~ | R355.1, R422.1.a | ~16 | Done — the choice rides in the action beside `targets`. "It wants a choice a cost paid inside finalization cannot ask for" was the wrong reading: R355.1 puts the choice at the *start* of playing, which is when the action is submitted, so nothing suspends. |
| **Reducing a keyword's cost** — Marai Spire, Stargazer | R812 | 2 |
| ~~**Resource restrictions**~~ | R160, R323 | 5 | Done — the restricted bucket was already there; what was missing was a vocabulary wide enough. Two axes: what the resources may buy (including that type's *own abilities*, which Fire Below the Mountain and Butcher of the Sands both name) and when they may be spent (Scorn of the Moon's "only during showdowns"). |

The earlier count of 20 for cost increases was wrong: most of those matches are
"costs *no more than* X", which is a target filter and was built long ago. Four
cards genuinely raise a cost, and every one of them is an aura over cards in a
hand — so they were blocked by §6d's passive-reach gap rather than by the empty
step-3 slot `costing.ts` was carrying.

### 6c. Vocabulary the pool uses and the engine cannot say

| Shape | Cards | Note |
|---|---|---|
| ~~**"Can't" / "cannot"** restrictions~~ | 17 | Done — one vocabulary, split at R711's line: `Restriction` in the layer pipeline for subjects that are permanents (chosen, moved, readied, dealt damage), `BoardRestriction` swept off the board for subjects that are not (a player scoring or playing, a spell being countered). The earlier count of 24 counted reminder text — "abilities that add resources can't be reacted to" is a rule, not a card. Two of the seventeen turned out not to be restrictions at all; see the survey. |
| ~~**Players as subjects**~~ | ~50 | Done — `TargetFilter` can name a player, and `PlayerId` is a `CardId` structurally, so nothing downstream needed widening. |
| ~~**Score a point** as an effect~~ | 12 | Done — and R471.1's near-victory restriction does not catch it, because it is not a conquer. |
| **Gain control of a card** | 3 | `takeControl` exists — the inverse ("they gain control") does not. |

### 6e. Other Modes of Play

R481 defines five sanctioned modes. The engine plays one of them.

| Mode | Rule | Players | Victory | Battlefields | Status |
|---|---|---|---|---|---|
| 1v1 (Duel) | R485 | 2 | 8 | 2 | Built — this is the engine. |
| 1v1 (Match) | R486 | 2 | 8 | 2, rotating between games | Built — `src/match.ts`. |
| FFA3 (Skirmish) | R487 | 3 | 8 | 3 | Built — engine, server and UI. |
| FFA4 (War) | R488 | 4 | 8 | 3 | Built — engine, server and UI. |
| 2v2 (Magma Chamber) | R489 | 4 | 11 | 3 | Deferred by decision. |

Everything below this line describes what building the two free-for-all modes
cost, and is kept because the estimate turned out to be worth checking against
the result. What is *left* is the last two paragraphs: teams, and the
deviations in `mechanic-survey.md`.

The earlier note here said a rules question came before a code question:
whether teams and allies were modelled well enough to design against. They
are — R489.8.a–i spells out all nine adjustments — so it is a specification
rather than a question. It is deferred because nobody wants to play it yet,
not because it is unclear.

Two things the rules settle that change the estimate:

- **R462 — combat is always exactly two players.** "Combat can only occur
  between Units controlled by exactly two players", and R462.3 makes *any
  choice* that would produce a three-way combat invalid. So `combat.ts`'s
  attacker/defender pair survives more players untouched. Combat was the
  part that looked expensive; it is not.
- **R489.8.e redefines "friendly" to include a teammate's objects** — and
  friendly/enemy resolves in exactly one place, `collectCandidates` in
  `decisions.ts`. The card-facing half of teams is a lookup change, not a
  sweep over 25 filter sites.

**The mechanical part.** Measured on 2026-09-04: `PlayerId = "p1" | "p2"`
and the two literals appear **109 times across 22 files**, of which 15
compute "the opponent" as *the other one*. The type checker finds every one.

**The genuinely new part**, shared by every mode with more than two players:

- `opponentOf` is conflating two different things. Three sites mean *next in
  turn order* (`turn.ts`, `chain.ts`, `showdown.ts`); the rest mean *the one
  other player*. They have to be told apart before anything else moves.
- Passing is counted against a hardcoded two — `consecutivePasses >= 2`,
  `priorityPasses < 2`. R347.2.a is "all players have passed once in
  sequence".
- R194.2 wants points ≥ the Victory Score **and more than any other player**.
  `checkForWinner` compares against one opponent.
- R431.2.c — a player who Burns Out *chooses* an opponent to gain the point.
  Today it is handed to the only candidate.
- New legality with no analogue today: R447.2.a and R462.1–.2 make a
  battlefield with a staged or ongoing combat an invalid destination *and* an
  invalid place to play a unit, for anyone not already involved; R449.2
  forbids moving where two other players already have units; R462.2.a
  redirects such a unit to its controller's Base and reassigns "here".
- R464.2.e.1 — players outside a combat still take Focus in the showdown
  rotation and still add triggers, in turn order, between attacker and
  defender.
- **R649–652, removal of a player, does not exist.** In a Duel a concession
  is "the other player wins". With three seats it is a subsystem: banish
  everything they control and own, replace their battlefield with a blank
  token battlefield (R652.2.a), remove their cards from the game, counter
  their chain items, and hand off turn, focus and priority.

**Already done, and a prerequisite either way:** ids belong to a seat rather
than to a deck (`instantiate(list, seat)`). With ids baked into decks, four
players could not have been seated at all.

**2v2 only, on top of all of that:** points are shared by a team (R489.8.d,
including that an ability checking whether *a player* gained points checks
the team); a teammate may act on your turn only when you invite them with
your own Priority (R489.8.a, R316.5.b.1) — a new action and a new priority
holder, and the most genuinely novel item on this list; battlefields your
teammate controlled at your Beginning Phase scoring step are disqualified
(R489.8.b, R469.1.a), which needs a per-turn snapshot; the Final Point
criteria change (R489.8.g.1); control is not shared (R489.8.c) and a
teammate's battlefield is an invalid destination (R447.2.b).

### 6d. Structural deviations worth closing

The running list at the end of `mechanic-survey.md` is the live count. The
ones that block whole card families rather than single cards:

- ~~**A passive cannot reach a card that is not a permanent.**~~ Closed by
  sweeping the board when the question is *asked*, so R711 is never
  contradicted — the card is never modified. `costAura`, `keywordAura` and now
  `restrictionAura` are the three that needed it.
- ~~**`viewOf` filters state but not events.**~~ Closed — `eventsFor` is the
  companion, and the UI keeps raw events so the seat filter applies at display
  time rather than once at dispatch. `viewOf` also stopped handing an
  opponent's pending decision its options.
- **Burn Out does not route through a chokepoint** (R369.2 calls it a
  replacement effect).
- **Temporary runs off the chain** (R816.1), so no [Reaction] can answer it.
- **Tier C chained replacements** (R370.2, R373.2) — deferred by decision.

**Deferred by decision, not dropped:** replacement-effect Tier C
(R373.2's sequences across simultaneous events). Written up at the end of
`mechanic-survey.md` with the rules example that makes it hard. Nothing in
either deck reaches it; it gets built when a card asks.

The ordering principle throughout has been: build the mechanism when a
real card needs it, and write down what is deliberately absent. That is
worth keeping — most of the deviations closed so far closed as a
side-effect of building the right mechanism, not by being chased.

## 7. Finding bugs without playing the game

Three real bugs were found by playing one game by hand. That is the wrong
primary method, and this section is about why the automated harness missed
them and what actually catches them.

### Why the playthroughs could not see them

The random playthroughs assert four things: every action `legalActions`
offers is accepted, nobody gets stuck, the game finds a winner, and no prompt
dangles at the end. All three bugs satisfied all four. A trigger that reaches
the chain and resolves having never been asked what it wanted looks exactly
like a turn going by — the engine was doing *less* than it should, quietly.

More random games would not have helped. The assertions had no opinion about
it.

### What does catch them: statements about what a board may never look like

`tests/invariants.ts`, run after every action in every playthrough:

- **R337.1** — the controller of the oldest pending chain item *must* complete
  the steps of playing it. So an item owing a choice with nobody being asked
  is a game that can only continue by throwing that choice away. Written down,
  this fired 48 times in 72 games and turned up two more faults on its own.
- **R462.3** — no battlefield holds three players' units.
- **R149.3** — no unattached gear is left standing at a battlefield.

The pattern worth repeating: an invariant is cheaper and finds more than an
extra thousand games, because it says what *wrong* looks like rather than
hoping a game happens to end badly.

### Where the harness is still blind, measured

Chain depth across 10,870 actions of random play, 50 games:

| depth | share |
|---|---|
| 0 | 67.2% |
| 1 | 28.1% |
| 2 | 4.4% |
| 3 | 0.33% |
| 4 | 0.02% |

The reported game reached depth 3. Random play reaches it in one state in
three hundred, and played a card *onto an existing chain* 80 times in 10,870
actions — 0.7%. Every bug found so far has lived in that region, and the
driver barely visits it.

### Done since

**a. The driver is biased toward responding.** `tests/random-play.ts` never
declines an answer, and prefers adding to a chain that already has something
on it. Cards played onto an existing chain went from 80 to 752 across the same
10,809 actions — nine times as many — and depth 3 from 0.33% to 0.79% of
states. Not a transformation: only [Reaction] and [Ambush] cards can be played
onto a chain at all, so the deck lists set the ceiling.

**b. Ability coverage is a floor, not a report.** `tests/coverage.test.ts`
soaks four matchups and asserts a minimum number of distinct authored
abilities actually fire. A floor rather than an exact set, because the set is
brittle across seeds and the thing worth catching is a *collapse* — which is
exactly what the two chain deadlocks were: fixing them took distinct triggers
reaching resolution from 49 to 77.

The number it exposed was **32 of 94**, about a third — and three quarters of
that shortfall turned out to be the oracle, not the engine. See (d).

**c. Structural invariants.** No permanent without a card; no location that is
not a real battlefield or a seated player's base; turn order and seats agree.
Aimed at what R652's Removal of a Player can damage.

**d. The measurement was wrong three times over — 32 became 63.** Raising
coverage started as "bias the driver toward cards it has not played yet", and
that turned out to be the smallest of four problems. In order of what they
cost:

1. **Nothing was shuffled but the main deck (R114).** "Each player shuffles
   their Main and Rune Decks, separately" — only the main deck was, so every
   game channeled a deck list's runes in the order it names them: seven Chaos,
   then five Calm, every game ever played. Which power a player could spend on
   which turn was fixed before anyone drew a card. Reported from live play,
   not by the harness.
2. **A spell's effect was never counted.** Spells author their effect as an
   `activated` ability but are played with `playSpell`, not
   `activateAbility` — and the soak counted the action. Twenty-eight cards
   read as never-exercised while resolving perfectly well. Counting the
   `spellResolved` event took 39 → 64.
3. **One battlefield of every three was never in play.** R485.5 has a player
   bring three and *choose* one; `matchup` always presented the first, so four
   battlefields across the five decks had never been in a game. Varying it by
   seed took 64 → 68 (at 30 seeds).
4. **The driver had no memory.** It now prefers a card the run has not played,
   85% of the time — the other 15% matters, because a board that takes turns to
   build is reached by repetition, not novelty. Worth roughly one ability.

One seed applied to every seat was also one *permutation* applied to every
seat: a mirror match dealt both players the same cards in the same order. The
seed is now salted per seat and per deck.

All three soaks — `playthrough`, `multiplayer`, `coverage` — now seed the deck
as well as the choices. They had been running a thousand games against a
single deal.

**e. A resolved trigger that targeted something must change something.**
Prototyped and currently clean; worth keeping once the deeper chains above are
common enough for it to mean anything.

**f2. The driver could not afford anything — 63 → 75.** The "expensive units"
guess in (g) was right about the symptom and wrong about the cause. Nothing
costing more than 3 was ever *offered* to the driver, and the largest pool it
assembled across four thousand games was 7.

R164.2 gives a rune two abilities and R416 puts no ready requirement on the
second: index 0 exhausts it for Energy and leaves it standing, index 1
**recycles** it back to the Rune Deck. Treated as one pool, recycling is the
most available action in the game — offered to every player at every moment —
and a uniform chooser took it that often. Traced over one game: 33 runes
channeled, 33 recycled, the board oscillating between nought and two for
eighteen turns. Holding recycles back everywhere (not only in the branch that
banks) was worth twelve abilities.

Some of the rest are genuinely out of reach: Vilemaw costs 8 Energy and 2
Calm Power, which is ten runes in one turn, and games end at 8 points long
before that. Those want targeted tests, not a better driver.

**h. A dropped answer, found by the widened soak.** One game spent 59,808
`decide` actions on turn 13 answering the same Predict. `park` puts a paused
effect at the front of the queue *without* setting `pending`, so between
parking and being asked, other outstanding work is legitimately queued in
front of it (R319.6). `applyResumeAnswer` delivered the answer to whatever sat
at position zero — a cleanup — which ignored it, and `applyAction` returned
ok. Every existing assertion held: nobody was stuck, nothing illegal was
offered, no decision was stranded.

The answer now goes to the first task still asking, and an answer that can be
placed nowhere is refused rather than accepted. The invariant that states it —
*an accepted answer changed something* — is compared against the whole board,
because R383.3.a's decline removes its chain item and the next item then asks
the identical question about what is now index 0.

**i. Targeted tests for what the soak cannot reach — and two more bugs.**
`tests/unreached.test.ts` builds the situation each unreachable ability names
and drives it through `applyAction`, because an ability whose effect is perfect
and whose trigger never reaches the chain is exactly as broken as one with no
effect, and only the first kind passes an `execute`-level unit test. Seventeen
of them, including the shapes the soak reaches only by luck: a combat carried
from the contesting move through to damage, an optional additional cost paid,
and a spell played onto a chain that already holds one.

What it found:

- **`combatStarted` only matched a battlefield.** "Here" means the battlefield
  itself when the source *is* one and the battlefield it stands at when the
  source is a unit — the reading `battlefieldScored` and `combatWon` already
  take. Matching only the first meant **Diana, Lunari's ability had no path to
  the chain at all**, and nothing said so, because the pool's only other user
  of the trigger is a battlefield card. Fixing it raised soak coverage on its
  own, 75 → 77.
- **Diana was authored against the wrong moment.** Her text says "when a
  showdown begins here"; she was triggering on R459's combat opening, a whole
  focus round later — which is what Threshold of the Gray actually says.
  R344's showdown is now its own trigger condition.

Three fixture mistakes are written into that file rather than quietly
corrected, because each looked like an engine bug first: R810.1.b only lets a
unit move battlefield-to-battlefield with [Ganking]; R355.8 refuses an answer
naming the same object for two filters; and R337.4 gives priority to the
controller of the newest chain item, so an opponent cannot answer a spell until
it is passed to them.

**j. Every authored ability is now exercised somewhere — and three more chain
bugs.** The soak reaches 76 of 94; `unreached.test.ts` builds the board for the
other 18, and `tests/targeted-abilities.ts` is the ledger joining them.
Checked from both ends: the test file asserts the list matches what it actually
fired (derived from the events, not declared, so it cannot become a list of
good intentions), and the soak asserts the two together leave nothing out. A
new card that neither random play reaches nor a test names fails there, which
is the point — it is a card nothing has ever run.

Writing the counterspell test found the same fault in three places. All three
let the chain move while an effect that stopped mid-resolution was still owed
an answer:

1. **`runTasks` refused everything but a Cleanup while the chain was up.** The
   guard was written for R319.3's cleanup deadlock and was too narrow: a
   `resumeEffect` is not new work but the unfinished tail of the item that just
   resolved, and R334.2.a completes it before continuing.
2. **`awaitDecisions` cleared `pending` whenever no *chain item* owed a
   choice**, erasing the question the queue had just put on the table. Only a
   question about a chain item is its to withdraw.
3. **Accepting a "you may" went straight back to the chain**, skipping the
   queue entirely — R334's HOT before FEPR.

Between them, Hard Bargain's "counter a spell unless its controller pays [2]"
asked nothing, priority went on passing, and the spell it was countering
resolved and dealt its damage. The opponent was finally asked whether to pay
for it once the chain was already empty.

The invariant that states it — *a parked effect owing an answer, with nobody
being asked* — fails 24 times against a revert of (2).

**k. A wide soak, and the last bug it found.** `npm run soak` — 520 games over
thirteen deck pairings including every three- and four-seat combination,
174,000 actions, every invariant on. Kept out of `npm test` at three minutes.

It found one thing the narrow soaks could not: `banishThenPlay` — "banish a
friendly unit, then its owner plays it to any battlefield" — takes its
destination as a chosen target, and nothing stopped that choice being a
battlefield two *other* players were already standing on. R462.2.a's remedy is
to play the unit to its controller's Base instead, which the token and move
effects already did and this one path did not. Once in 520 games, in a
three-seat game, and impossible in a Duel where there is no third side to be.

Re-run after the fix: **520 games, 174,175 actions, 0 unfinished, 0 problems.**

### Next, in order

**g. The soak still only reaches 76 of 94 by itself.** Not a correctness gap
any more, but the targeted tests exercise one board each while random play
exercises the combinations, and the difference is where the last three bugs
came from.

**f. Superseded — kept for the reasoning.** Bias the driver toward
responding. Weight the chooser toward playing
[Reaction] cards while a chain is up, and toward answering rather than
passing. Aims the soak the engine already has at the region where the bugs
are, for a few lines. The highest-value item here by some distance.

**b. Ability coverage.** Report which authored abilities never fire in a full
soak. Turns "we ran a thousand games" into "these twelve cards have never
been exercised", which is actionable in a way a pass count is not.

**c. Structural invariants.** No state field referring to a card that is not
in `state.cards`; every permanent's location a real battlefield or a seated
player's base. Cheap, and aimed squarely at what R652's player removal can
damage.

**d. A resolved trigger that targeted something must change something.**
Already prototyped and currently clean; worth keeping once (a) makes the
deeper chains common enough for it to mean anything.

---

## 8. Where things stand (2026-09-08)

`main` is current and everything below is on it. `npm test` is 1,327 tests
across 74 files; `npm run typecheck` and `npm run build` are clean.

### Rules coverage, measured

| | count |
|---|---|
| Top-level rules in the Core Rules | 409 |
| Every numbered statement, all depths | 2,381 |
| Distinct top-level rules cited in `src/` | 167 |
| …across the whole repo | 184 |
| Distinct full citations (with sub-rules) in `src/` | 600 |

**Read that carefully.** 167 of 409 is not "41% of the game". Of the 242
uncited, about 70 are bare section titles — *"100. Game Concepts"*, *"105.
Spaces"*, *"119. Game Objects"* — and most of the rest are definitions, the
Golden and Silver Rules, deck construction and tournament matter. Several are
implemented without being cited: R111–113 place the Legend, Champion and
Battlefields at setup, and the code cites R107/R108 for the zones instead.

The honest inventory of what is *not* built is the deviations list at the end
of `mechanic-survey.md`: **81 entries, 7 of them closed.** That list, not the
citation count, is what to read before claiming coverage.

### Presentation and deployment

Done, in this order, and the order mattered:

1. `main` was 61 commits behind and is now current — the repository's front
   door was a version of the project without any of the recent work in it.
2. CI on every push (typecheck, tests, build), badge in the README, with the
   520-game soak as a separate weekly job.
3. MIT licence plus the fan-project notice the card data requires.
4. A README that leads with the game, a screenshot, and *how the bugs get
   found* — which was the best thing here and lived only in commit messages.
5. GitHub Pages: the hotseat game as a static bundle, because the engine
   imports nothing from Node. **Live** at
   <https://nwc232.github.io/RiftboundPlayer/> — anyone can open the link and
   play a full game against themselves, no install and no account.
6. The container that carries the multiplayer server is now built and played
   against on every push (see below). It had never been built by anything.

### Next, in order

1. **Multiplayer deploy.** *Verified, and blocked only on a host account.*
   The image builds, boots on production dependencies alone, serves the
   front-end and runs a real two-seat game over a WebSocket — checked
   locally and now on every push by the `image` CI job, which builds the
   container, runs it, and plays a game against it via `scripts/smoke.ts`.
   Two things that would have failed a first deploy were fixed on the way:
   the base image was Node 20 while Vite 8 requires `^20.19 || >=22.12`, and
   `scripts/` sat outside the typecheck. `fly.toml` keeps one machine with
   no idle stop, because rooms live in memory — the reasons are in the file.
   What is left is genuinely only `fly launch` against an account, and
   `app = "riftbound"` will likely need renaming because the name is taken.
   `npm run smoke -- <url>` then checks the deployed site the same way.
2. **Persistence, then accounts.** *Moved ahead of the deploy, deliberately.*
   Rooms living in one process is the only reason `fly.toml` pins the app to
   a single machine that may never stop, so paying for an always-on machine
   buys a workaround for a limitation about to be deleted. Doing it first also
   keeps the hosting choice open and cheap.

   Done so far:

   - `Room` is proven to survive JSON — structurally, and by playing two
     rooms in step, one stored after every move. Both checks were confirmed
     by reintroducing the bug they guard: a `Date` where a number was is
     caught, and a store that forgets a column was *not*, until the fixture
     was changed to one where `earlyMulligans` carries something.
   - `src/server/store.ts` names where rooms live. `memoryStore` is what the
     `Map` was; a durable store is the same four methods. Asynchronous on
     purpose — a store across a network cannot be anything else, and paying
     that cost later means rewriting every caller.
   - The lost update that persistence introduces is fixed and, more to the
     point, reproduced first: `tests/store.test.ts` shows eight concurrent
     actions collapsing to **one** event on an ungated async store. Not a
     crash — the board stays legal and a player's move simply never happened.
     `inOrder` queues work per room; the same eight then all land.
   - `src/server/index.ts` reads and writes through the store. Verified by
     `npm run smoke`, which now also drops a player and brings them back on
     their token, since that is the path the refactor most disturbed.

   Next: a durable store behind `DATABASE_URL` (Postgres — it is what the
   postings name, and it works from any host including free tiers), then
   accounts on top of it.
3. **Event-stepped animation.** The one that makes the live demo *watchable*:
   render one step behind and play the event stream out, so a chain resolving
   is something you see rather than find already done. Needs per-event
   snapshots from the engine — which `applyAction` already threads through and
   throws away — and input locked while a sequence plays.

### Open UI questions, decided but unbuilt

- **Passing priority is 37% of all actions** and 96% of those passes happen
  with no card to play. No conditional auto-pass: it leaks whether you held a
  reaction. The remaining candidate is an *unconditional* brief window — the
  same beat every time, so the timing says nothing.
- **Indicators**: nothing on screen says who holds priority or focus, and the
  pass buttons do not say what they will cause.
- The opponent's hand renders at 46px, which is neither reachable nor legible.
