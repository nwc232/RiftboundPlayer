# Riftbound Mechanic Survey

Purpose: catalogue the distinct kinds of effects and abilities in Riftbound
before designing the engine's effect system. Grounded in two sources:

- `riftbound-core-rules.md` — the official Core Rules (rule numbers cited
  as `RXXX`), which give the game's own vocabulary for these categories.
- `riftbound-cards-full.json` — 1180 cards across 5 sets (Origins,
  Unleashed, Spiritforged, Vendetta, Proving Grounds), covering all card
  types: unit, spell, gear, battlefield, legend, rune.

Card text below is quoted directly from card rules text (short, functional
game text, not narrative prose) for engineering reference.

**Coverage methodology (§6 revised after a first pass got this wrong):**
§1–5 come from pattern searches (regex over trigger words, bracket
keywords, replacement-effect language, etc.) run across all 1180 cards, so
those sections reflect the whole pool. §6 originally did not — it picked
from the 20 longest ability texts, which is a bad proxy for difficulty: it
mostly surfaces keyword-heavy vanilla units where parenthetical reminder
text ("(+2 Might while I'm an attacker)") inflates length without adding
real complexity, and it can miss short cards that are genuinely gnarly.
§6 below instead uses two independent, full-pool methods and reports where
they agree: (1) cross-referencing every card name the Core Rules themselves
cite in a worked example — i.e. the cases Riftbound's own rules authors
found necessary to explain — against the live card data; (2) a second regex
pass over all 1180 cards, stripped of reminder text, flagging structural
red flags (copy effects, control-change, chained "if you do", double
"instead," etc.) independent of length. Both methods converge on the same
two hardest *categories* — copy effects and control-change effects — which
is real signal, not coincidence from one shaky heuristic. This is still
pattern-matching across ~1180 cards, not a human reading of every one, so
treat §6 as "the hardest found by two independent systematic passes," not
"the provably hardest cards in the game."

A recurring theme worth flagging up front: Riftbound's rules already name
almost every category the task asked me to look for as a first-class rules
concept — Passive Abilities, Replacement Effects, Triggered Abilities, and
a **Layers** system (R473–479) for ordering continuous effects, similar in
spirit to Magic: the Gathering's layer system but with only 3 layers. This
is good news for engine design: the rules text is already telling us how
to structure the effect system, rather than us having to invent taxonomy
from scratch.

---

## 1. Triggered abilities

**Rules grounding:** R382–383 (Triggered Abilities), R808 (Deathknell),
R816 (Temporary), R817 (Vision), R823 (Hunt).

A triggered ability has a **Condition** (the "when/at/the Nth time" clause)
and an **Effect** (everything after). When the condition is met, it's
placed on the Chain like an activated ability (R383.3) — it does not
resolve immediately. Key nuances:

- **"You may" placement matters.** If "you may" is the *first* clause of
  the effect, the choice of whether to perform the ability at all is made
  at finalization (R383.3.a). If "you may" appears later, the ability
  always finalizes, and the choice is made on resolution (R383.3.a.3).
  This is a real branch point for a chain-item data model — it changes
  *when* the optionality is resolved, not just *whether* it's optional.
- **Costs can be embedded in the condition.** E.g. Ekko, Recurrent:
  `[Deathknell] Recycle me to ready your runes.` — "recycle me" is a cost
  paid at finalization, not part of the effect (R383.3.b).
  Insightful Investigator's `you may pay 2 XP to choose a card` is *not*
  a base cost because it's not the first clause — it's paid on resolution.
- **"Once each turn" / "the Nth time" triggers** need per-turn state
  tracked per source, and for simultaneous qualifying events the
  *controller* chooses which instance counts (R383.1.b).
- **Zone-timing edge case:** a triggered ability only fires if its source
  is still (or newly) in the zone where the ability is active *at the
  moment the condition is checked* (R383.2.c) — e.g. Viktor's death
  trigger doesn't fire if Viktor and the watched unit die simultaneously.

### Trigger event taxonomy (by frequency across the card pool)

| Event family | Example trigger phrasing | Notes |
|---|---|---|
| **Play** (145 occurrences) | "When you play me" | The single most common trigger. Codified as "Play Effects" (R383.4.a) — technically a triggered ability whose condition is the source being played. |
| **Territory control**: attack/conquer/hold (~140 combined) | "When I attack", "When you conquer", "When you hold here" | Riftbound-specific: Conquer/Hold are outcomes of contesting a Battlefield. `Hunt` (R823) is literally "When I Conquer or Hold, gain X XP" as a keyword shorthand. |
| **Death** (~40) | "When I die", `[Deathknell]` | Deathknell (R808) is the keyword shorthand; the trigger is specifically "sent to the Trash" — a replaced death (see §3) removes the trigger entirely. |
| **Movement** (~30) | "When I move", "when I move to a battlefield" | |
| **Combat outcome** (~9) | "When I win a combat" | |
| **Casting/playing other cards** (~15) | "When you play a spell/unit" | Triggers off events elsewhere, not the source itself. |
| **Attach/Equip** (~5) | "When you attach an Equipment to me" | |
| **Empower** (~6) | "When I become Empowered", "when you empower something else" | |
| **Phase-based ("At the start/end of...")** | "At the start of your Beginning Phase, before scoring" | This exact phrase (13 hits) is the `[Temporary]` keyword's functional text (R816) — a delayed self-destruct. Other phase anchors seen: Main Phase, Channel Phase, end of turn. |

Card examples:
- **Deathknell** — Black Rose Dignitary: `[Deathknell] Channel 1 rune exhausted.`
- **Vision** — a permanent-entry trigger that's literally "When this is
  played, predict" (R817) — a keyword wrapping a play-trigger + a named
  sub-action (Predict).
