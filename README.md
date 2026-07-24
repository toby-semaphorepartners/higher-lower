# Higher / Lower 🍺

A one-page multi-pile higher/lower drinking game. Dark, high-contrast, built for
one-handed use outdoors at night. Single self-contained HTML file — no build, no
dependencies, no backend, no tracking; all state is in-memory (refresh = fresh game).

## Play

Open `index.html` in any browser. That's the whole install.

For phone use, host the file anywhere HTTPS (camera access requires a secure
context) — or just open it locally for the on-screen game.

## Rules

- 9 piles dealt face-up in a 3×3 grid. Tap ▲ or ▼ on any live pile to guess
  whether the next card is higher or lower than its top card (ace high).
- Wrong → drink as many sips as cards in the pile (drawn card included); the pile
  dies. **Tie → drink the same, but the pile survives.**
- Every pile shows its exact win odds at all times, computed from the cards
  actually seen; the best bet pulses gold. Win by surviving until the deck runs out.
- Ties flash the screen yellow. A real loss gets the tongue photo; clearing the
  deck earns the victory photo (*Chillin*).
- The 🍺 counter counts drinking events — piles lost plus ties — not total sips.
- The corner of the progress bar shows your live chance of winning the game,
  estimated by replaying the rest of the deck from the current position.

## 😎 Nate mode

Tap 😎 to restart with all nine piles dealt face-down. Pick a pile to flip over,
then play it on pure gut: no odds, no payouts, no gold hints, no win estimate —
any of those would give the cards away. Flip more piles whenever you like;
face-down piles can't be guessed on. Clearing the deck blind pays a tripled
**+1500** victory bonus. Tapping 😎 (either way) always deals a fresh game.

## Scoring

Risk pays. A winning guess earns **100 × (1 − its shown odds)** — a coin flip pays
~50, a sure thing pays 0 — multiplied by the pile's new height (the sips you were
risking) and a streak bonus of +50% per consecutive win on the same pile. Each
▲/▼ button shows its potential payout next to the odds, and your score sits in
the left corner of the progress bar. At the end, untouched piles pay +75 each and
clearing the deck adds +500 (+1500 in Nate mode). Ties and busts score nothing
(and break the streak).

## 📷 Live mode — count a real deck

Tap **📷 Live**: the app stops dealing and instead watches your table through the
rear camera. Lay the 9 starting cards out in view — it scans them all in one look,
numbering the piles to mirror the table — then tap ▲/▼ to arm a guess and flip the
real card. Each newly dealt card is picked up automatically as the game happens,
and the odds, recommendation, drinks, and progress all track the physical deck
(unseen = 52 − every card seen).

- Recognition is pure JS: threshold → find every card in frame → perspective-warp →
  read each corner rank/suit against baked glyph templates. A card is accepted only
  when the same read shows in 3 of the last 5 frames; already-seen cards are ignored.
- **↩ Undo** reverts the last accepted card completely (drinks included) — that's
  the recovery path for misreads. 🔦 torch toggle appears on phones that support it.
- Works best with standard index decks, card flat to the camera, torch on at night.

## Development

Everything lives in `index.html` in three script blocks: `#engine` (rules + odds)
and `#vision` (recognizer) are DOM-free and unit-tested under Node; `#ui` is the
rendering and camera plumbing.

```sh
npm install           # playwright-core only (tests)
npm test              # engine + vision under Node, then two headless-Chromium suites
```

The browser tests expect a Chromium binary; set `CHROMIUM=/path/to/chromium` if it
isn't at `/opt/pw-browsers/chromium`. Screenshots land in `test/out/`.

The recognizer's glyph templates are baked data inside `index.html`. To regenerate
(e.g. after changing the normalization), replace the `TEMPLATES` JSON literal with
the placeholder `__TEMPLATES_JSON__` and run `node test/gen-templates.js` — it
renders glyphs in headless Chromium through the same normalization code the runtime
uses. Never hand-edit the baked hex.
