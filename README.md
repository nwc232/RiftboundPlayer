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
channel           channel the top rune onto the board
abilities         list abilities you can use right now
use <id> <n>      activate ability n of card <id>
draw              draw a card
play <id>         play a unit from hand
log               show everything that has happened
```

A sample session — channel three runes, tap two for Energy plus a gear,
then draw and play a 3-cost unit:

```
channel
channel
channel
use rune-1 0
use rune-2 0
use conduit 0
draw
play skulker
```

Not built yet: turns, battlefields, combat, scoring, triggered abilities,
and the chain. `p2` is an empty seat — there is no opponent yet.
