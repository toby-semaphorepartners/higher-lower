// Sanity tests for the pure engine block in apps/cardgame/index.html
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) throw new Error('engine script block not found');
const mod = { exports: {} };
new Function('module', m[1])(mod);
const Engine = mod.exports.Engine;

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };

// deterministic rng
function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

// 1. deal shape + no duplicate cards
let st = Engine.newGame(makeRng(42));
assert(st.deck.length === 43, 'deck has 43 after deal');
assert(st.piles.length === 9 && st.piles.every(p => p.cards.length === 1 && p.alive), '9 live piles of 1');
const seen = new Set();
[...st.deck, ...st.piles.flatMap(p => p.cards)].forEach(c => seen.add(c.rank + c.suit));
assert(seen.size === 52, 'all 52 cards unique');

// 2. probabilities: higher + lower + ties = 1, exact counts
for (let i = 0; i < 9; i++) {
  const top = st.piles[i].cards[0];
  const p = Engine.probs(st, i);
  const ties = st.deck.filter(c => c.rank === top.rank).length;
  assert(Math.abs(p.higher + p.lower + ties / 43 - 1) < 1e-12, `pile ${i}: p(h)+p(l)+p(tie)=1`);
  const higher = st.deck.filter(c => c.rank > top.rank).length;
  assert(Math.abs(p.higher - higher / 43) < 1e-12, `pile ${i}: exact higher count`);
}

// 3. recommendation is the argmax over live piles
const rec = Engine.recommend(st);
const bestByHand = Math.max(...st.piles.map((_, i) => {
  const p = Engine.probs(st, i); return Math.max(p.higher, p.lower);
}));
assert(Math.abs(rec.p - bestByHand) < 1e-12, 'recommend picks max probability');

// 4. losing guess (non-tie): sips = pile size incl. killer card, pile dies, drinks increment
st = Engine.newGame(makeRng(7));
// guaranteed non-tie loss: guess 'higher' where next card is strictly lower than top
const next = st.deck[st.deck.length - 1];
let pileIdx = st.piles.findIndex(p => p.cards[0].rank > next.rank);
if (pileIdx >= 0) {
  const before = st.piles[pileIdx].cards.length;
  const r = Engine.guess(st, pileIdx, 'higher');
  assert(!r.win && !r.tie, 'forced loss loses (non-tie)');
  assert(r.sips === before + 1, 'sips = pile size incl. drawn card');
  assert(!st.piles[pileIdx].alive, 'pile dies on loss');
  assert(st.drinks === 1, 'one drink event per bust');
} else {
  console.log('note: no forced-loss pile with this seed');
}

// 4b. tie: drink and live — sips charged, pile stays alive
let tieChecked = false;
for (let seed = 1; seed <= 500 && !tieChecked; seed++) {
  const s2 = Engine.newGame(makeRng(seed));
  const nx = s2.deck[s2.deck.length - 1];
  const ti = s2.piles.findIndex(p => p.cards[0].rank === nx.rank);
  if (ti < 0) continue;
  const before = s2.piles[ti].cards.length;
  const r = Engine.guess(s2, ti, 'higher');
  assert(!r.win && r.tie, 'tie is not a win but flagged tie');
  assert(r.sips === before + 1, 'tie sips = pile size incl. drawn card');
  assert(s2.piles[ti].alive, 'tie: pile survives');
  assert(s2.drinks === 1, 'tie counts as one drink event');
  tieChecked = true;
}
assert(tieChecked, 'found and verified a forced tie');

// 5. winning guess keeps pile alive, no drinks
st = Engine.newGame(makeRng(9));
const nxt = st.deck[st.deck.length - 1];
let winIdx = st.piles.findIndex(p => p.cards[0].rank < nxt.rank);
if (winIdx >= 0) {
  const r = Engine.guess(st, winIdx, 'higher');
  assert(r.win && r.sips === 0 && st.piles[winIdx].alive && st.drinks === 0, 'clean win');
}

