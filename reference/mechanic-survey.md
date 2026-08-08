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

1. **Svellsongur** (gear) — `As this is attached to a unit, copy that
   unit's text to this Equipment's effect text for as long as this is
   attached to it.` This isn't a one-time copy (Layer 1 handles those,
   R477.1.b) — it's a **live, continuously-updating reference**: if the
   attached unit's text later changes (via some other effect), Svellsongur's
   text must change with it, and if it's re-attached to a different unit,
   its text must re-derive from scratch. Modeling this requires the
   effect system to support a "text pointer" that's recomputed every
   layer pass rather than a value baked in once at attach-time — and its
   own copied text might itself contain further triggered/passive
   abilities that need to be registered and unregistered dynamically as
   the attachment target changes.

2. **Mystic Reversal / Rebuttal** (spells) — `Gain control of a spell.
   You may make new choices for it.` A chain item that's already been
   through target/choice selection needs to have its **controller
   reassigned mid-chain** and then be sent *backward* through a step of
   its own playing process ("make new choices") that it already passed.
   This breaks a simple "chain item is an immutable record once
   finalized" model — the engine needs finalized chain items to remain
   partially mutable (controller, chosen targets) under specific
   effects, which has knock-on implications for anything that reads
   "controller of a spell on the chain" elsewhere (e.g. Deflect's cost
   surcharge, R809, cares who's doing the targeting).

3. **Renekton, Brute** (unit) — `When my Might becomes 10 or more,
   empower me.` This isn't a normal event trigger (play/attack/die) — it's
   a **state trigger** on a continuously-recomputed Layer-3 value. The
   engine needs to watch for the *transition* of a derived quantity
   crossing a threshold (not just "check current Might on every
   unrelated event"), which means either diffing Might before/after
   every layer re-evaluation, or maintaining explicit watchers on
   computed characteristics — a different trigger-detection mechanism
   than the event-driven triggers in §1.

4. **Atakhan** (unit) — `You may kill a friendly unit as an additional
   cost to play me. If you do, I cost 1 less for each Energy it costs and
   1 less for each Power it costs.` The cost of playing Atakhan depends on
   the cost of a *different card* that will no longer exist (having just
   been killed) by the time Atakhan's own cost needs to be finalized and
   paid. This forces a specific **snapshot ordering**: read the killed
   unit's cost, kill it, *then* apply the discount to Atakhan's own cost —
   all within the "pay additional costs" step, before "determine final
   cost" normally happens. It's a cost calculation that depends on a
   costed side-effect of paying a different, earlier part of the same
   cost.

5. **Baccai Witherclaw** (unit) — `[Empowered][>][>>][Deathknell][>]
   Channel 2 runes exhausted.` Three concepts nested: a Dependent Keyword
   (Empowered, R828) gating the *presence* of a second keyword
   (Deathknell, a Triggered Ability keyword, R808), which itself only
   applies "when I die" — and the death must occur *while the dependent
   condition (Empowered) still holds*, per R828.1.d's clarification that
   dependent triggered abilities key off the state at trigger time. This
   requires the ability-registration system to support conditionally
   active triggered abilities (not just conditionally active passive/
   static text) — i.e., a trigger listener that's dynamically
   subscribed/unsubscribed based on an unrelated continuous condition,
   rather than always-registered-but-gated-on-resolution.

Honorable mention: the **Layers dependency algorithm itself** (R478–479)
isn't a card, but the worked examples (Fiora, Victorious; the "no
dependency can be established" case at R479.1) describe a general
fixpoint + dependency-ordering problem that's genuinely nontrivial to
implement correctly and will need its own dedicated design discussion,
independent of any single card.

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
   control-hijack card set (§4, §6.2) actually is.
