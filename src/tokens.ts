import { activated, addPower, recycleSelf } from "./builders.js";
import { FREE } from "./cost.js";
import type { Ability } from "./abilities.js";
import type { CardInstance, Keyword } from "./state.js";

/**
 * R179–187. Tokens are game objects created by spells and abilities during
 * play. They are not cards (R185) and cannot become cards or vice versa
 * (R185.1.a/b), but a token unit is a unit in every other respect (R185.2.d).
 *
 * R187 names each standard token's characteristics outright, so this is a
 * transcription rather than an interpretation.
 */
export interface TokenDefinition {
  name: string;
  type: CardInstance["type"];
  might?: number;
  keywords: Keyword[];
  abilities: Ability[];
}

export type TokenKind =
  | "recruit"
  | "sprite"
  | "sandSoldier"
  | "mech"
  | "gold"
  | "reflection"
  | "bird"
  | "tentacle";

/**
 * Tags (Recruit, Fae, Mech, Bird…) are listed by R187 but the engine has no
 * tag system yet, so they are recorded in the name only. Nothing reads tags.
 */
export const TOKEN_DEFINITIONS: Record<TokenKind, TokenDefinition> = {
  // R187.1
  recruit: { name: "Recruit", type: "unit", might: 1, keywords: [], abilities: [] },
  // R187.2 — Temporary is a keyword the engine does not model yet.
  sprite: { name: "Sprite", type: "unit", might: 3, keywords: [], abilities: [] },
  // R187.3
  sandSoldier: {
    name: "Sand Soldier",
    type: "unit",
    might: 2,
    keywords: [],
    abilities: [],
  },
  // R187.4
  mech: { name: "Mech", type: "unit", might: 3, keywords: [], abilities: [] },
  // R187.5 — "[Reaction] Kill this, [E]: [Add] [A]." Modelled as a recycle
  // cost because the engine has no kill-self ability cost; both remove it
  // from the board and yield one Power of any domain.
  gold: {
    name: "Gold",
    type: "gear",
    keywords: [],
    abilities: [activated([recycleSelf], addPower("selfDomain", 1), "reaction")],
  },
  // R187.6
  reflection: {
    name: "Reflection",
    type: "unit",
    might: 0,
    keywords: [],
    abilities: [],
  },
  // R187.7 — Deflect is not modelled yet.
  bird: { name: "Bird", type: "unit", might: 1, keywords: [], abilities: [] },
  // R187.10
  tentacle: {
    name: "Tentacle",
    type: "unit",
    might: 1,
    keywords: [],
    abilities: [],
  },
};

/**
 * R185.3.a.1 — tokens have no cost, but their cost is treated as 0 for all
 * purposes, which is exactly what FREE is. A copy effect can append a real
 * cost later (R185.3.a.2).
 */
export function tokenCard(kind: TokenKind, id: string): CardInstance {
  const definition = TOKEN_DEFINITIONS[kind];
  return {
    id,
    name: definition.name,
    type: definition.type,
    cost: FREE,
    keywords: [...definition.keywords],
    abilities: [...definition.abilities],
    isToken: true,
    ...(definition.might !== undefined ? { might: definition.might } : {}),
  };
}
