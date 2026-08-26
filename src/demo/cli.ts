import * as readline from "node:readline/promises";
import { applyAction } from "../actions.js";
import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import type { GameState } from "../state.js";
import { startGame } from "../deck.js";
import { matchup } from "../decks/index.js";
import { makeDemoState } from "./deck.js";
import { renderAvailableAbilities, renderEvent, renderState } from "./render.js";

const HELP = `
commands
  state                 show the board
  moves                 every legal move right now, as typeable commands
  pass                  pass priority (chain) or focus (showdown)
  choose <id...>        answer a target choice
  yes / no              answer a "you may" choice
  end                   end your turn
  use <id> <n> [tgt]    activate ability n of card <id>
  draw                  draw a card
  play <id> [dest]      play a unit or gear; dest is base or a battlefield id
  cast <id> [tgt...]    play a spell onto the chain
  hide <id> <bf>        hide a [Hidden] card facedown at a battlefield
  move <id> <dest>      standard move
  log                   show everything that has happened
  reset                 start over
  help                  this
  quit                  leave

add "+cost" to the end of a play or cast to pay an optional additional
cost — [Accelerate], Pyke, Rampage.

two modes, switched with "reset sandbox" / "reset decks":
  decks    the two real lists — Vex, Gloomist against Rengar, Pridestalker
  sandbox  a small hand-built board with a garrison to attack

first to 8 points wins. "moves" is driven by the engine's own legalActions,
so it can never offer something the rules would then reject.
`;

/** R485 — the real matchup, or the small hand-built board. */
type Mode = "decks" | "sandbox";

function newGame(mode: Mode, seed = Date.now() % 100000): GameState {
  if (mode === "sandbox") return makeDemoState();
  // R485.2 — decks are shuffled at setup. The engine itself has no RNG, so the
  // seed lives here and is printed, which makes any game replayable.
  console.log(`  deck seed ${seed}`);
  const started = startGame(matchup({ seed }));
  if (!started.ok) {
    throw new Error(`deck setup failed: ${JSON.stringify(started.errors)}`);
  }
  return started.state;
}

let mode: Mode = "decks";
let state: GameState = newGame(mode);
const log: GameEvent[] = [];

/**
 * Who the CLI is acting as. One person drives both seats here, so it is
 * whoever the rules currently expect: the player owing a decision, the one
 * holding priority, the one with Focus, else the turn player.
 */
function actingPlayer(): "p1" | "p2" {
  if (state.pending !== null) return state.pending.player;
  if (state.chain.length > 0 && state.priority !== null) return state.priority;
  if (state.showdown !== null) return state.showdown.focus;
  return state.turn.player;
}

function run(action: Action): void {
  const result = applyAction(state, action);

  if (!result.ok) {
    console.log(`  rejected: ${result.reason}\n`);
    return;
  }

  state = result.state;
  log.push(...result.events);
  for (const event of result.events) {
    console.log(`  ${renderEvent(event)}`);
  }
  console.log(renderState(state));
}