// 6. dead/over piles reject guesses; deck exhaustion ends game
st = Engine.newGame(makeRng(3));
let guard = 0;
while (!st.over && guard++ < 500) {
  const rc = Engine.recommend(st);
  assert(rc !== null, 'recommend exists while game not over');
  Engine.guess(st, rc.pile, rc.dir);
}
assert(st.over, 'game terminates');
assert(st.reason === 'deck' || st.reason === 'dead', 'valid end reason');
if (st.reason === 'deck') assert(st.deck.length === 0, 'deck empty at deck-end');
assert(Engine.guess(st, 0, 'higher') === null, 'no guesses after game over');

// 7. full playthroughs across many seeds: invariants hold every step
for (let seed = 1; seed <= 200; seed++) {
  st = Engine.newGame(makeRng(seed));
  let steps = 0;
  while (!st.over && steps++ < 200) {
    const live = st.piles.map((p, i) => i).filter(i => st.piles[i].alive);
    const i = live[Math.floor(makeRng(seed + steps)() * live.length)];
    const p = Engine.probs(st, i);
    const dir = makeRng(seed * 31 + steps)() < 0.5 ? 'higher' : 'lower';
    const deckBefore = st.deck.length;
    const r = Engine.guess(st, i, dir);
    assert(r !== null, 'guess on live pile succeeds');
    assert(st.deck.length === deckBefore - 1, 'one card consumed per guess');
    // observed outcome consistent with 0/1 probability claims
    if (dir === 'higher' && p.higher === 1) assert(r.win, 'p=1 always wins');
    if (dir === 'higher' && p.higher === 0) assert(!r.win, 'p=0 never cleanly wins');
    // tie/loss semantics: tie lives, non-tie loss dies; drinks charged either way
    if (r.tie) assert(st.piles[i].alive && r.sips > 0, 'tie lives and drinks');
    if (!r.win && !r.tie) assert(!st.piles[i].alive, 'non-tie loss dies');
  }
  assert(st.over, `seed ${seed}: terminates`);
  const total = st.deck.length + st.piles.reduce((n, p) => n + p.cards.length, 0);
  assert(total === 52, `seed ${seed}: card conservation`);
}

// 8. live mode: setup, dup rejection, resolve, undo
let lv = Engine.newLive();
assert(lv.phase === 'setup' && lv.deck.length === 52, 'live starts in setup with full unseen deck');
const setupCards = [[14, '♠'], [2, '♥'], [7, '♦'], [7, '♣'], [11, '♠'], [12, '♥'], [13, '♦'], [3, '♣'], [9, '♠']];
setupCards.forEach(([r, s], n) => {
  const res = Engine.liveSetup(lv, r, s);
  assert(res && res.pile === n, `setup card ${n} lands on pile ${n}`);
});
assert(lv.phase === 'play' && lv.deck.length === 43, 'after 9 scans: play phase, 43 unseen');
assert(Engine.liveSetup(lv, 5, '♠') === null, 'setup rejected once playing');
assert(Engine.liveResolve(lv, 0, 'higher', 14, '♠').dup === true, 'already-seen card rejected as dup');
// pile 0 top is A♠: guessing higher with a K♥ is a guaranteed non-tie loss
let res8 = Engine.liveResolve(lv, 0, 'higher', 13, '♥');
assert(!res8.win && !res8.tie && res8.sips === 2 && !lv.piles[0].alive, 'live loss: 2 sips, pile dies');
assert(lv.deck.length === 42 && lv.drinks === 1, 'live loss consumed the card and counted one drink');
// tie on pile 2 (top 7♦): flip 7♥
res8 = Engine.liveResolve(lv, 2, 'higher', 7, '♥');
assert(!res8.win && res8.tie && lv.piles[2].alive && lv.drinks === 2, 'live tie: counts a drink, pile lives');
// win on pile 1 (top 2♥): flip 10♠ higher
res8 = Engine.liveResolve(lv, 1, 'higher', 10, '♠');
assert(res8.win && lv.drinks === 2 && lv.piles[1].alive, 'live win: no drinks');
// undo the win: card back in unseen, pile shrinks
const deckBefore8 = lv.deck.length;
assert(Engine.liveUndo(lv) === true, 'undo succeeds');
assert(lv.deck.length === deckBefore8 + 1 && lv.piles[1].cards.length === 1, 'undo restores deck and pile');
assert(lv.deck.some(c => c.rank === 10 && c.suit === '♠'), 'undone card is unseen again');
// undo chain all the way back through setup
let undos = 0;
while (Engine.liveUndo(lv)) undos++;
assert(lv.deck.length === 52 && lv.phase === 'setup' && lv.drinks === 0, 'full undo chain returns to fresh setup');
// probabilities work identically on live state (deck = unseen multiset)
lv = Engine.newLive();
setupCards.forEach(([r, s]) => Engine.liveSetup(lv, r, s));
const pLive = Engine.probs(lv, 0); // top A♠, ace high: nothing higher
assert(pLive.higher === 0 && Math.abs(pLive.lower - 40 / 43) < 1e-12, 'live probs exact (A top: 0 higher, 40/43 lower)');
assert(Engine.recommend(lv).pile === 0, 'recommend works on live state');

