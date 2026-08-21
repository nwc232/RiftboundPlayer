# Riftbound Engine

A rules-enforced, headless 1v1 engine for the Riftbound TCG (Riot Games).
Solo portfolio project. TypeScript on Node, test-driven.

## Scope (current phase)

Headless engine only — no UI, no networking, no deckbuilder.

## Data source

Card data is sourced from community-published projects, not Riot's
official API (whose developer terms prohibit gameplay-simulation use).
See `/reference` for provenance notes.

## Scripts

- `npm run demo` — interactive CLI to drive the engine by hand
- `npm test` — run the test suite once
- `npm run test:watch` — run tests in watch mode
- `npm run typecheck` — type-check without emitting

## Demo

`npm run demo` opens a REPL over the engine. Type `help` for commands.

```
abilities         list abilities you can use right now
use <id> <n>      activate ability n of card <id>
play <id>         play a unit from hand
move <id> <dest>  standard move; dest is "base" or a battlefield id
cast <id> [tgt]   play a spell onto the chain
pass              pass priority (chain) or focus (showdown)
choose <id>       answer a target choice
yes / no          answer a "you may" choice
end               end your turn
log               show everything that has happened
```

A sample session — tap two runes and a gear for 3 Energy, play a 3-cost
unit, pass twice so it readies, then march it onto a battlefield:

```
use rune-1 0
use rune-2 0
use conduit 0
play skulker
end
end
move skulker bf-north
pass
pass
```

Moving onto an uncontrolled battlefield contests it, which opens a
showdown in the following cleanup. Both players passing closes it, p1
establishes control, and that Conquer scores a point. Pass two more
turns and the same battlefield is Held at the start of p1's turn for
another point. First to 8 wins (R194.3).

Turns run Awaken → Beginning → Channel → Draw → Main → Ending (R314–317).
Everything except the Main Phase happens automatically.

`p2` garrisons the south battlefield with a Tank, two identical Watchmen,
and a Backline unit, so `move skulker bf-south` starts a real combat:
summed Might on each side, lethal assigned before moving on, survivors
healed, and a repelled attacker recalled home.

Damage assignment is yours to make. R465.2.c.6 forces the Tank first and
the Backline last, but the two Watchmen tie, and R465.2.c.7 makes that
order your choice — so the engine stops and asks, offering only the units
that are legal right now:

```
end
end
use rune-1 0
use rune-2 0
use conduit 0
play skulker
end
end
move skulker bf-south
pass
pass
choose watch-b
```

Skulker's 3 Might goes 2 into the Tank (forced, exactly lethal) leaving 1
to place — and whichever Watchman you name is the one that dies. The
amount is never asked for: R465.2.c.3 forces exactly lethal and c.4
forbids more while other units are unassigned, so naming the unit
determines the number. Where only one unit is legally assignable the
engine doesn't ask at all.

Combat runs on an explicit queue of Outstanding Tasks (R319/R334) rather
than as a single function call, which is what lets it suspend mid-way for
that choice. R334.1 is the reason the queue is the right shape: chain
items added while tasks are being handled "remain there until the Tasks
are complete", and R334.2 processes them all afterward.

Spells go on the chain rather than resolving immediately (R359.3), which
is what gives the opponent a window to respond:

```
use rune-1 0
use rune-2 0
draw
cast incinerate grunt
pass
pass
```

The chain is LIFO — the newest item resolves first (R340.1) — so Wind
Wall countering an Incinerate beneath it stops that Incinerate from ever
executing. Timing is enforced from printed keywords: [Reaction] to act
while the chain is up (R813), [Action] during a showdown (R806),
otherwise your own Main Phase in an Open State.

Triggered abilities are detected from the event stream and go on the
chain like anything else (R383.3), so the opponent gets a window before
they resolve. Cloud Drake ("when you play me, draw 1") demonstrates it:

```
end
end
use rune-1 0
use rune-2 0
use rune-3 0
use rune-4 0
play drake
pass
pass
```

A trigger's condition is an event plus a subject, not a bare keyword —
"when I enter" and "when another unit enters" share an event and differ
only in who they watch. Note that "as X happens" is deliberately *not*
modelled here: R369.1 makes that a replacement effect, which changes the
event rather than firing after it.

When a chain item needs a decision, the engine stops and asks. Nothing
else may proceed until it is answered (R320.1). Riptide Rex demonstrates
both halves — a target chosen at finalization (R355.5), and the legal set
filtered to enemy units at a battlefield:

```
end
end
end
end
use rune-1 0
use rune-2 0
use rune-3 0
use rune-4 0
use rune-5 0
use rune-6 0
play rex
choose grunt
pass
pass
```

Optional triggers use the same mechanism. R383.3.a makes "you may" as the
*first* clause a decision about whether to perform the ability at all,
taken at finalization — declining removes it from the chain and it counts
as never having triggered (R383.3.a.2). A "you may" later in the text is a
different thing, decided on resolution.

Continuous effects run through the layer system (R473–479). Nothing
modified is ever stored: R476 describes the layers as something you
*re-evaluate*, so `mightOf` recomputes from the live board every time it
is called, and removing a source removes its effect with no bookkeeping.

The three layers apply in R477's order — Trait-Altering, then
Ability-Altering, then Arithmetic — and R476.2 requires recurring over
them until nothing changes. That loop is what makes Fiora, Victorious
work (R476.3): a buff raises her Might in the arithmetic layer, which
makes her Mighty (R708, Might 5+), which grants Shield back in the
ability layer, whose own +1 lands in the arithmetic layer again. A single
pass would stop at 5 and miss the keyword entirely.

Assault and Shield key off the Attacker/Defender designation (R323.2),
not off "a combat is happening", so the demo shows both:

```
end
end
use rune-1 0
use rune-2 0
use conduit 0
play skulker
end
end
move skulker bf-south
pass
pass
```

Skulker attacks for 4 rather than its printed 3 ([Assault]), and the
garrison defends for 7 rather than 6 because Sentry Grunt has [Shield].
The Grunt is then assigned 3 damage, not 2 — lethal is measured against
its *current* Might, so the whole chain of layers feeds back into
R465.2.c's assignment rules.

Effects with a lifetime of their own — "+2 Might this turn" — are stored
rather than read off a permanent, and expire at the two points the rules
define: R317.2.c for "this turn", R466.7.c for "this combat".

Their amount is fixed once, when applied, and never re-derived. R432.1.a
is why: a 3-Might unit with [Shield 2] defending has current Might 5, so
Last Stand ("double a friendly unit's Might this turn") gives it **+5**.
When combat ends the Shield stops applying but the +5 does not, leaving 8
rather than 6. R477.3.b calls this snapshotting, and it is also what makes
Ahri, Inquisitive's "-2 Might this turn, to a minimum of 1" generate -1
against a 2-Might unit — and stay -1 even if that unit is later buffed.

Ordering inside the arithmetic layer follows R477.3.e (increases before
decreases) and R479's dependency: a fixed "+2" applies before an
"increased to 5", because the latter's result changes depending on
whether the former landed first.

Not built yet: copy effects (R477.1.b), which are blocked on runtime token
creation — every copy card in the pool works through a Reflection token —
and controller-changing (R477.1.a).

Known deviations from the rules are tracked at the end of
`reference/mechanic-survey.md`.
