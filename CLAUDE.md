# Working on this engine

A rules-enforced 1v1 engine for the Riftbound TCG, plus a React front-end
over it. Solo portfolio project.

## The one hard constraint

**Never use Riot's official API.** Riot's developer terms treat gameplay
simulation as a prohibited use of an API key, so this project stays off any
Riot key entirely. Card data comes from community projects that publish it
independently — see `reference/CARD-DATA-SOURCE.md`. Do not set up or
suggest the official Riot API.

## Conventions that matter

- **Cite the rule.** Every non-obvious decision carries its rule number
  (`R465.2.c.4`) in a comment. `reference/riftbound-core-rules.md` is the
  full Core Rules; read the rule before implementing, because the rules
  routinely disagree with intuition. Several bugs here were *the intuitive
  answer*.
- **Abilities are data, never functions.** One interpreter (`execute`)
  turns them into state changes. This is what keeps `GameState`
  serializable — `tests/decks.test.ts` round-trips all 41 cards through
  JSON to keep it true. A pause carries an `Effect` and an answer in
  `context.answer` for exactly this reason.
- **Write deviations down.** Anything deliberately not built, or built
  approximately, goes at the end of `reference/mechanic-survey.md` with the
  rule it departs from and why. That list is the project's memory of its
  own compromises; an unwritten shortcut is the failure mode.
- **The engine core stays Node-free.** No Node-only imports outside
  `src/demo/`, so the same source runs in the browser unchanged.
- **`legalActions` is the only legality authority.** It enumerates
  candidates and filters them through `applyAction`, so the two can never
  disagree. Never re-derive a rule in the UI or the CLI.

## Where things are

| Path | What |
|---|---|
| `src/` | the engine — pure, immutable, `applyAction(state, action) → { ok, state, events }` |
| `src/decks/` | the two authored decks, 38 cards, with printed text beside authored abilities |
| `src/ui/` | React front-end (`npm run ui`) |
| `src/demo/` | CLI (`npm run demo`) |
| `reference/ROADMAP.md` | what is built, what is next, in order |
| `reference/mechanic-survey.md` | mechanic catalogue + the running deviations list |
| `reference/decks.md` | the two decklists and their status |

## Checks before committing

`npm run typecheck` and `npm test` both clean. If the change is
previewable, `npm run ui` and look at it.