// 9. scoring: odds-paid wins, streak bonus, untouched + clear-deck bonuses
{
  let lv = Engine.newLive();
  assert(lv.score === 0 && lv.streak.n === 0, 'live game starts scoreless');
  const setup10 = [[14, '♠'], [2, '♥'], [7, '♦'], [7, '♣'], [11, '♠'], [12, '♥'], [13, '♦'], [3, '♣'], [9, '♠']];
  setup10.forEach(([r, s]) => Engine.liveSetup(lv, r, s));
  assert(lv.score === 0, 'setup earns nothing');
  // win on pile 1 (top 2♥) with 10♠: p = 40/43, height 2, no streak yet
  let p = Engine.probs(lv, 1).higher;
  let r = Engine.liveResolve(lv, 1, 'higher', 10, '♠');
  assert(r.win && r.pts === Math.round(100 * (1 - p) * 2), 'win pays odds × height');
  assert(r.pts === 14, 'sanity: 40/43 favorite on a fresh pile pays 14');
  assert(lv.score === 14, 'score accumulates');
  // consecutive win on the same pile: height 3, ×1.5 streak
  p = Engine.probs(lv, 1).higher;
  r = Engine.liveResolve(lv, 1, 'higher', 13, '♥');
  assert(r.pts === Math.round(100 * (1 - p) * 3 * 1.5), 'streak: +50% on second consecutive win');
  const s2 = lv.score;
  // switching piles resets the streak multiplier
  p = Engine.probs(lv, 4).higher; // pile 4 top J♠
  r = Engine.liveResolve(lv, 4, 'higher', 14, '♥');
  assert(r.pts === Math.round(100 * (1 - p) * 2), 'streak resets on a new pile');
  assert(lv.score === s2 + r.pts, 'score adds up');
  // a loss scores nothing and kills the streak
  r = Engine.liveResolve(lv, 4, 'higher', 4, '♦'); // top is now A♥: nothing is higher
  assert(!r.win && r.pts === 0 && lv.streak.n === 0, 'loss: no points, streak dead');
  // undo rolls the score back too
  Engine.liveUndo(lv); Engine.liveUndo(lv);
  assert(lv.score === s2, 'undo restores the score');
  // guaranteed win pays zero; end-of-game bonuses land on top
  const st = { deck: [{ rank: 14, suit: '♠' }],
    piles: Array.from({ length: 9 }, () => ({ cards: [{ rank: 2, suit: '♥' }], alive: true })),
    drinks: 0, over: false, reason: null, score: 0, streak: { pile: -1, n: 0 }, bonus: null,
    players: [{ name: 'You', drinks: 0, score: 0 }], turn: 0,
    stats: { ties: 0, badBreaks: 0, closeWins: 0 } };
  const rr = Engine.guess(st, 0, 'higher'); // p = 1: the sure thing pays nothing
  assert(rr.win && rr.pts === 0, 'sure thing pays 0');
  assert(st.over && st.reason === 'deck', 'deck exhausted ends the game');
  assert(st.bonus.untouched === 8 * 75 && st.bonus.win === 500, 'end bonuses: 8 untouched piles + clear');
  assert(st.score === 1100, 'final score = bonuses only');
}

