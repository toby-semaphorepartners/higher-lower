// Live-mode E2E for apps/cardgame/index.html
const { chromium } = require('playwright-core');
const path = require('path');
const SCRATCH = path.join(__dirname, 'out');
require('fs').mkdirSync(SCRATCH, { recursive: true });
const URL = 'file://' + path.join(__dirname, '..', 'index.html');

const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

async function smokeWithFakeCamera() {
  // fake device: camera starts, pipeline chews pattern frames without crashing
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.locator('#modeBtn').click();
  await page.waitForTimeout(2500); // ~8 ticks of pattern frames
  const st = await page.evaluate(() => ({
    mode: window.__live.mode,
    phase: window.__live.state.phase,
    deck: window.__live.state.deck.length,
    videoLive: !!document.querySelector('#camVideo').srcObject,
  }));
  if (st.mode !== 'live') fail('smoke: mode should be live');
  if (!st.videoLive) fail('smoke: fake camera stream not attached');
  if (st.phase !== 'setup' || st.deck !== 52) fail('smoke: pattern frames must not be accepted as cards, state=' + JSON.stringify(st));
  if (errors.length) fail('smoke console errors: ' + errors.join(' | '));
  await page.screenshot({ path: SCRATCH + '/shot-8-live-setup.png' });
  await browser.close();
  console.log('smoke with fake camera ok');
}

async function injectionFlow() {
  // no fake device: getUserMedia is denied -> no cam timer racing our injections
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.addScriptTag({ path: path.join(__dirname, 'paint-card.js') });
  await page.locator('#modeBtn').click();
  await page.waitForTimeout(400);

  const camMsg = await page.textContent('#camMsg');
  if (!/blocked|unavailable|No camera/i.test(camMsg)) fail('denied camera should show a friendly message, got: ' + camMsg);

  await page.evaluate(() => { window.__P = makePainter(window.__live.Vision); });

  // helper: inject n frames of a card (or blanks) through the real pipeline
  const inject = (rank, suit, n) => page.evaluate(([rank, suit, n]) => {
    for (let i = 0; i < n; i++) {
      const f = rank ? window.__P.paintFrame(rank, suit) : window.__P.blankFrame();
      window.__live.processFrame(f);
    }
  }, [rank, suit, n]);

  // --- setup: scan 9 known cards ---
  const setup = [['A', '♠'], ['3', '♥'], ['7', '♦'], ['7', '♣'], ['J', '♠'], ['Q', '♥'], ['K', '♦'], ['4', '♣'], ['9', '♠']];
  for (let i = 0; i < setup.length; i++) {
    await inject(null, null, 5);            // cool-down gap
    await inject(setup[i][0], setup[i][1], 4);
    const filled = await page.evaluate(() => window.__live.state.piles.filter(p => p.cards.length).length);
    if (filled !== i + 1) fail(`setup scan ${i + 1}: expected ${i + 1} piles filled, got ${filled}`);
  }
  let st = await page.evaluate(() => ({ phase: window.__live.state.phase, deck: window.__live.state.deck.length }));
  if (st.phase !== 'play' || st.deck !== 43) fail('after setup: play/43, got ' + JSON.stringify(st));
  await page.screenshot({ path: SCRATCH + '/shot-9-live-play.png' });

  // re-scanning an already-seen card must be ignored (dup)
  await inject(null, null, 5);
  await inject('A', '♠', 4);
  st = await page.evaluate(() => ({ deck: window.__live.state.deck.length }));
  if (st.deck !== 43) fail('dup card must not consume the deck');

  // --- win: pile 0 top is A♠, arm ▼ and flip K♥ ---
  await page.locator('.guess[data-i="0"][data-dir="lower"]').click();
  const armed = await page.evaluate(() => window.__live.armed);
  if (!armed || armed.pile !== 0 || armed.dir !== 'lower') fail('▼ on pile 0 should arm');
  if (!(await page.locator('.pile.armed').count())) fail('armed pile styled');
  await inject(null, null, 5);
  await inject('K', '♥', 4);
  st = await page.evaluate(() => ({
    deck: window.__live.state.deck.length,
    pile0: window.__live.state.piles[0].cards.length,
    alive: window.__live.state.piles[0].alive,
    drinks: window.__live.state.drinks,
    armed: window.__live.armed,
  }));
  if (st.deck !== 42 || st.pile0 !== 2 || !st.alive || st.drinks !== 0) fail('win flow wrong: ' + JSON.stringify(st));
  if (st.armed) fail('arm should clear after resolution');

  // --- loss: pile 1 top is 3♥, arm ▲ and flip 2♥ (non-tie loss) ---
  await page.waitForTimeout(600);
  await page.locator('.guess[data-i="1"][data-dir="higher"]').click();
  await inject(null, null, 5);
  await inject('2', '♥', 4);
  await page.waitForTimeout(200);
  if (!(await page.locator('#toast.show').count())) fail('loss should show drink toast');
  await page.screenshot({ path: SCRATCH + '/shot-10-live-drink.png' });
  await page.waitForTimeout(1300);
  st = await page.evaluate(() => ({
    alive: window.__live.state.piles[1].alive,
    drinks: window.__live.state.drinks,
    deck: window.__live.state.deck.length,
  }));
  if (st.alive || st.drinks !== 2 || st.deck !== 41) fail('loss flow wrong: ' + JSON.stringify(st));
  const hdrDrinks = await page.textContent('#drinkCount');
  if (hdrDrinks !== '2') fail('session drinks should read 2, got ' + hdrDrinks);

  // --- undo the loss ---
  await page.locator('#undoBtn').click();
  st = await page.evaluate(() => ({
    alive: window.__live.state.piles[1].alive,
    cards: window.__live.state.piles[1].cards.length,
    drinks: window.__live.state.drinks,
    deck: window.__live.state.deck.length,
  }));
  if (!st.alive || st.cards !== 1 || st.drinks !== 0 || st.deck !== 42) fail('undo wrong: ' + JSON.stringify(st));
  if ((await page.textContent('#drinkCount')) !== '0') fail('undo should roll back session drinks');

  // --- tie: pile 2 top is 7♦, arm ▲ and flip 7♠ ---
  await page.locator('.guess[data-i="2"][data-dir="higher"]').click();
  await inject(null, null, 5);
  await inject('7', '♠', 4);
  await page.waitForTimeout(1300);
  st = await page.evaluate(() => ({
    alive: window.__live.state.piles[2].alive,
    drinks: window.__live.state.drinks,
  }));
  if (!st.alive || st.drinks !== 2) fail('tie should drink 2 and live: ' + JSON.stringify(st));

  // --- flip with nothing armed: ignored ---
  await inject(null, null, 5);
  await inject('Q', '♦', 4);
  st = await page.evaluate(() => ({ deck: window.__live.state.deck.length }));
  if (st.deck !== 41) fail('unarmed flip must not consume the deck');

  // --- back to virtual Play mode: untouched game ---
  await page.locator('#modeBtn').click();
  await page.waitForTimeout(200);
  if ((await page.textContent('#deckCount')) !== '43') fail('virtual game should be fresh with 43');
  if ((await page.locator('.pile .card:not(.empty)').count()) !== 9) fail('virtual grid intact');

  if (errors.length) fail('console errors: ' + errors.join(' | '));
  await browser.close();
  console.log('injection flow ok');
}

(async () => {
  await smokeWithFakeCamera();
  await injectionFlow();
  console.log(process.exitCode ? 'LIVE TESTS FAILED' : 'all live-mode checks passed');
})();
