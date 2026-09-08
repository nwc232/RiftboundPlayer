# Riftbound Engine

[![CI](https://github.com/nwc232/RiftboundPlayer/actions/workflows/ci.yml/badge.svg)](https://github.com/nwc232/RiftboundPlayer/actions/workflows/ci.yml)

A rules-enforced engine for the Riftbound TCG (Riot Games), with a React
front-end over it — two to four players, on one screen or over a socket.

![The board mid-showdown](docs/board.png)

The engine decides what is legal; the interface only ever shows you what the
engine already agreed to. `legalActions` enumerates candidate moves and
validates each one through `applyAction` — the same code path that performs
them — so the move list and the rules cannot drift apart.

- **935 cards** in the pool, **100 authored** across five constructed decks
- **167 distinct rules** from the Core Rules cited in the source, across
  priority, the resolution chain, combat and multiplayer turn order
- **1,300+ tests**, including a soak harness that plays whole games and checks
  invariants after every action
- Four sanctioned Modes of Play: 1v1 Duel (R485), 1v1 Match (R486), FFA3
  Skirmish (R487), FFA4 War (R488)

## The one hard constraint

Card data comes from community-published projects, **never Riot's official
API** — Riot's developer terms treat gameplay simulation as a prohibited use
of an API key. See `reference/CARD-DATA-SOURCE.md` for provenance.

## How it is built

**A pure, immutable state machine.** `applyAction(state, action)` returns
`{ ok, state, events }` and nothing else — no mutation, no I/O, no clock. The
core imports nothing from Node, so the same source runs in a browser
unchanged; that is what lets the whole game work with no server at all.

**Abilities are data, not functions.** One interpreter turns them into state
changes, so `GameState` stays JSON-serializable — which is what makes network
sync, per-player views and deterministic replay possible at all. A test
round-trips every authored card through JSON to keep it true.

**Hidden information is enforced at the boundary, not in the renderer.** The
server sends each seat `viewOf(state, seat)` and `eventsFor(events, seat)`, so
a client cannot display what it was never sent. An opponent's draw arrives as
"a card".

**A game is a seed plus a list of actions.** Because the engine is
deterministic, that pair reproduces any game exactly — which turns "something
looked wrong and I could not see what happened" into a case that can be
re-run, stepped through and asserted about.

## How the bugs get found

Volume of tests is not the interesting part; four rounds of measurement said
so. What works here is stating what a board may **never** look like, and
checking it after every action of a randomised playthrough:

- *An item owing a choice with nobody being asked for it.*
- *An accepted answer that changed nothing.*
- *A card without reaction timing joining a chain that already exists.*
- *A parked effect owed an answer while the chain moves on.*

Each of those caught a real bug that every existing assertion had passed
through — including two mutual deadlocks between rules, and one dropped
decision that left a game answering the same prompt **59,808 times** while
nothing was stuck, nothing illegal was offered, and no test failed.

**The invariants are themselves tested.** Each one was validated by
reintroducing the bug it was written to catch and confirming it fails — an
oracle nobody has checked is a comfort, not a test.

The random driver is steered rather than uniform: it prefers building chains
over draining them, and prefers cards it has not exercised yet. Both biases
came from measuring where it was *not* going.

## Scripts

- `npm run ui` — React front-end; pick a mode, then a deck per seat
- `npm run server` — play other people over a socket; open the link it
  prints, pick a mode and your deck, and share the room code. The room is
  sized by whoever opens it and deals once every seat is filled
- `npm run demo` — interactive CLI to drive the engine by hand
- `npm test` — run the test suite once
- `npm run test:watch` — run tests in watch mode
- `npm run typecheck` — type-check without emitting

## Demo

`npm run demo` opens a REPL over the engine. Type `help` for commands.

### When a game looks wrong

The log panel has a **copy** button. In a local game it copies the whole log
*and* a replay — the seed, the deck lists, and every action taken, in order.
The engine is deterministic, so that is the game: `tests/replay.ts` runs it
back and hands over every board it passed through, checking every invariant on
the way. A board that looked wrong can be re-run rather than described.

Online the client never had the seed, so there it copies the log it was sent.

### Before handing it to someone else

```
npm run soak
```

520 games across every deck pairing and every seat count, forty seeds each,
with every invariant checked after every action — about three minutes. It is
outside `npm test` because that is the wrong price for every run and the right
price before a play test. The one bug it has found so far was reachable only
with three players at the table.

## Playing someone else

`npm run server` builds the front-end and serves it alongside a WebSocket on
one port. Open the link, pick your deck, and share the room code — the second
person to open `?room=<code>` takes the other seat.

The server owns the game. Each seat is sent only `viewOf(state, seat)` and
`eventsFor(events, seat)`, so the unfiltered state never leaves the process:
a client cannot show what it was not sent. A seat may only submit actions as
itself, and legality is still decided by `applyAction` — the server does not
get a second opinion about the rules.

### Playing with someone remote — the way this is actually used

A tunnel puts the local server on a public HTTPS URL, which is enough to play
people who are nowhere near you, with nothing hosted and nothing to pay for:

```
npm run server                                   # one terminal
cloudflared tunnel --url http://localhost:8787   # another
```

`cloudflared` needs no account; ngrok works too but wants a free token. Your
machine stays the host, so it has to stay awake and on for the duration, and
the URL changes each run — send the new one each time.

Whoever opens the room picks its size (2, 3 or 4) and the mode follows; the
room deals once every seat is filled, and the link to share is on the lobby
screen.

### Deploying it, if it ever needs to be always-on

Not currently used — the tunnel above is the setup in practice. Kept because
the constraints below are real for any host, not just this one.

The `Dockerfile` builds the front-end and runs the server; any host that takes
a container will do. `fly.toml` is set up for Fly.io:

```
fly launch --no-deploy   # names the app and picks a region
fly deploy
```

Two settings in there are deliberate, and matter on any host:

- **One instance.** Rooms live in memory, so a second instance is a second set
  of rooms — two players sharing a code could land on different ones and never
  see each other.
- **No idle sleep.** Stopping the machine when nothing is happening throws
  away every game in progress, including one where both players are thinking.

The same two caveats apply on Render or Railway. Render's free tier sleeps
after fifteen minutes, so a game left open over a break will be gone.

**The image has never been built.** Docker was not running on the machine
this was written on, so `Dockerfile` is verified only by having built the
production tree by hand — the files it copies, `npm ci --omit=dev`, then a
real game over a socket against it. `docker build -t rb .` before deploying is
the cheap way to find out.

Games are not persisted: restarting the server ends everything in progress.
That is fine for playing a friend and is the first thing to change if this
ever wants to be more.

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

Tokens (R179–187) are created at runtime rather than dealt from a deck.
R187 names each standard token's characteristics outright, so that table
is a transcription. Two rules make them more than "a card with no cost":
R186.1 means a killed token *ceases to exist* rather than going to a
trash, so nothing can recur it; and R185.3.a.1 treats its cost as 0 until
a copy effect appends a real one (R185.3.a.2).

Copy effects (R477.1.b) are a trait-layer modifier on the token, not a
rewrite of it, so they unwind like anything else. Mirror Image
demonstrates it:

```
end
end
end
end
end
end
end
end
use rune-1 0
use rune-2 0
use rune-3 0
use rune-7 1
use rune-8 1
cast mirror grunt
pass
pass
```

The name, cost, rules text **and printed Might** come across. R477.1.b.1.a's
written list of copyable traits omits Might, and reading it literally left
a Reflection stuck at its printed 0 — which an official ruling on
LeBlanc's Reflection contradicts outright: *"the Reflection copies only the
unit's copyable traits (printed Might and Rules Text)"*. The same ruling
draws the other edge: gear, buffs and Might bonuses do **not** transfer,
because a copy "enters as a clean copy". So a copy takes the original's
printed Might, never its buffed Might.

A copy carries its source's Rules Text, so its triggers are the copy's
triggers — including a Deathknell, which has to survive the copy itself
dying. R808.1.d.3 is why that works: the dying permanent's details are
*noted before it moves*, and a chain item carries the ability it triggered
on rather than an index to look up later. Abilities are data, so carrying
one costs nothing, and nothing can go stale underneath it.

Play effects are the exception the Reflection prints on itself, and the
engine gets it from R383.4.a rather than a special case: a Play Effect
triggers on the permanent being *played to the board*, and a created token
was never played.

R477.1.b.1.b's copy-of-a-copy works too: copying a Reflection that is
already a copy of something reads its *current* traits, not its printed
ones, and a copy cycle terminates rather than recurring forever.

Controller is a trait too (R477.1.a), so taking control is a layer effect
rather than a rewrite of the permanent — which is what lets Hostile
Takeover's "lose control of that unit at end of turn" simply *expire*
instead of needing an undo. Possession's permanent steal and that
durational one are the same effect with different lifetimes.

Because control moves but ownership does not, a stolen unit that dies
goes to its **owner's** trash (R56), not its thief's. That rule had been
a recorded deviation since combat landed; tokens forced `owner` to become
real (R183 defines a token's owner as whoever controlled the creating
effect), and control-changing is what makes the distinction observable.

Two different things get called "until end of turn", and they need
different machinery. A **duration** is a modifier that stops applying:
"+2 Might this turn" expires at R317.2.c and nothing runs. A **delayed
effect** *fires*: Hostile Takeover's "Lose control of that unit and recall
it at end of turn" needs both halves, and R317's ordering decides the
result — R317.1's Ending Step runs the recall while you still control the
unit, so it lands in *your* base, and only then does R317.2.c hand it
back.

[Temporary] (R816) is the same idea at the other end of the turn: "at the
start of this permanent's controller's Beginning Phase, before scoring,
kill this". The *before scoring* is load-bearing — a Temporary unit must
not get to Hold a battlefield for a point. Writing that test surfaced a
real bug: killing it is not enough, because R323.6 only drops control of
an unoccupied battlefield during a cleanup, and R319.6 makes one
outstanding the moment anything leaves the board. Without that cleanup the
dead unit still scored.

Mirror Image now runs end to end — copy a unit, take a Reflection token
with its name and cost, and watch it disappear at your next Beginning
Phase:

```
cast mirror grunt
pass
pass
end
end
```

[Temporary] is a *triggered* ability (R816.1), so it goes on the chain and
can be answered — and R335 is what makes that safe: the game proceeds "to
the next substep, step, phase, or turn" only once there are no outstanding
tasks *and no pending chain items*. The turn's phases are queue entries,
so the Scoring Step simply waits until the Temporary trigger has resolved.
That is the ordering R816.1.b demands, without giving up the response
window.

Not built yet: a tag system — R187 gives every token a tag and
R477.1.b.1.a makes tags copyable, but nothing reads them.

Known deviations from the rules are tracked at the end of
`reference/mechanic-survey.md`.