// 10. Nate mode: face-down deal, flip to play, tripled win bonus
{
  const st = Engine.newGame(makeRng(5), true);
  assert(st.nate === true && st.piles.every(p => p.revealed === false), 'nate deal: all face down');
  assert(Engine.guess(st, 0, 'higher') === null, 'cannot guess a face-down pile');
  assert(st.deck.length === 43, 'blocked guess consumes nothing');
  assert(Engine.recommend(st) === null, 'nothing to recommend while all face down');
  assert(Engine.flip(st, 0) === true && st.piles[0].revealed, 'flip reveals a pile');
  assert(Engine.flip(st, 0) === false, 'no double flip');
  assert(Engine.recommend(st).pile === 0, 'recommend only sees revealed piles');
  assert(Engine.guess(st, 0, 'higher') !== null, 'guess works after the flip');
  const n = Engine.newGame(makeRng(5));
  assert(!n.nate && n.piles.every(p => p.revealed), 'normal deal stays face up');
  // clearing the deck blind pays the tripled bonus
  const tiny = { deck: [{ rank: 14, suit: '♠' }], nate: true,
    piles: Array.from({ length: 9 }, () => ({ cards: [{ rank: 2, suit: '♥' }], alive: true, revealed: true })),
    drinks: 0, over: false, reason: null, score: 0, streak: { pile: -1, n: 0 }, bonus: null,
    players: [{ name: 'You', drinks: 0, score: 0 }], turn: 0,
    stats: { ties: 0, badBreaks: 0, closeWins: 0 } };
  Engine.guess(tiny, 0, 'higher');
  assert(tiny.over && tiny.bonus.win === 1500, 'nate victory bonus is 1500');
}

// 11. Wacky Werner: once you guess a pile you're stuck with it until it busts
{
  const mkW = (deckRanks) => ({
    deck: deckRanks.map(r => ({ rank: r, suit: '♠' })), werner: true, lock: -1,
    piles: [{ cards: [{ rank: 7, suit: '♥' }], alive: true, revealed: true },
            { cards: [{ rank: 7, suit: '♦' }], alive: true, revealed: true }],
    drinks: 0, over: false, reason: null, score: 0, streak: { pile: -1, n: 0 }, bonus: null,
    players: [{ name: 'You', drinks: 0, score: 0 }], turn: 0,
    stats: { ties: 0, badBreaks: 0, closeWins: 0 },
  });
  const fresh = Engine.newGame(makeRng(21), false, true);
  assert(fresh.werner === true && fresh.lock === -1, 'werner deal starts unlocked');
  let w = mkW([5, 2, 14]); // draws come off the end: 14, then 2, then 5
  let r = Engine.guess(w, 0, 'higher'); // 14 > 7 wins
  assert(r.win && w.lock === 0, 'winning locks you to the pile');
  assert(Engine.guess(w, 1, 'higher') === null, 'other piles rejected while locked');
  assert(Engine.recommend(w).pile === 0, 'recommend honors the lock');
  r = Engine.guess(w, 0, 'higher'); // 2 < 14 busts the pile
  assert(!r.win && !r.tie && w.lock === -1, 'bust releases the lock');
  assert(Engine.guess(w, 1, 'lower') !== null, 'free to pick a new pile after the bust');
  // a tie keeps the pile alive, so it keeps the lock too
  w = mkW([7]);
  Engine.guess(w, 1, 'higher'); // 7 = 7 tie
  assert(w.piles[1].alive && w.lock === 1, 'tie keeps the lock');
  // werner-aware win estimate still behaves
  const wc = Engine.winChance(Engine.newGame(makeRng(2), false, true));
  assert(wc > 0.02 && wc < 0.7, `werner win estimate plausible (got ${wc})`);
  // normal games can still switch piles freely
  const nrm = Engine.newGame(makeRng(3));
  Engine.guess(nrm, 0, 'higher');
  assert(Engine.guess(nrm, 1, 'higher') !== null, 'normal mode switches piles');
}

