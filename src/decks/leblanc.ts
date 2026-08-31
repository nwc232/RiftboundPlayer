import {
  createToken,
  draw,
  discardCost,
  empower,
  exhaustSelf,
  flow,
  grantKeywordFor,
  mightPerUnit,
  modifyMight,
  passive,
  predict,
  repeat,
  restrict,
  anthemKeyword,
} from "../builders.js";
import { FREE } from "../cost.js";
import type { CardInstance, Cost, Domain } from "../state.js";

/**
 * Deck 3 — **Deceiver** (Mind / Order), the LeBlanc Reflection list. Authored
 * from the printed cards, like the other two; the list and what each card
 * needed lives in `reference/decks.md`.
 *
 * Chosen deliberately for what it exercises rather than for how it plays. The
 * first two decks between them never printed [Repeat], [Flow], [Empower],
 * [Level], [Vision], [Quick-Draw], [Shield], [Tank] or [Temporary] — nine
 * keywords the engine had built and only ever run against test fixtures. This
 * deck prints seven of them, and its legend alone reaches four things the
 * engine could not previously say.
 */

const cost = (energy: number, domain?: Domain, power = 0): Cost => ({
  energy,
  power: domain !== undefined && power > 0 ? { [domain]: power } : {},
  anyPower: 0,
});

export const deceiver: CardInstance = {
  id: "deceiver",
  name: "Deceiver",
  tags: ["LeBlanc"],
  text: "When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. It becomes a copy of another unit there. Give it [Temporary].",
  type: "legend",
  cost: FREE,
  keywords: [],
  domains: ["mind", "order"],
  abilities: [
    {
      kind: "triggered",
      // No `method`, so either way of scoring fires it (R470).
      trigger: { on: "battlefieldScored", subject: "controller" },
      optional: true,
      // R383.3.b — "discard 1 and exhaust me to" is the ability's base cost.
      // R422.1.a leaves *which* card to the discarding player, so it rides in
      // the action as a chosen cost.
      costs: [discardCost(), exhaustSelf],
      // "another unit **there**" — the battlefield the score happened at.
      // R107.4.b puts the Legend Zone nowhere, so "here" would find nothing;
      // `atEventLocation` is what the trigger's own battlefield answers.
      targeting: {
        filters: [{ type: "unit", atEventLocation: true }],
      },
      // R184.1's ready override, R184.3's granted keyword, and R477.1.b's
      // copy, all on one token.
      effect: createToken("reflection", 1, {
        ready: true,
        to: "eventLocation",
        copyOfTarget: 0,
        grants: ["temporary"],
      }),
    },
  ],
};

export const leblancEverywhereAtOnce: CardInstance = {
  id: "leblanc-everywhere",
  name: "LeBlanc, Everywhere at Once",
  supertypes: ["champion"],
  tags: ["Noxus", "LeBlanc"],
  text: "[Backline] Your [Temporary] effects at my battlefield don't trigger.",
  type: "unit",
  cost: cost(4),
  might: 4,
  domains: ["mind"],
  keywords: ["backline"],
  abilities: [
    // The keyword stays — R816.2's redundancy, Petal Pixie's count and
    // "a unit *without* [Temporary]" all still see it. What stops is the
    // ability the keyword stands for, which is what "effects … don't
    // trigger" says. Includes herself: the text says "your", not "your other".
    restrict({ what: "keywordTrigger", keyword: "temporary" }, {
      target: "friendlyUnits",
      here: true,
    }),
  ],
};

export const mirrorImage: CardInstance = {
  id: "mirror-image",
  name: "Mirror Image",
  supertypes: ["signature"],
  tags: ["LeBlanc"],
  text: "Choose a unit. Play a ready Reflection unit token to your base. It becomes a copy of that unit. Give it [Temporary].",
  type: "spell",
  cost: cost(3, "order", 2),
  domains: ["mind", "order"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: createToken("reflection", 1, {
        ready: true,
        copyOfTarget: 0,
        grants: ["temporary"],
      }),
    },
  ],
};

export const keeperOfMasks: CardInstance = {
  id: "keeper-of-masks",
  name: "Keeper of Masks",
  tags: ["Ionia"],
  text: "[Hidden] [Temporary] When you play me, play two Reflection unit tokens here. They become copies of me.",
  type: "unit",
  cost: cost(2),
  might: 1,
  domains: ["mind"],
  keywords: ["hidden", "temporary"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // "copies of **me**" — a source that was never chosen, so it is not in
      // `targets` and cannot be reached by index.
      effect: createToken("reflection", 2, {
        to: "sourceLocation",
        copyOfSource: true,
      }),
    },
  ],
};

