// Headless UI run for apps/cardgame/index.html
const { chromium } = require('playwright-core');
const path = require('path');
const SCRATCH = path.join(__dirname, 'out');
require('fs').mkdirSync(SCRATCH, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(300);

  const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1; };

  // initial board
  if ((await page.locator('.pile').count()) !== 9) fail('expected 9 piles');
  if ((await page.locator('.guess').count()) !== 18) fail('expected 18 guess buttons');
  if ((await page.textContent('#deckCount')) !== '43') fail('deck badge should read 43');
  if ((await page.locator('.pile.rec').count()) !== 1) fail('exactly one recommended pile');
  if ((await page.locator('.guess.best').count()) !== 1) fail('exactly one best button');
  // every live pile shows both percentages
  const pcts = await page.locator('.guess').allTextContents();
  if (!pcts.every(t => /%$/.test(t.trim()))) fail('all buttons show a percentage');
  // tap targets big enough
  const small = await page.$$eval('.guess', els => els.filter(el => el.getBoundingClientRect().height < 44).length);
  if (small > 0) fail(`${small} guess buttons under 44px tall`);
  // progress bar: fresh game = 43 left, 0% done
  const lbl0 = await page.textContent('#progressLbl');
  if (!/43 cards left · 0% to victory/.test(lbl0)) fail('initial progress label wrong: ' + lbl0);
  await page.screenshot({ path: SCRATCH + '/shot-1-initial.png' });

  // take the recommended guess (should usually win; either way state advances)
  await page.locator('.guess.best').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: SCRATCH + '/shot-2-after-tap.png' });
  const deckAfter = await page.textContent('#deckCount');
  if (deckAfter !== '42') fail('deck should be 42 after one guess, got ' + deckAfter);
  const lbl1 = await page.textContent('#progressLbl');
  if (!/42 cards left · 2% to victory/.test(lbl1)) fail('progress label after one guess wrong: ' + lbl1);
  const fillW = await page.$eval('#progressFill', el => el.style.width);
  if (fillW !== '2%') fail('progress fill should be 2%, got ' + fillW);

  // force a losing guess to capture the drink toast: pick the worst button
  await page.waitForTimeout(1300); // let any toast clear
  const worst = await page.evaluate(() => {
    const s = window.__game.state;
    let bi = -1, bd = null, bp = 2;
    s.piles.forEach((pile, i) => {
      if (!pile.alive) return;
      const p = window.__game.Engine.probs(s, i);
      if (p.higher < bp) { bp = p.higher; bi = i; bd = 'higher'; }
      if (p.lower < bp) { bp = p.lower; bi = i; bd = 'lower'; }
    });
    return { bi, bd, bp };
  });
  // click the worst button repeatedly until a loss lands (p may be > 0)
  let sawToast = false, sawDead = false;
  for (let k = 0; k < 30 && !(sawToast && sawDead); k++) {
    const target = await page.evaluate(() => {
      const s = window.__game.state;
      if (s.over) return null;
      let bi = -1, bd = null, bp = 2;
      s.piles.forEach((pile, i) => {
        if (!pile.alive) return;
        const p = window.__game.Engine.probs(s, i);
        if (p.higher < bp) { bp = p.higher; bi = i; bd = 'higher'; }
        if (p.lower < bp) { bp = p.lower; bi = i; bd = 'lower'; }
      });
      return { bi, bd };
    });
    if (!target) break;
    await page.locator(`.guess[data-i="${target.bi}"][data-dir="${target.bd}"]`).click();
    await page.waitForTimeout(120);
    if (await page.locator('#toast.show').count()) {
      if (!sawToast) {
        sawToast = true;
        await page.screenshot({ path: SCRATCH + '/shot-3-drink-toast.png' });
        // toast must swallow taps: deck count frozen while shown
        const before = await page.textContent('#deckCount');
        await page.mouse.click(195, 420);
        const after = await page.textContent('#deckCount');
        if (before !== after) fail('tap leaked through drink toast');
      }
    }
    await page.waitForTimeout(1200);
    if ((await page.locator('.pile.dead').count()) > 0) sawDead = true;
  }
  if (!sawToast) fail('never saw the drink toast');
  if (!sawDead) fail('never produced a dead pile');
  const drinks = parseInt(await page.textContent('#drinkCount'), 10);
  if (!(drinks >= 1)) fail('drink counter should be >= 1 after a loss, got ' + drinks);
  await page.screenshot({ path: SCRATCH + '/shot-4-dead-pile.png' });

  // drive to game over via the recommended button each time
  for (let k = 0; k < 60; k++) {
    const over = await page.evaluate(() => window.__game.state.over);
    if (over) break;
    if (await page.locator('#toast.show').count()) { await page.waitForTimeout(1200); continue; }
    const best = page.locator('.guess.best');
    if (!(await best.count())) { await page.waitForTimeout(300); continue; }
    await best.click();
    await page.waitForTimeout(520);
  }
  await page.waitForTimeout(1300);
  if (!(await page.locator('#gameover.show').count())) fail('game-over overlay not shown');
  await page.screenshot({ path: SCRATCH + '/shot-5-gameover.png' });

  // new game resets board but keeps session drinks
  const sessionBefore = await page.textContent('#drinkCount');
  await page.locator('#again').click();
  await page.waitForTimeout(200);
  if ((await page.textContent('#deckCount')) !== '43') fail('new game should reset deck to 43');
  if ((await page.locator('.pile.dead').count()) !== 0) fail('new game should have no dead piles');
  if ((await page.textContent('#drinkCount')) !== sessionBefore) fail('session drink counter must survive new game');
  await page.screenshot({ path: SCRATCH + '/shot-6-newgame.png' });

  if (errors.length) fail('console errors: ' + errors.join(' | '));
  console.log(process.exitCode ? 'UI TESTS FAILED' : 'all UI checks passed');
  await browser.close();
})();