// 12. multiplayer: turns rotate, tallies land on the actor, undo restores turns
{
  const st = Engine.newGame(makeRng(8), false, false, ['A', 'B', 'C']);
  assert(st.players.length === 3 && st.turn === 0, '3 players, A starts');
  assert(st.players.every(p => p.drinks === 0 && p.score === 0), 'zeroed tallies');
  const solo = Engine.newGame(makeRng(8));
  assert(solo.players.length === 1 && solo.players[0].name === 'You', 'solo default roster');
  const r1 = Engine.guess(st, 0, 'higher');
  assert(r1.player === 0 && st.turn === 1, 'first guess is player 0, then the turn passes');
  const r2 = Engine.guess(st, 1, 'higher');
  assert(r2.player === 1 && st.turn === 2, 'second guess is player 1');
  Engine.guess(st, 2, 'higher');
  assert(st.turn === 0, 'turn wraps around');
  const totScore = st.players.reduce((n, p) => n + p.score, 0);
  const totDrinks = st.players.reduce((n, p) => n + p.drinks, 0);
  assert(totScore === st.score && totDrinks === st.drinks, 'player tallies sum to the game totals');
  // nate flip is free — no turn advance
  const nat = Engine.newGame(makeRng(4), true, false, ['A', 'B']);
  Engine.flip(nat, 0);
  assert(nat.turn === 0, 'flip does not consume a turn');
  // live mode: setup scans are free; undo hands the turn back with the drinks
  const lv = Engine.newLive(['A', 'B']);
  [[14, '♠'], [2, '♥'], [7, '♦'], [7, '♣'], [11, '♠'], [12, '♥'], [13, '♦'], [3, '♣'], [9, '♠']]
    .forEach(([r, s]) => Engine.liveSetup(lv, r, s));
  assert(lv.turn === 0, 'setup scans do not consume turns');
  Engine.liveResolve(lv, 0, 'higher', 13, '♥'); // A busts pile 0 (top A♠)
  assert(lv.turn === 1 && lv.players[0].drinks === 1, 'A drank, B is up');
  Engine.liveUndo(lv);
  assert(lv.turn === 0 && lv.players[0].drinks === 0, 'undo restores the turn and the tally');
}

// 13. game stats: close wins, ties, and bad breaks
{
  const mkS = (deckRanks, tops) => ({
    deck: deckRanks.map(r => ({ rank: r, suit: '♠' })),
    piles: tops.map(r => ({ cards: [{ rank: r, suit: '♥' }], alive: true, revealed: true })),
    drinks: 0, over: false, reason: null, score: 0, streak: { pile: -1, n: 0 }, bonus: null,
    players: [{ name: 'You', drinks: 0, score: 0 }], turn: 0,
    stats: { ties: 0, badBreaks: 0, closeWins: 0 },
  });
  assert(Engine.newGame(makeRng(1)).stats.ties === 0, 'fresh game has zeroed stats');
  // close win: top 7, draw 8 higher — exactly one rank; then a comfortable win
  let s = mkS([5, 8], [7, 2]); // draws come off the end
  Engine.guess(s, 0, 'higher');
  assert(s.stats.closeWins === 1, 'win by a single rank counts as a close win');
  Engine.guess(s, 1, 'higher'); // 5 on a 2: comfortable
  assert(s.stats.closeWins === 1, 'a comfortable win does not');
  // tie
  s = mkS([7], [7]);
  Engine.guess(s, 0, 'higher');
  assert(s.stats.ties === 1, 'ties are counted');
  // bad break: 75% favorite (three 14s vs one 2 on a top of 3) draws the 2
  s = mkS([14, 14, 14, 2], [3]);
  const r = Engine.guess(s, 0, 'higher');
  assert(!r.win && !r.tie && s.stats.badBreaks === 1, 'losing a 75% favorite is a bad break');
  // a coin-flip loss is not a bad break
  s = mkS([14, 2], [7]);
  Engine.guess(s, 0, 'higher'); // 50/50, draws the 2
  assert(s.stats.badBreaks === 0, 'coin-flip losses are just losses');
  // live: undo rolls stats back
  const lv = Engine.newLive();
  [[14, '♠'], [2, '♥'], [7, '♦'], [7, '♣'], [11, '♠'], [12, '♥'], [13, '♦'], [3, '♣'], [9, '♠']]
    .forEach(([r2, s2]) => Engine.liveSetup(lv, r2, s2));
  Engine.liveResolve(lv, 2, 'higher', 7, '♥'); // 7 on 7♦: tie
  assert(lv.stats.ties === 1, 'live tie counted');
  Engine.liveUndo(lv);
  assert(lv.stats.ties === 0, 'undo rolls the stats back');
}

