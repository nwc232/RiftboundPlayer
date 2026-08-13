import * as readline from "node:readline/promises";
import { applyAction } from "../actions.js";
import type { Action } from "../actions.js";
import type { GameEvent } from "../events.js";
import type { GameState } from "../state.js";
import { makeDemoState } from "./deck.js";
import { renderAvailableAbilities, renderEvent, renderState } from "./render.js";

const HELP = `
commands
  state             show the board
  abilities         list abilities you can use right now
  end               end your turn
  use <id> <n>      activate ability n of card <id>
  draw              draw a card
  play <id>         play a unit from hand
  log               show everything that has happened
  reset             start over
  help              this
  quit              leave

not built yet: battlefields, combat, scoring, triggered abilities, the chain.
p2 has an empty deck, so its turns pass through with nothing to do.
`;

let state: GameState = makeDemoState();
const log: GameEvent[] = [];

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
    case "abilities":
    case "a": {
      const lines = renderAvailableAbilities(state);
      console.log(lines.length === 0 ? "\n  nothing available\n" : `\n${lines.join("\n")}\n`);
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
        console.log("  usage: play <cardId>\n");
        return true;
      }
      run({ type: "playUnitFromHand", playerId: "p1", cardId });
      return true;
    }
    case "use": {
      const sourceId = args[0];
      const index = Number(args[1] ?? "0");
      if (sourceId === undefined || Number.isNaN(index)) {
        console.log("  usage: use <cardId> <abilityIndex>\n");
        return true;
      }
      run({ type: "activateAbility", playerId: "p1", sourceId, abilityIndex: index });
      return true;
    }
    case "log":
      console.log(
        log.length === 0
          ? "\n  nothing yet\n"
          : `\n${log.map((e, i) => `  ${i + 1}. ${renderEvent(e)}`).join("\n")}\n`,
      );
      return true;
    case "reset":
      state = makeDemoState();
      log.length = 0;
      console.log("  reset");
      console.log(renderState(state));
      return true;
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