function handle(line: string): boolean {
  const [command, ...args] = line.trim().split(/\s+/);

  switch (command) {
    case "":
      return true;
    case "help":
    case "h":
    case "?":
      console.log(HELP);
      return true;
    case "state":
    case "s":
      console.log(renderState(state));
      return true;
    case "moves":
    case "abilities":
    case "m":
    case "a": {
      const lines = renderAvailableAbilities(state, actingPlayer());
      console.log(lines.length === 0 ? "\n  nothing available\n" : `\n${lines.join("\n")}\n`);
      return true;
    }
    case "pass": {
      // While the chain is up players pass priority; otherwise it is focus.
      if (state.chain.length > 0) {
        run({ type: "passPriority", playerId: state.priority ?? state.turn.player });
        return true;
      }
      const focus = state.showdown?.focus ?? state.turn.player;
      run({ type: "passFocus", playerId: focus });
      return true;
    }
    case "choose": {
      // Zero arguments is a real answer: R117.1's mulligan of "up to two"
      // includes keeping the hand.
      run({
        type: "decide",
        playerId: state.pending?.player ?? state.turn.player,
        targets: args,
      });
      return true;
    }
    case "yes":
    case "no":
      run({
        type: "decide",
        playerId: state.pending?.player ?? state.turn.player,
        perform: command === "yes",
      });
      return true;
    case "cast": {
      const cardId = args[0];
      if (cardId === undefined) {
        console.log("  usage: cast <cardId> [targetId]\n");
        return true;
      }
      const rest = args.slice(1);
      const payOptional = rest.includes("+cost");
      const targets = rest.filter((arg) => arg !== "+cost");
      const acting = actingPlayer();
      run({
        type: "playSpell",
        playerId: acting,
        cardId,
        targets,
        payOptional,
      });
      return true;
    }
    case "end":
      run({ type: "endTurn", playerId: state.turn.player });
      return true;
    case "draw":
      run({ type: "drawCard", playerId: "p1" });
      return true;
    case "play": {
      const cardId = args[0];
      if (cardId === undefined) {
        console.log("  usage: play <cardId> [base|battlefieldId] [+cost]\n");
        return true;
      }
      const rest = args.slice(1);
      const payOptional = rest.includes("+cost");
      const where = rest.find((arg) => arg !== "+cost");
      const acting = actingPlayer();
      run({
        type: "playUnitFromHand",
        playerId: acting,
        cardId,
        destination:
          where === undefined || where === "base"
            ? { kind: "base", player: acting }
            : { kind: "battlefield", id: where },
        payOptional,
      });
      return true;
    }
    case "hide": {
      const cardId = args[0];
      const battlefieldId = args[1];
      if (cardId === undefined || battlefieldId === undefined) {
        console.log("  usage: hide <cardId> <battlefieldId>\n");
        return true;
      }
      run({
        type: "hide",
        playerId: actingPlayer(),
        cardId,
        battlefieldId,
      });
      return true;
    }
    case "move": {
      const cardId = args[0];
      const target = args[1];
      if (cardId === undefined || target === undefined) {
        console.log("  usage: move <cardId> <base|battlefieldId>\n");
        return true;
      }
      const destination =
        target === "base"
          ? ({ kind: "base", player: state.turn.player } as const)
          : ({ kind: "battlefield", id: target } as const);
      run({ type: "standardMove", playerId: state.turn.player, cardId, destination });
      return true;
    }
    case "use": {
      const sourceId = args[0];
      const index = Number(args[1] ?? "0");
      if (sourceId === undefined || Number.isNaN(index)) {
        console.log("  usage: use <cardId> <abilityIndex> [targetId...]\n");
        return true;
      }
      run({
        type: "activateAbility",
        playerId: actingPlayer(),
        sourceId,
        abilityIndex: index,
        targets: args.slice(2),
      });
      return true;
    }
    case "log":
      console.log(
        log.length === 0
          ? "\n  nothing yet\n"
          : `\n${log.map((e, i) => `  ${i + 1}. ${renderEvent(e)}`).join("\n")}\n`,
      );
      return true;
    case "reset": {
      const asked = args[0];
      if (asked === "sandbox" || asked === "decks") mode = asked;
      const seed = Number(args.find((arg) => /^\d+$/.test(arg)));
      state = newGame(mode, Number.isNaN(seed) ? undefined : seed);
      log.length = 0;
      console.log(`  reset — ${mode}`);
      console.log(renderState(state));
      return true;
    }
    case "quit":
    case "q":
    case "exit":
      return false;
    default:
      console.log(`  unknown command: ${command} (try "help")\n`);
      return true;
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

console.log("\nRiftbound engine demo — type \"help\" for commands");
console.log(renderState(state));
rl.prompt();

for await (const line of rl) {
  if (!handle(line)) break;
  rl.prompt();
}

rl.close();