// 14. coin-flip recommendation on exact 50/50s
{
  const mk5050 = () => ({
    // top 8 with {2..7} and {9..14} equally represented unseen: 3 below, 3 above
    deck: [2, 3, 4, 12, 13, 14].map(r => ({ rank: r, suit: '♠' })),
    piles: [{ cards: [{ rank: 8, suit: '♥' }], alive: true, revealed: true }],
    drinks: 0, over: false, reason: null, score: 0, streak: { pile: -1, n: 0 }, bonus: null,
    players: [{ name: 'You', drinks: 0, score: 0 }], turn: 0,
    stats: { ties: 0, badBreaks: 0, closeWins: 0 },
  });
  const s = mk5050();
  const r1 = Engine.recommend(s);
  assert(r1.flip === true, '50/50 is flagged as a coin flip');
  assert(r1.dir === 'higher' || r1.dir === 'lower', 'flip picks a real direction');
  assert(Engine.recommend(s).dir === r1.dir, 'same position -> same flip (no flicker)');
  // a lopsided pile is never a flip and still wins the argmax
  const s2 = mk5050();
  s2.piles.push({ cards: [{ rank: 2, suit: '♦' }], alive: true, revealed: true });
  const r2 = Engine.recommend(s2);
  assert(r2.pile === 1 && r2.dir === 'higher' && !r2.flip, 'lopsided pile recommended without a flip');
}

// 15. winChance: Monte Carlo estimate of winning from the current position
{
  const mk = (tops, deckRanks) => ({
    deck: deckRanks.map(r => ({ rank: r, suit: '♠' })),
    piles: tops.map(r => ({ cards: [{ rank: r, suit: '♥' }], alive: true })),
    drinks: 0, over: false, reason: null,
  });
  assert(Engine.winChance(mk([2], [14])) === 1, 'guaranteed win = 1');
  assert(Engine.winChance(mk([14], [14, 14])) === 1, 'ties never bust, so all-ties = 1');
  // top 8, deck {7,9}: greedy goes higher; drawing the 7 first busts -> exactly 50/50
  const coin = Engine.winChance(mk([8], [7, 9]), 4000);
  assert(coin > 0.45 && coin < 0.55, `50/50 position ≈ 0.5 (got ${coin})`);
  const fresh = Engine.newGame(makeRng(11));
  const wc = Engine.winChance(fresh);
  assert(wc > 0.2 && wc < 0.7, `fresh game estimate plausible (got ${wc})`);
  assert(wc === Engine.winChance(fresh), 'deterministic for the same position');
  assert(Engine.winChance({ over: true, reason: 'deck' }) === 1, 'won game = 1');
  assert(Engine.winChance({ over: true, reason: 'dead' }) === 0, 'lost game = 0');
}

console.log(process.exitCode ? 'TESTS FAILED' : 'all engine tests passed');