- **Multi-trigger stacking** — Baccai Witherclaw:
  `[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted.` — a
  triggered ability (Deathknell) nested inside a conditional/dependent
  keyword (Empowered). See §5 and the hard-cases list.

---

## 2. Continuous / static modifiers

**Rules grounding:** R363–366 (Passive Abilities), **R473–479 (Layers)**.

This is the part of the survey I'd flag as most architecturally important.
Riftbound has an explicit, official **3-layer system** for continuous
effects, re-evaluated to fixpoint:

1. **Layer 1 — Trait-Altering Effects** (R477.1): name, type, tags,
   controller, cost, domain, and **Might assignment** ("becomes 4").
   Also where Copy effects apply.
2. **Layer 2 — Ability-Altering Effects** (R477.2): granting/removing
   keywords, passive abilities, appended/removed rules text (e.g. from
   Attached cards).
3. **Layer 3 — Arithmetic** (R477.3): +/- adjustments to Might, Energy
   cost, Power cost. Increases apply before decreases (R477.3.e), and
   there's a **"snapshotting"** rule: a non-passive-ability arithmetic
   effect with a limiter (e.g. "-4 Might, to a minimum of 1") calculates
   and locks in its value once, at the moment it's applied — whereas an
   *always-on* passive ability (e.g. "units here have Might increased to
   5") recalculates continuously and never snapshots (R477.3.b, worked
   example at R477.3.c).

**Dependency resolution** (R478–479): if two same-layer effects each
would change based on the other's presence, the engine must determine if
one "depends on" the other (i.e., its output differs depending on
application order) and, if so, apply the depended-upon effect first. If
*both* effects are order-dependent on each other, no dependency can be
established and order is arbitrary (R479.1) — this is a real edge case
a general "compute a stable dependency order" algorithm has to handle
(the rules effectively concede it's sometimes unresolvable and don't
break the tie).

This whole system re-runs to a fixpoint (R476.2) any time a change is
processed — e.g. a Might buff can push a unit's Might past a threshold
that grants it keywords via a *different* passive ability, layer order
means Layer 2 gets re-checked after Layer 3 changes Might, which is
exactly the worked example at R478.1 (Fiora, Victorious).

### Card examples

- **Self-referential threshold**: Fiora, Victorious — `While I'm Mighty
  (Might 5+), I have Deflect, Ganking, and Shield.` A buff pushes her Might
  from 4→5, which *then* grants 3 keywords in the next layer pass.
- **Location/aura-style**: Black Flame Altar (battlefield) — `Units here
  with [Temporary] have [Shield].` — grants a keyword to units matching a
  characteristic, scoped to a location, not to "friendly" units.
- **Conditional passive, non-Might**: Esteemed Hierophant — `While you
  control 7+ runes, prevent all damage that enemy spells/abilities would
  deal to me.` (this example straddles static + replacement — see §3).
- **Empowered as a static-effect gate**: dozens of cards use
  `[Empowered][>] I have ...` — Empowered is a boolean status; the bracket
  syntax is functionally "while I have the Empowered status, I gain the
  following text" (R828), i.e. a conditional passive ability, not a
  standalone keyword grant.

---

## 3. Replacement effects

**Rules grounding:** R367–375.

Identified by "as," "would," or "instead" (R369.1). A replacement effect
intercepts an event *before* it happens and substitutes a different
event/instruction — it never "undoes" something that already occurred.
Rules of note for implementation:

