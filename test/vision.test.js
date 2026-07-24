// Node tests for the pure Vision block in apps/cardgame/index.html
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script id="vision">([\s\S]*?)<\/script>/)[1];
const mod = { exports: {} };
new Function('module', src)(mod);
const Vision = mod.exports.Vision;
const makePainter = require('./paint-card.js');
const P = makePainter(Vision);

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };

// 1. templates decode and are self-consistent + mutually distinguishable
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
for (const r of RANKS) {
  const bits = Vision.hexToBits(Vision.TEMPLATES.ranks[r][0]);
  let best = null;
  for (const other of RANKS) {
    for (const hex of Vision.TEMPLATES.ranks[other]) {
      const s = Vision.matchBits(bits, Vision.hexToBits(hex));
      if (!best || s > best.s) best = { other, s };
    }
  }
  assert(best.other === r, `rank ${r} closest to itself (got ${best.other})`);
  assert(best.s === 1, `rank ${r} self-match = 1`);
}
for (const pool of [['♠', '♣'], ['♥', '♦']]) {
  for (const s of pool) {
    const bits = Vision.hexToBits(Vision.TEMPLATES.suits[s][0]);
    const other = pool.find(x => x !== s);
    const self = Vision.matchBits(bits, Vision.hexToBits(Vision.TEMPLATES.suits[s][0]));
    const cross = Vision.matchBits(bits, Vision.hexToBits(Vision.TEMPLATES.suits[other][0]));
    assert(self > cross, `suit ${s} distinguishable from ${other} within its color`);
  }
}

// 2. otsu splits a bimodal image
{
  const g = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) g[i] = i < 700 ? 30 + (i % 10) : 220 + (i % 10);
  const th = Vision.otsu(g);
  assert(th >= 30 && th < 220, `otsu threshold separates modes (got ${th})`);
}

// 3. components finds separate blobs with correct areas
{
  const w = 40, h = 20;
  const bin = new Uint8Array(w * h);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 8; x++) bin[y * w + x] = 1;     // 6x4 = 24
  for (let y = 10; y < 18; y++) for (let x = 20; x < 30; x++) bin[y * w + x] = 1; // 10x8 = 80
  const blobs = Vision.components((x, y) => bin[y * w + x] === 1, w, h);
  assert(blobs.length === 2, `two blobs found (got ${blobs.length})`);
  const areas = blobs.map(b => b.area).sort((a, b) => a - b);
  assert(areas[0] === 24 && areas[1] === 80, `blob areas 24/80 (got ${areas})`);
}

// 4. findCardQuad on a synthetic bright rect
{
  const w = 320, h = 240;
  const g = new Uint8Array(w * h).fill(20);
  for (let y = 40, x; y < 200; y++) for (x = 60; x < 260; x++) g[y * w + x] = 230;
  const q = Vision.findCardQuad(g, w, h);
  assert(q, 'quad found');
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 4;
  assert(close(q[0], [60, 40]) && close(q[2], [259, 199]), 'quad corners on the rect');
}

// 5. homography: identity mapping reproduces source pixels
{
  const H = Vision.solveH([[0, 0], [Vision.CW - 1, 0], [Vision.CW - 1, Vision.CH - 1], [0, Vision.CH - 1]]);
  assert(H, 'identity homography solvable');
  for (const [x, y] of [[0, 0], [100, 140], [199, 279]]) {
    const d = H[6] * x + H[7] * y + H[8];
    const sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d;
    assert(Math.abs(sx - x) < 1e-6 && Math.abs(sy - y) < 1e-6, `identity H at ${x},${y}`);
  }
}

// 6. readCard on painted canonical cards — every rank and suit
{
  const suits = ['♠', '♥', '♦', '♣'];
  let n = 0;
  for (const r of RANKS) {
    const s = suits[n++ % 4];
    const card = P.paintCanonical(r, s);
    const read = Vision.readCard(card);
    assert(read, `readCard(${r}${s}) got a read`);
    if (read) assert(read.rank === r && read.suit === s, `readCard(${r}${s}) = ${read && read.rank + read.suit}`);
  }
}

// 7. full detect() on a synthetic frame, plus null cases
{
  const frame = P.paintFrame('Q', '♥');
  const out = Vision.detect(frame.data, frame.width, frame.height);
  assert(out.quad, 'detect finds the card quad');
  assert(out.read && out.read.rank === 'Q' && out.read.suit === '♥', `detect reads Q♥ (got ${out.read && out.read.rank + out.read.suit})`);

  const blank = P.blankFrame();
  const none = Vision.detect(blank.data, blank.width, blank.height);
  assert(!none.read, 'blank frame produces no read');
}

// 8. detect survives an off-center, smaller card
{
  const frame = P.paintFrame('6', '♣', { scale: 1.1, x0: 80, y0: 90 });
  const out = Vision.detect(frame.data, frame.width, frame.height);
  assert(out.read && out.read.rank === '6' && out.read.suit === '♣', `off-center 6♣ read (got ${out.read && out.read.rank + out.read.suit})`);
}

console.log(process.exitCode ? 'VISION TESTS FAILED' : 'all vision tests passed');
