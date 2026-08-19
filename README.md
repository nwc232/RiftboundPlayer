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

`p2` garrisons the south battlefield with a Tank and a Backline unit, so
`move skulker bf-south` starts a real combat: summed Might on each side,
damage assigned Tank-first and Backline-last (R465.2.c.6), lethal before
moving on, survivors healed, and a repelled attacker recalled home.

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

Not built yet: triggered abilities, and the Assault/Shield Might
modifiers (they are arithmetic-layer effects, R477.3). Damage assignment
is computed rather than chosen — every constraint in R465.2.c is
enforced, so the assignment is always legal, but you are not yet offered
the choice between equally legal orderings.