export const spriteMother: CardInstance = {
  id: "sprite-mother",
  name: "Sprite Mother",
  tags: ["Fae"],
  text: "When you play me, play a ready 3 [M] Sprite unit token with [Temporary] here.",
  type: "unit",
  cost: cost(4, "mind", 1),
  might: 3,
  domains: ["mind"],
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      // R187.2 gives the Sprite token [Temporary] already; the card restates
      // it as reminder text rather than granting a second instance (R816.2
      // makes multiples redundant either way).
      effect: createToken("sprite", 1, { ready: true, to: "sourceLocation" }),
    },
  ],
};

export const spriteCall: CardInstance = {
  id: "sprite-call",
  name: "Sprite Call",
  text: "[Hidden] [Action] Play a ready 3 [M] Sprite unit token with [Temporary].",
  type: "spell",
  cost: cost(3),
  domains: ["mind"],
  keywords: ["hidden", "action"],
  abilities: [
    {
      kind: "activated",
      timing: "action",
      costs: [],
      // No location named, so R184.2's default applies: the controller's base.
      effect: createToken("sprite", 1, { ready: true }),
    },
  ],
};

export const petalPixie: CardInstance = {
  id: "petal-pixie",
  name: "Petal Pixie",
  tags: ["Fae", "Ionia"],
  text: "I have +1 [M] for each of your units with [Temporary] at my battlefield.",
  type: "unit",
  cost: cost(2),
  might: 2,
  domains: ["mind"],
  keywords: [],
  abilities: [
    // "for each" is a count of the board, not a number, so it is recomputed on
    // every pass of R476.2's fixpoint. It counts *itself* if it ever gains
    // [Temporary] — the text says "your units", not "your other units".
    mightPerUnit(1, {
      controller: "friendly",
      keyword: "temporary",
      here: true,
    }),
  ],
};

export const shadowsCall: CardInstance = {
  id: "shadows-call",
  name: "Shadow's Call",
  text: "Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2.",
  type: "spell",
  cost: cost(2),
  domains: ["order"],
  keywords: [],
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [],
      // "without [Temporary]" is read through the layers, so a unit that was
      // given the keyword earlier this turn stops being a legal choice.
      targeting: {
        filters: [
          { type: "unit", controller: "friendly", withoutKeyword: "temporary" },
        ],
      },
      // R816 has no duration on it — the keyword is granted outright, and the
      // unit dies at the start of its controller's next Beginning Phase.
      effect: {
        op: "seq",
        steps: [grantKeywordFor("temporary", "permanent", 0), draw(2)],
      },
    },
  ],
};

export const sumpworksMap: CardInstance = {
  id: "sumpworks-map",
  name: "Sumpworks Map",
  text: "[Reaction] [Temporary] When an opponent scores, draw 1.",
  type: "gear",
  cost: cost(2),
  domains: ["mind"],
  keywords: ["reaction", "temporary"],
  abilities: [
    {
      kind: "triggered",
      // R816 is written for permanents generally, so a gear carries it the
      // same way a unit does — it is `killSelf` either way.
      trigger: { on: "battlefieldScored", subject: "controller" },
      controllerIsEventPlayer: true,
      effect: draw(1),
    },
  ],
};

export const gemcraftSeer: CardInstance = {
  id: "gemcraft-seer",
  name: "Gemcraft Seer",
  tags: ["Mount Targon"],
  text: "[Vision] Other friendly units have [Vision].",
  type: "unit",
  cost: cost(3, "mind", 1),
  might: 3,
  domains: ["mind"],
  keywords: ["vision"],
  // R817 expands [Vision] into its triggered ability in `abilitiesOf`, so
  // granting the keyword grants the whole thing — the anthem does not have to
  // restate the ability.
  abilities: [anthemKeyword("vision", false)],
};

export const jeweledColossus: CardInstance = {
  id: "jeweled-colossus",
  name: "Jeweled Colossus",
  tags: ["Mount Targon"],
  text: "[Vision] [Shield]",
  type: "unit",
  cost: cost(5),
  might: 5,
  domains: ["mind"],
  keywords: ["vision", "shield"],
  abilities: [],
};

export const downstageDramatics: CardInstance = {
  id: "downstage-dramatics",
  name: "Downstage Dramatics",
  text: "[Reaction] [Repeat] [2] Draw 1.",
  type: "spell",
  cost: cost(2),
  domains: ["mind"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      effect: draw(1),
    },
    repeat({ energy: 2 }),
  ],
};

export const frigidTouch: CardInstance = {
  id: "frigid-touch",
  name: "Frigid Touch",
  text: "[Reaction] [Repeat] [2] Give a unit -2 [M] this turn.",
  type: "spell",
  cost: cost(2),
  domains: ["mind"],
  keywords: ["reaction"],
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      costs: [],
      targeting: { filters: [{ type: "unit" }] },
      effect: modifyMight(-2, "thisTurn"),
    },
    repeat({ energy: 2 }),
  ],
};

