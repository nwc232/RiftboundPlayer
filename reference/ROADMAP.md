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
distinct card *names* whose printed text matches; treat them as close rather
than exact, since a regex cannot tell every idiom apart.

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
| **Non-resource costs** — discard, kill, recycle, banish as a cost | R356.2, R422.3, R820.1.c.2, R827.1.c.2, R829.1.c.2, R818 | ~15 |
| **Cost *increases*** — "costs [2] more" | R356.3 | 20 |
| **Reducing a keyword's cost** — Marai Spire, Stargazer | R812 | 2 |

`costing.ts` already names the second one: "Step 3, cost increases, has no card
yet." Twenty of them do.

### 6c. Vocabulary the pool uses and the engine cannot say

| Shape | Cards | Note |
|---|---|---|
| **"Can't" / "cannot"** restrictions | 24 | Only `restrictMovement` exists. A general restriction layer would cover playing, moving, scoring and being chosen. |
| ~~**Players as subjects**~~ | ~50 | Done — `TargetFilter` can name a player, and `PlayerId` is a `CardId` structurally, so nothing downstream needed widening. |
| ~~**Score a point** as an effect~~ | 12 | Done — and R471.1's near-victory restriction does not catch it, because it is not a conquer. |
| **Gain control of a card** | 3 | `takeControl` exists — the inverse ("they gain control") does not. |

### 6d. Structural deviations worth closing

Thirty-seven are on the running list at the end of `mechanic-survey.md`. The
ones that block whole card families rather than single cards:

- **A passive cannot reach a card that is not a permanent.** R711 reads
  off-board objects on printed values. Syndra's "your spells have [Repeat]",
  Marai Spire's cost reduction and §3b's cost modification all want the same
  scope.
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
