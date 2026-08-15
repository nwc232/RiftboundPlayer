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
```

Turns run Awaken → Beginning → Channel → Draw → Main → Ending (R314–317).
Everything except the Main Phase happens automatically.

Not built yet: showdowns, combat, scoring, triggered abilities, the chain.
Battlefields can be moved to and become contested, but control is never
established — R190.4 only establishes it at the end of a showdown or combat.
