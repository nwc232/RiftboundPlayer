# Card Data Provenance

`riftbound-cards-full.json` — 1180 cards across 5 sets (Origins, Unleashed,
Spiritforged, Vendetta, Proving Grounds), covering all card types: unit,
spell, gear, battlefield, legend, rune, plus a couple of token cards.

## Source

Fetched via the open-source fetcher at
https://github.com/vikkumar2021/RiftboundCardDatabase (`fetch_cards.py --full`),
run locally on 2026-08-08.

That script hits `https://riftbound.leagueoflegends.com/_next/data/{BUILD_ID}/en-us/card-gallery.json`
— the public data payload behind the official Riftbound card gallery
website. It requires no API key or authentication; it is not the gated
Riot Developer API. This keeps the project off any Riot API key per the
project's data-sourcing constraint (Riot's developer terms prohibit
gameplay-simulation use of the official API).

## Notes for later parsing

- Rules text per card lives at `text.richText.body` as an HTML string
  (e.g. `<p>[Reaction] (Play any time...)<br />Counter a spell...</p>`),
  with keyword reminder text inline in `[Brackets] (parenthetical
  reminder)` form.
- `cardImage.accessibilityText` duplicates the same rules text as plain
  text (useful if HTML stripping is annoying later).
- Card type lives at `cardType.type[0].id` (`unit`, `spell`, `gear`,
  `battlefield`, `legend`, `rune`).
- **Supertype lives at `cardType.superType[*].id`** — a *sibling* of `type`,
  easy to miss. Values: `champion` (303), `signature` (51), `basic` (18 runes),
  `token` (14). R133.7's two real supertypes are the first pair, and they are
  what R103.2.a.2 and R103.2.d turn on: Tibbers is `signature`, Jinx, Rebel is
  `champion`. The engine models those two; `basic` and `token` are already
  expressed by `type` and `isToken`.
- Tags live at `tags.tags` — not `tags.value`, which is the shape the sibling
  `rarity`, `set` and `domain` fields use.
- Not affiliated with or endorsed by Riot Games. Card data, names, and
  images are Riot's property; used here for private engine-development
  reference only, not redistribution.