- **One-shot application per event** (R370.2): a replacement effect, once
  applied to an event (or to whatever replaced that event), cannot apply
  again — even to a chain of cascading replacements. The worked example
  (two Zhonya's Hourglasses) shows this is intentionally designed to
  prevent infinite replacement loops, and it does so via a rule, not
  through an engine-level cycle-guard — the engine needs an explicit
  "already-replaced" marker per event application, not just per source.
- **Ordering when multiple replacements qualify** (R372–373): the
  *controller of the affected object* (or, for uncontrolled battlefields,
  the turn player) chooses the order. This is a player-facing decision
  point, not engine-arbitrary.
- **Zone-timing requirement** (R370.3): a replacement effect is only live
  if its source is in a zone where the effect applies *before* the event
  it would replace occurs — simultaneous entry doesn't count if the
  event and the entry are the same game action's outputs but the
  replacement-granting object enters as a *result* of that same action
  (worked example: a unit and a token dying simultaneously — the
  replacement-granting card doesn't get to intercept its own entry-causing
  event).
- **Inherited modifications** (R375): if a replaced event carries
  modifications from the effect that generated it (e.g. "play a token
  exhausted"), and a *different* replacement effect substitutes what gets
  played, the new output inherits compatible modifications ("exhausted")
  but not incompatible ones (can't inherit "gear" modifications onto a
  drawn card).

### Card examples

- **Classic save-effect ("Zhonya's Hourglass" pattern)**: `The next time
  a friendly unit would die, kill this instead. Heal that unit, exhaust
  it, and recall it.` — replacing "unit dies" with "different object dies
  + heal/exhaust/recall the original." This is the rules' own canonical
  example (R369.1) and recurs across many cards (Altar of Blood, Soraka,
  Guardian Angel–style gear).
- **Damage prevention**: Counter Strike — `The next time that unit would
  be dealt damage this turn, prevent it.` Esteemed Hierophant — an
  always-on conditional version, `prevent all damage enemy spells/
  abilities would deal to me`.
- **Redirect-on-reveal**: Undertitan — `As I'm revealed from your deck,
  [Add] 2.` — the replacement adds a side effect *to* an event rather than
  swapping it out entirely (R370.1.b.1).
- **Zone-redirect**: Endless Riches — `If a card would go to your trash
  from anywhere other than your Main Deck, banish it instead.`
- **Counter-a-spell text ("Return to hand instead of trash")**: Abandon —
  countering is itself a replacement-flavored effect: normally a
  countered spell finishes into the trash; Abandon replaces that
  destination.

---

## 4. Effects that modify resolution/timing of other effects (the Chain)

**Rules grounding:** R327–347 (Chains & Showdowns), especially the
**HOT FEPR** process (R334: Handle Outstanding Tasks, then Finalize,
Execute, Pass, Resolve — a fairly standard LIFO stack, structurally close
to MTG's stack, but with an explicit named state machine).

Key structural facts for the engine:

- The Chain is a **single, global, LIFO** non-board zone (R330.1: "only
  one Chain can exist at a time"). Items are Pending until they clear
  "Check Legality," then Finalized; the *newest* Finalized item resolves
  first (R340.1).
- **Reaction vs. Action are timing-permission keywords, not effects**
  (R806, R813) — they widen *when* a card/ability can be added to the
  chain (Closed States, Showdowns, opponent's turn) but "do not alter the
  function of any instruction" (R806.3). This is a clean separation: a
  timing/legality gate, orthogonal to the effect payload.
- **Conditional permission-granting** (R806.4/813.4): some passive
  abilities grant Action/Reaction only under conditions that might only
  become true *while the item is already on the chain* — if by "Check
  Legality" the condition isn't met, the whole play is undone and the
  card returns to its origin zone. This means legality can be
  provisionally assumed and rolled back — not just checked once upfront.
- **Repeat** (R820) is the clearest "modifies resolution of its own
  effect" keyword: paying it causes the chain item's instructions to
  execute a second time *on resolution*, with fresh choices allowed the
  second time (R820.2.a) — this is a resolution-time loop, not a second
  chain item.

### Cards that directly manipulate the Chain / other chain items

- **Countering**: Abandon, Crumbling Sands, Defy, Flurry of Feathers, Hard
  Bargain, Lilting Lullaby, Wind Wall — `Counter a spell` (removes a
  chain item from the chain, typically redirecting its destination).
- **Ownership hijack mid-chain**: Mystic Reversal — `Gain control of a
  spell. You may make new choices for it.` Rebuttal — same, conditionally,
  else counters. This requires the chain-item's "controller" to be
  mutable independently of card ownership, *and* for a not-yet-resolved
  item to re-enter a choice-making step it already passed.
- **Cost-conditional counter**: Hard Bargain — `Counter a spell unless its
  controller pays 2.` — the counter's success depends on a decision made
  by the *other* player, during the resolution of this spell.

This category is a small, clean set in Riftbound compared to games like
MTG with heavy stack manipulation — most of the complexity is countering
and the (rare) control-hijack pattern, not generic chain reordering.

---

## 5. Costs, keywords, and recurring templating patterns

**Rules grounding:** R203–204 (Cost types), R800–829 (Keyword Glossary,
25 keywords), R400s (Game Actions — the un-badged verbs used inside
keyword/ability text).

### Two tiers of shorthand vocabulary

Riftbound's templating has two distinct tiers that a card-text parser
needs to tell apart:

1. **Keywords (R800–829)** — 25 named, badge-highlighted terms, each
   defined as shorthand for specific rules text (R801.1). Frequency
   across the card pool (bracket-token count):

   | Keyword | Count | Keyword | Count |
   |---|---|---|---|
   | Reaction | 130 | Repeat | 24 |
   | Action | 98 | Ambush | 23 |
   | Deflect | 72 | Weaponmaster | 20 |
   | Empowered | 68 | Flow | 18 |
   | Hidden | 61 | Hunt | 15 |
   | Assault | 57 | Legion | 15 |
   | Equip | 55 | Vision | 15 |
   | Ganking | 52 | Quick-Draw | 6 |
   | Empower | 51 | Backline | 6 |
   | Accelerate | 41 | Unique | 3 |
   | Temporary | 35 | | |
   | Shield | 35 | | |
   | Tank | 31 | | |
   | Level | 29 | | |
   | Deathknell | 27 | | |

2. **Game Actions / status terms (R400s)** — also appear in brackets on
   card text (`[Stun]`, `[Predict]`, `[Burn 3]`, `[Add]`, `[Buff]`,
   `Mighty`) but are *not* in the Keyword Glossary — they're primitive
   verbs/states the rules define once and every keyword/ability text
   reuses. E.g. `[Burn 3]` = "put the top 3 cards of your deck in your
   trash" (R440), `Mighty` = a computed descriptor ("Might ≥ 5", R706-707),
   `[Predict]` = "look at the top card, may recycle it" (R436).
   This split matters for engine design: Keywords are best modeled as
   *macros that expand to a fixed ability shape* (trigger/passive/
   activated + specific text), while Game Actions are the actual
   **primitive instruction set** the effect interpreter needs to execute.
   Building the Game Action primitives first, then keywords as
   compositions of them, mirrors how the rules themselves are laid out.

### Keyword sub-patterns worth calling out specifically

- **Value-parameterized keywords**: `Assault X`, `Shield X`, `Deflect X`,
  `Hunt X` — X defaults to 1 if omitted (R807.1.b.3 etc.), and **multiple
  grants of the same keyword sum their values** rather than overwriting
  (R807.2, R809.2, R823.2) — this is a specific, consistent stacking rule
  across the whole value-keyword family, good to implement once and reuse.
- **"Dependent Keywords"**: `Legion`, `Level N`, `Empowered` — formatted
  as `[Keyword][>] [Text]`, meaning "while `<condition>`, this card also
  has `<Text>`" (R812, R824, R828). These are conditional-passive-ability
  wrappers, and they **nest**: Baccai Witherclaw's
  `[Empowered][>][>>][Deathknell][>] ...` is a Deathknell triggered
  ability that only exists while Empowered is active — a dependent
  keyword gating a triggered-ability keyword. The `[>>]` marker appears to
  denote this second level of nesting explicitly in card templating.
- **Redundancy rules differ by keyword** — this is easy to get wrong if
  hardcoded per-card rather than per-keyword-type: Accelerate, Ganking,
  Hidden, Tank, Backline, Ambush, Quick-Draw, Unique are *redundant*
  (multiple copies = no extra effect); Assault/Shield/Deflect/Hunt *sum*;
  Weaponmaster and Deathknell *trigger separately* per instance.
- **Additional costs**: `as an additional cost` appears 69 times, split
  into Mandatory (R356.2.a.1, no "may") and Optional (R356.2.b.1, with
  "may") additional costs — both paid during a distinct "make choices"
  step of playing a card, before legality is checked.
- **Cost-reduction stacking with Level**: Master Yi, Unstoppable —
  `[Level 3] I cost 2C less. [Level 6] I cost 4CC less instead. [Level 11]
  I cost 6CCC less instead.` — note "instead," not additive: higher
  Level tiers *replace* lower ones rather than stacking, which is a
  templating convention (not a general rule) worth encoding per-card
  or recognizing as a pattern during data ingestion.
- **Alternate-zone play**: `Flow [cost]` (play from trash, then banish,
  R829) and the Legion self-mill pattern (`play me from your trash for
  [cost]`) both effectively add a second "legal source zone + cost" pair
  to a card, layered on top of the normal hand-play path.
- **Rune-based activation costs**: 695 occurrences of the exhaust-symbol
  cost pattern (`:rb_exhaust:`) — tapping/exhausting as a cost is by far
  the most common activation-cost primitive, mostly on gear and
  battlefields.

---

## 6. The 5 hardest-to-model cards found

Both independent full-pool passes (rules-cited worked examples; structural
red-flag regex over all 1180 cards) landed on the same two dominant hard
*categories* — **copy effects** and **control-change effects** — before I
picked individual cards. I've noted which method(s) confirm each entry.

1. **Shady Spectacles** (gear) — `As this is attached to a unit, choose
   another friendly unit. The equipped unit becomes a copy of that unit.`
   *(found by: structural scan — "copy effect")*. This is a live trigger
   for the Layer-1 Copy mechanism (R477.1.b), but the copy is driven by an
   attachment relationship rather than a one-shot spell — if the
   Equipment is re-attached, or the chosen "friendly unit" it's copying
   changes state, the copy has to be re-derived, not computed once. The
   rules' own Copy worked example (R477.1.b.1) uses a similar chain —
   LeBlanc's `Deceiver` legend ability makes a "Reflection" token copy a
   unit, and *that* token can itself be re-copied by Mirror Image — so
   copies-of-copies with token identity need to resolve to the right
   "current" copyable-trait set at each layer pass, not the original.

2. **Svellsongur** (gear) — `As this is attached to a unit, copy that
   unit's text to this Equipment's effect text for as long as this is
   attached to it.` *(found by: structural scan — "copy effect"; also the
   length-sort from the first pass — this one held up)*. Unlike Shady
   Spectacles, this does **not** fit R477.1.b's definition of a Copy
   effect ("one Game Object becomes a copy of another") — Svellsongur
   doesn't become the equipped unit, it mirrors that unit's rules text
   onto *itself*, permanently, while attached. I couldn't find a rule
   that names this exact pattern. That's worth flagging as a genuine open
   question for engine design, not just a hard case: is this a variant of
   the Copy layer, or a distinct "live text-linking" primitive the rules
   don't fully spell out? Either way it needs the same "recomputed every
   layer pass, not baked in once" treatment as #1, plus dynamically
   registering/unregistering whatever triggered or passive abilities are
   embedded in the mirrored text.

3. **Mystic Reversal / Rebuttal** (spells) — `Gain control of a spell.
   You may make new choices for it.` *(found by: structural scan —
   "control-change"; also rules-adjacent — R809's Deflect example
   explicitly discusses a spell's "controller" as something that can
   change mid-resolution)*. A chain item that's already been through
   target/choice selection needs its **controller reassigned mid-chain**
   and then re-enter a "make new choices" step it already passed. This
   breaks a simple "chain item is an immutable record once finalized"
   model — the engine needs finalized chain items to stay partially
   mutable (controller, chosen targets), which has knock-on effects
   anywhere else that reads "controller of a spell on the chain" (e.g.
   Deflect's cost surcharge, R809, cares who's doing the targeting).
   Conscription and Possession are simpler variants of the same
   control-change cluster (target-pool-only or permanent-only), worth
   building the general mechanism against all three rather than just
   this one.

4. **Soraka, Wanderer** (unit) — `If another unit you control here would
   die, if it has less Might than me, instead heal it, exhaust it, and
   recall it.` *(found by: rules-cited — this is the Core Rules' own
   canonical hard case, R373.2)*. The rules use Soraka by name to walk
   through what happens when she dies **simultaneously** with several
   units her own replacement effect could have saved, while she's *also*
   the target of an attached "save me instead" effect (their example uses
   a Guardian-Angel-style gear). Depending on the order the controller
   chooses to apply the two replacement effects, different units end up
   saved — and each replacement effect can only be "spent" once per
   simultaneous batch of events (R370.2, R373.2). This is the strongest
   real-world stress test for the replacement-effect-ordering rules in
   §3: it needs simultaneous-event batching, per-controller ordering
   choice, and one-application-per-source bookkeeping, all interacting
   at once — the rules needed a full paragraph and a multi-branch worked
   example to pin it down, which is a good signal it's genuinely hard.

5. **Atakhan** (unit) — `You may kill a friendly unit as an additional
   cost to play me. If you do, I cost 1 less for each Energy it costs and
   1 less for each Power it costs.` *(found by: length-sort in the first
   pass, but it survives independent scrutiny)*. Atakhan's own cost
   depends on the cost of a *different card* that will no longer exist
   (having just been killed) by the time Atakhan's own cost is finalized.
   This forces a specific **snapshot ordering**: read the killed unit's
   cost, kill it, then apply the discount — all within the "pay
   additional costs" step, before "determine final cost" normally
   happens. It's a cost calculation that depends on a costed side-effect
   of paying an earlier part of the same cost.

**Also flagged, not in the top 5 but worth designing against early:**
Renekton, Brute (`When my Might becomes 10 or more, empower me` — a state
trigger on a continuously-recomputed value, not an event trigger);
Zilean, Time Mage (the rules' own example at R371.2.b for "may"
replacement effects that duplicate a to-be-played object); Baron Nashor
(a replacement effect that conditionally creates a new board object as
part of resolving where its own source enters); Baccai Witherclaw
(three-deep keyword nesting: Empowered gating Deathknell gating a
triggered ability). None of these were dropped for being easy — they lost
out to the top 5 only because each duplicates a lesson the top 5 already
covers (state-triggers, delayed replacements, control-hijack, deep
nesting) rather than teaching something new.

**One data-quality note surfaced by this exercise:** the Core Rules'
worked example for Zhonya's Hourglass quotes it as `heal that unit,
exhaust it, and recall it` — the current live card text (in
`riftbound-cards-full.json`) reads `Recall that unit exhausted` instead.
The rules document and the current card database don't always agree,
because rules examples don't get retroactively updated when a card is
errata'd. Any ingestion pipeline that trusts rules-PDF card excerpts as
ground truth for current card behavior will drift from the real game
state — the card JSON should be the source of truth for card text, the
rules PDF only for the mechanics vocabulary.

Honorable mention (not a card): the **Layers dependency algorithm itself**
(R478–479) — the worked examples (Fiora, Victorious; the "no dependency
can be established" case at R479.1) describe a general fixpoint +
dependency-ordering problem that's genuinely nontrivial to implement
correctly and will need its own dedicated design discussion, independent
of any single card.

---

## What I'd want to design next

This survey deliberately stops short of any effect-system design. The
things I think most shape that design, in rough priority order:
1. The Layers system (§2) — it's the backbone for continuous effects and
   several "hard" cards depend on getting it right.
2. The Keyword-as-macro / Game-Action-as-primitive split (§5) — decides
   how much of the 25-keyword glossary is data-driven vs. hardcoded.
   Trigger-vs-Effect within Triggered Abilities (§1), and how "you may"
   placement changes when optionality resolves.
3. How much of the Chain (§4) needs to be a generic event-sourced /
   replayable structure vs. a simpler stack, given how small the
   control-hijack card set (§4, §6 — Mystic Reversal/Rebuttal/
   Conscription/Possession) actually is.
4. Whether Copy effects (§6, #1–2) are one mechanism or two — Shady
   Spectacles fits the rules' own Copy layer; Svellsongur arguably
   doesn't. Worth resolving before either gets built.

---

## Known engine deviations (running list)

Recorded as they're found, so they don't get lost between slices.

- **Death-trigger attributes (R323.4) — closed.** Location *and* Might are
  now noted before the kill and carried to the trigger, so Kog'Maw's "here"
  and Unsung Hero's "if I was [Mighty]" both resolve against what was true
  on the board. Granted *keywords* are still not noted; no card reads them
  at death yet.
- **Trigger queued after the trash move (R808.1.d.2).** The rule adds the
  trigger to the chain *before* the card moves to the trash; the engine
  kills first and derives the trigger from the resulting event. Nothing
  happens in between — no player gets priority mid-cleanup (R320.1/R321) —
  so it is unobservable, and keeping `collectTriggers` the single place
  that reads the event stream is worth more than matching the step order.
  It becomes observable once replacement effects exist, because
  R808.1.d.1 removes an already-queued trigger when a death is replaced
  (Draven + Zhonya's Hourglass).
- **Simultaneous-death conditions.** Lonely / Loyal Poro ask whether they
  "died alone", which R323.4 evaluates at 3a — before *any* unit dies, so
  two friendly units dying together did not die alone. The engine's
  kill-then-read order would answer the opposite. Also needs conditional
  effects, which the `Effect` vocabulary doesn't have.
- **Death cause not tagged.** Draven, Audacious triggers on dying *in
  combat*; `unitKilled` doesn't record what killed the unit.
- **Owner vs controller (R56).** A killed card goes to its *owner's*
  trash. The engine uses controller, which only differs once
  control-stealing effects exist.
- **General dependency detection (R478.1.a/b).** Ordering within the
  arithmetic layer follows R479's example — fixed amounts before
  `increaseMightTo`, which is the case the rules work through. Effects that
  alter *whether another effect exists* or *how many objects it reaches*
  are not detected; nothing in the vocabulary can do that yet.
- **Copy and Might — resolved against a ruling, not the text.**
  R477.1.b.1.a's written list of copyable traits omits Might, which read
  literally would leave a Reflection at its printed 0. That is wrong.
  RiftJudge's ruling on LeBlanc's Reflection is explicit: *"the Reflection
  copies only the unit's copyable traits (printed Might and Rules Text)"* —
  and equally explicit that gear, buffs and Might bonuses do **not** come
  across, because a copy "enters as a clean copy". The engine copies
  printed-or-copied Might and leaves modifiers behind. Worth remembering as
  a case where the Core Rules text alone gave the wrong answer.
- **Playing a token (R185.2.a).** Tokens can be played, and the engine only
  ever creates them. That is why a Reflection correctly misses the copied
  card's play effects — a created token emits `tokenCreated`, not
  `unitPlayed`, and R383.4.a defines a Play Effect as triggering on *that
  permanent being played to the board*. Once tokens can genuinely be
  played, the Reflection's "I don't get that card's play effects" becomes
  something to enforce rather than something that falls out.
- ~~**Tags.**~~ Built. R133.8's tags are a string list on the card, copyable
  through the layer pipeline (R477.1.b.1.a), narrowing both target filters
  and passive scopes. R187's token tags are transcribed. R133.7's supertypes
  came with them, so R103.2.a.2 is enforced in full — both the champion tag
  and the Champion supertype — along with all of R103.2.d's Signature
  limits. Two of R187's keywords were transcribed as unmodelled at the same
  time and are modelled now: the Sprite's [Temporary] (R187.2) and the
  Bird's [Deflect] (R187.7).
- **Temporary runs off the chain (R816.1).** The rules make Temporary a
  *triggered* ability, which would put it on the chain and let a [Reaction]
  answer it. The engine kills directly in the Beginning Step instead,
  because R816.1.b's "before scoring" ordering is what decides whether a
  Temporary unit Holds a battlefield for a point — and getting that wrong
  changes who wins, while losing the response window rarely matters.
  Doing both needs the turn's phases on the task queue so the chain can
  resolve mid-phase.
- **The Gold token's ability (R187.5).** Printed as "[Reaction][>] Kill
  this, [E]: [Add] [A]". The engine has no kill-self ability cost, so it is
  modelled as a recycle. Both remove it from the board and yield one Power,
  but a card that cares about *killing* would see the difference.
- **Control from a passive.** `controllerOf` reads stored trait-layer
  effects only, never passives. It has to: the layer pipeline asks who
  controls a source in order to decide whether its anthem is friendly, so
  a passive granting control would recur into itself. Every
  control-changing card in the pool works through a resolved effect, so
  nothing needs it yet.
- **Other delayed timings.** Only `endOfTurn` (R317.1.a) exists. The pool
  also has "the next time…" (7 cards) and "the first time… each turn"
  (9 cards), which are delayed *replacement* effects and one-shot
  conditional triggers respectively — different mechanisms again.
- **Excess damage placement (R465.2.c.4).** Once every unit has lethal
  assigned, leftover damage piles onto the last unit assigned rather than
  being offered as a choice. Unobservable until something triggers on
  damage amounts.
- **Hidden targeting restrictions (R811.1.d.2).** A card played from
  facedown must choose its targets "from among options at that
  battlefield, unless the ability explicitly restricts targeting in a way
  that makes this impossible." The engine enforces R811.1.d.1's
  destination but not the targeting narrowing, so a hidden Blastcone Fae
  could currently reach a unit somewhere else. Needs `TargetFilter` to
  take a location, and R811.1.d.2.a says each target is judged separately.
- **Facedown occupancy is fixed at one (R107.3.b.1).** The maximum "can
  increase or decrease", and R107.3.b.2 says a decrease trashes the
  excess. No card in the pool changes it, so the zone holds exactly one.
- **Gear cannot be hidden.** R811.1.a puts [Hidden] on spells, units and
  gear, and R811.1.d.1.a specifically overrides gear's base-only
  restriction. There is no play path for gear at all yet, so this waits
  on that rather than on [Hidden].
- **`[C]` on a multi-domain card (R135.2.e.6.c).** "Any power of that card's
  Domains" needs a cost component meaning "one of these", which `spend`
  cannot express. A single-domain card resolves it exactly; a multi-domain
  one falls back to `[A]`, which is strictly more permissive. Only reachable
  through [Accelerate] so far.
- **"An open battlefield" is undefined by the rules.** Sneaky Deckhand says
  it and nothing in the Core Rules defines "open". Read here as
  *uncontrolled*, which is the reading that makes the card do anything —
  a battlefield its controller holds is already valid under R355.2.a.
- ~~**Resolution-time choices arrive through the task queue.**~~ Closed.
  `execute` now returns what is *left* of a paused effect, and `seq` carries
  its remaining steps into it, so a step after a choice waits for the answer.
- **"Plays it to any battlefield" is chosen at finalization (R355.2).**
  Thrill of the Hunt's destination is taken as a second target rather than
  as a choice made during the sub-play. Observationally the same unless the
  board changes between the two moments.
- **Attached cards follow their host in the cleanup, not instantly.**
  R718.5.c says an Attached card "cannot be moved separately from the
  Top-Most Card"; the engine re-seats it during the next cleanup rather
  than deriving its location. Only visible to something reading a gear's
  location mid-resolution.
- **R323.7's gear recall is not modelled.** "Recall all Unattached non-Unit
  Gear and non-Unit Runes at Battlefields" — gear can only reach a
  battlefield by being attached, so nothing exercises it yet.
- **Positional target filters are independent (R355.5).** Switcheroo's "two
  units **at the same battlefield**" and any other card whose second choice
  is constrained by the first cannot be expressed: each filter is evaluated
  against the board, not against what was already chosen. Only the
  no-reusing-an-object rule links them.

---

## Replacement effects (R369–375) — deliberately staged

The largest unbuilt mechanism, and the one neither target deck forced. It
is split here because the three parts are very different sizes, and the
last one is explicitly **deferred, not dropped**.

R369.1 identifies them by "as", "would", or "instead". The distinction
from a triggered ability is that a replacement intercedes *before* the
event, so the original never happened — R370.1.a.1: a death replaced "is
the same as the kill action that caused that death not occurring", which
means no Deathknell fires.

**Two are already in the engine, hardcoded.** R369.2 names both: "Burning
Out is a replacement effect. Preventing Damage is a replacement effect."
Burn Out lives inside `drawCards` (`src/draw.ts`); [Accelerate]'s "I enter
ready" is a boolean inside `playUnitFromHand`. Neither is *wrong* — R431 is
a rule, not a card, so it belongs in engine code — but neither passes
through a chokepoint, so a card that replaced a draw or a damage could
never see them or order against them (R372).

| Tier | Covers | Cards in pool | Retires |
|---|---|---|---|
| ~~**A**~~ | R369.3 — how a unit enters: "I enter ready" and its conditional forms | 66 | Done — [Accelerate]'s hardcode is gone |
| **B** | The general mechanism: deaths, damage, draws, token creation | ~12 | Burn Out's and prevention's |
| **C** | R373.2 — sequences across simultaneous events | 0 today | — |

One shape inside Tier A is still left out: **"I enter there"** (Baron
Nashor, 3 cards) needs battlefield tokens. **"As you play me, <choose a
tag>"** was waiting on the tag system, which now exists — it needs an
entry replacement that takes a choice, not a new vocabulary. The
additional-cost half of the "as you play me" family is already built
separately (R356.2).

**Tier B is the structural one.** Events are currently *reports* — a
`GameEvent[]` recording what happened. A replacement needs them to be
*proposals*, intercepted before they apply. Two rules make it more than
plumbing: R372 gives the controller of the object being acted on a choice
of ordering, which is a player decision mid-resolution, and R370.2 limits
each replacement to one application per event, which needs bookkeeping.

**Tier C is deferred by decision.** R373.2's worked example — Soraka,
Wanderer plus a Guardian Angel with four Recruits dying simultaneously,
where the order the replacements are applied in changes who survives — is
genuinely intricate: each replacement may be applied in only one
uninterrupted sequence, to any number of qualifying simultaneous events.
No card in either target deck reaches it. It is on the list, and it gets
built when a card asks for it.
- **Chained replacements (R370.2, R373.2).** A replacement applying to what
  another replacement produced — the rules' worked example is two copies of
  Zhonya's Hourglass, where the first kills itself and that death is a new
  event the second can apply to. The engine applies exactly one replacement
  per event and stops. R372's *ordering* choice is built; R373.2's
  *sequences* are Tier C and stay deferred.
- **Combat deaths ask about ordering before the Combat Cleanup.** R372's
  question is raised by the `combatResolution` task before
  `resolveCombatAftermath` runs, rather than at the moment inside it where
  the kill happens. Same answer, asked slightly early; only observable if
  something changed the board between the two points, which nothing can,
  since the task holds priority throughout.
- ~~**R372's ordering is not asked for damage.**~~ Closed by the resumable
  `execute`. Effect damage pauses and asks; combat damage is asked by the
  `combatDamage` task before anything lands. One narrowing remains: the
  choice is offered per *source card*, so two damage replacements from the
  same source apply in creation order relative to each other. No printed
  card does that.
- ~~**A passive cannot reach a card off the board.**~~ Closed, in two halves
  and by the same trick: the board is swept when the question is *asked*, so
  R711 is never contradicted — the card is not modified at all. `costAura`
  answers R356.3's increases and Marai Spire's reductions; `keywordAura`
  answers Syndra, Transcendent's "your spells have [Repeat] [2][Chaos]".
  ROADMAP §3b's cost modification was the original statement of this gap.
- **A keyword aura only grants the cost-valued keywords.** [Repeat], [Flow]
  and [Empower] are what the printed cards grant to a card in a hand. A plain
  keyword granted the same way has no card asking for it, so `keywordAura`
  does not carry one.
- **"Your *next* spell this turn" has nowhere to live.** Temporal Portal and
  The Academy both grant [Repeat] to a spell that has not been chosen yet.
  `pendingDiscounts` is exactly this shape for cost reductions (Astral Heron)
  and a `pendingGrants` beside it would serve all three.
- **Nothing reduces a Repeat or Flow cost specifically.** `costAura` reduces
  what a *card* costs; Marai Spire ("friendly [Repeat] costs cost [1] less")
  and Stargazer ("spells with [Flow] you play from your trash cost [2] less")
  name a *keyword's* cost, which is a different subject.
- **Noxus Saboteur's restriction has nothing to restrict.** "Your opponents'
  [Hidden] cards can't be revealed here" forbids an action the engine never
  performs: nothing reveals a facedown card. Scuttle Crab's "you can look at
  their facedown cards this turn" is the card that would make it matter, and
  that is a `viewOf` grant rather than R424's Reveal. The verb was written and
  then deleted rather than shipped with no chokepoint; it is one line in
  `restrictions.ts` once the action exists.
- **Perched Grimwyrm and Ol' Poro are not restrictions.** "Play me only to a
  battlefield you conquered this turn" is an *exclusive* permission — it
  replaces R355.2.a's default rather than narrowing it, which `PlayPermission`
  cannot say — and "I can't be played on your first, second, or third turns"
  is a timing gate on a card in hand. Both were counted with the "can't"
  family and neither belongs to it; they wait for a permission that can
  exclude and a play-timing condition respectively.
- **A seat view still computes the *acting* player's moves.** `viewOf` and
  `eventsFor` close R107 on both the state and the log, so a p2 client is not
  sent p1's hand. It is still offered p1's moves, over the stand-ins — "play
  to base" against a card called *hidden card*. Harmless while the UI is one
  screen with a seat selector; it is the thing the two-windows front-end has
  to fix, by asking `legalActions` for the *seat* rather than for whoever
  holds the turn.
- **`eventsFor` over-redacts one case.** Sabotage recycles a card chosen out
  of the opponent's *revealed* hand — the chooser saw it, and still gets the
  event redacted, because the redaction reads the event alone rather than
  R424's Revealed state at the time it was logged. Erring towards withholding
  is the right failure mode for a privacy filter, and un-erring it means
  giving `eventsFor` the state each event was emitted against.
- **R372's ordering is not asked for a kill paid as a cost.** A cost that
  kills something you choose ("kill a friendly unit as an additional cost") is
  a real kill, so death replacements apply — but R372's "the controller of the
  object being acted on determines the order the Replacement Effects will
  apply" cannot be *asked* there. A cost is paid partway through R354, where
  there is nowhere to stop. Two replacements racing for one death therefore
  resolve in printed order. It takes one unit carrying two of them, which no
  pair of cards in the pool does yet.
- **A triggered ability cannot carry a choosing cost.** R383.3.b's costs are
  paid as the ability finalizes, which the engine does on its own rather than
  in response to an action — so there is no action to carry the choice in. No
  card in the pool prints one on a triggered ability; if one appears, the
  answer is a `PendingDecision` before finalization, not a wider action.
- **R443's Skip is not built, and the one card printing it needs three other
  things.** Endless Riches is the only card in the pool that skips anything
  ("skip your Draw Phase"), and it also wants playing cards from a trash
  generally and a replacement redirecting everything bound for the trash. The
  mechanism alone would make nothing authorable, so it waits for the card.
- **"Your Sand Soldiers" is read as the Shurima tag.** Emperor of the Sands
  says "your Sand Soldiers have [Weaponmaster]", and R187.3 gives the Sand
  Soldier token the Shurima tag — but a *card* with the Shurima tag is not a
  Sand Soldier. Scoping by name rather than tag is the honest reading for that
  one card; Forecaster's "your Mechs" genuinely is the tag (R187.4). Neither
  card is authored, so nothing depends on the choice yet.
- **A non-resource Equip cost cannot be paid by [Weaponmaster].** Three
  Equipment in the pool print compound Equip costs — "[Chaos], Recycle 2 cards",
  "[Order], Kill a friendly unit", "Spend 1 XP". None of those are ability costs
  the engine has, so `equipChosen` treats them as unpayable, which R821.1.c.5
  already covers: the card stays where it was. The resource-only Equip costs,
  which is every other Equipment, work.
- **"Each player" cannot contain a question.** `forEachPlayer` runs its inner
  effect once per player, and a step that stopped to ask would strand the
  players after it — the resumable `execute` returns one pause, not a queue of
  them. Nothing printed needs it: every "each player" effect in the pool is a
  draw, a reveal, a burn or a discard, and only the discard asks, which is
  R422.1.a's choice by the discarding player rather than a shared prompt.
- **Dependent-keyword conditions are duplicated in two places.**
  `PassiveCondition` (layers.ts) gained `xpAtLeast` for [Level] even though
  `Condition` (conditions.ts) already has `hasXP` saying the same thing.
  conditions.ts imports layers.ts, so layers.ts cannot import it back at value
  level, and the layer pipeline is where a dependent keyword has to be
  evaluated. Merging the two condition types would fix it and is worth doing
  once a third caller wants it.
- **An [Empower] cost is resources only, and nothing alters it.** R827.1.c.2
  allows non-resource Empower costs; R827.1.c.3 and R827.1.c.4 allow printed
  text that alters an Empower ability's cost or timing. None is built — the
  same two gaps [Repeat] and [Flow] have, and one fix covers all three.
- **"Choose one you haven't already chosen" is enforced per *play*, not per
  turn.** Curtain Call's is genuinely per play — its arms are distinguished
  across the executions one [Repeat] buys — and that is what `distinctModes`
  does. Aphelios, Exalted ("that hasn't been chosen this turn") and Udyr,
  Wildman ("you've not chosen this turn") mean something wider: a tally across
  separate activations, which nothing records. Neither card is authored.
- **`legalActions` stops enumerating a repeat's choices past 64 combinations.**
  R820.2.a lets every execution choose freely, so k executions over n target
  tuples is n^k answers. Past the bound each execution is offered the same
  choice as the first, which keeps the play discoverable where the full space
  is not. `applyAction` still accepts any legal combination the UI builds. Same
  reasoning, and the same limitation, as the ordering bound below.
- **`legalActions` enumerates orderings only up to four cards.** A prompt
  answered with a whole order — R372's damage ordering, R436.1.a's "put the
  rest back in any order" — has n! answers. Past four the only candidate
  offered is the order the prompt already lists. The UI is unaffected: it
  stages clicks and sends the order the player built. This bounds what the CLI
  and `legalActions`-driven tests can *discover*, not what the engine accepts.
- **Burn Out still does not route through a chokepoint.** R369.2 names it a
  replacement effect, and it remains inside `drawCards`. A draw chokepoint
  would let a card order against it (R372), but no card in the pool
  replaces a draw, so building one now would be a mechanism with nothing
  to serve.