export const apprenticeMage: CardInstance = {
  id: "apprentice-mage",
  name: "Apprentice Mage",
  tags: ["Bilgewater"],
  text: "[Empower] [2] When I become [Empowered], [Predict 2]. [Empowered] I have +1 [M].",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["mind"],
  keywords: [],
  abilities: [
    // R827.1.c.1 — [Empower] expands into its own activated ability, gated on
    // not already being Empowered.
    empower({ energy: 2 }),
    {
      kind: "triggered",
      trigger: { on: "empowered", subject: "self" },
      effect: predict(2),
    },
    // R828 — "[Empowered] >" is a dependent ability, active only while the
    // status holds.
    passive({ target: "self" }, {
      layer: "arithmetic",
      op: "addMight",
      amount: 1,
    }, { when: "empowered" }),
  ],
};

export const solariSunhawk: CardInstance = {
  id: "solari-sunhawk",
  name: "Solari Sunhawk",
  tags: ["Bird", "Mount Targon"],
  text: "[Empower] [2] [Empowered] I have +1 [M] and [Deflect 2].",
  type: "unit",
  cost: cost(3),
  might: 3,
  domains: ["order"],
  keywords: [],
  abilities: [
    empower({ energy: 2 }),
    passive({ target: "self" }, {
      layer: "arithmetic",
      op: "addMight",
      amount: 1,
    }, { when: "empowered" }),
    // R809.2 — a granted Deflect value is summed rather than redundant, which
    // is why the value travels with the grant.
    passive({ target: "self" }, {
      layer: "ability",
      op: "grantKeyword",
      keyword: "deflect",
      value: 2,
    }, { when: "empowered" }),
  ],
};

export const lecturingYordle: CardInstance = {
  id: "lecturing-yordle",
  name: "Lecturing Yordle",
  tags: ["Yordle", "Bandle City"],
  text: "[Tank] When you play me, draw 1.",
  type: "unit",
  cost: cost(3),
  might: 2,
  domains: ["mind"],
  keywords: ["tank"],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "unitPlayed", subject: "self" },
      effect: draw(1),
    },
  ],
};

export const dredgeUp: CardInstance = {
  id: "dredge-up",
  name: "Dredge Up",
  text: "Draw 1. [Flow] [2]",
  type: "spell",
  cost: cost(2),
  domains: ["mind"],
  keywords: [],
  abilities: [
    { kind: "activated", timing: "default", costs: [], effect: draw(1) },
    // R829.1.b — playable from the trash for this cost instead of its own,
    // and banished on its way off the chain rather than trashed again.
    flow({ energy: 2 }),
  ],
};

export const clothArmor: CardInstance = {
  id: "cloth-armor",
  name: "Cloth Armor",
  tags: ["Equipment"],
  text: "[Quick-Draw] [Equip] [Mind]",
  type: "gear",
  cost: cost(1),
  domains: ["mind"],
  // R819.1.d — [Quick-Draw] is short for [Reaction] plus "when you play this,
  // attach it to a unit you control", both derived rather than written here.
  keywords: ["quickDraw"],
  attachment: { mightBonus: 1, keywords: [] },
  abilities: [
    {
      kind: "activated",
      timing: "default",
      costs: [{ kind: "pay", cost: cost(0, "mind", 1) }],
      targeting: { filters: [{ type: "unit", controller: "friendly" }] },
      effect: { op: "attachSelf", targetIndex: 0 },
    },
  ],
};

// R485.5 — three battlefields, one of which is used. R103.4.b's "subject to
// Domain Identity if applicable" does not bite: battlefields carry no Domain,
// so any three are legal under any identity.

export const blackFlameAltar: CardInstance = {
  id: "black-flame-altar",
  name: "Black Flame Altar",
  text: "Units here with [Temporary] have [Shield].",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    // "Units" with no side named, so both players'. The keyword is read
    // through the layers, which is what makes a Reflection token granted
    // [Temporary] by Deceiver qualify the same as a printed Sprite.
    passive({ target: "allUnits", here: true, keyword: "temporary" }, {
      layer: "ability",
      op: "grantKeyword",
      keyword: "shield",
    }),
  ],
};

export const altarToUnity: CardInstance = {
  id: "altar-to-unity",
  name: "Altar to Unity",
  text: "When you hold here, play a 1 [M] Recruit unit token in your base.",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      trigger: { on: "battlefieldScored", subject: "here", method: "hold" },
      // "in your base" rather than here, so R184.2's default is what is wanted.
      effect: createToken("recruit", 1),
    },
  ],
};

export const backAlleyBar: CardInstance = {
  id: "back-alley-bar",
  name: "Back-Alley Bar",
  text: "When a unit moves from here, give it +1 [M] this turn.",
  type: "battlefield",
  cost: FREE,
  keywords: [],
  abilities: [
    {
      kind: "triggered",
      // "from here" — the battlefield watching its own space as an origin.
      trigger: { on: "unitMoved", subject: "any", from: "here" },
      targetsSubject: true,
      effect: modifyMight(1, "thisTurn"),
    },
  ],
};
