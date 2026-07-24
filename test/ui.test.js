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
  // every live pile shows both percentages plus a potential payout
  const pcts = await page.locator('.guess').allTextContents();
  if (!pcts.every(t => /%\+\d+$/.test(t.trim()))) fail('all buttons show odds and payout');
  // score chip starts at zero in the progress bar corner
  if ((await page.textContent('#scoreChip')) !== '0 pts') fail('score chip should start at 0 pts');
  // tap targets big enough
  const small = await page.$$eval('.guess', els => els.filter(el => el.getBoundingClientRect().height < 44).length);
  if (small > 0) fail(`${small} guess buttons under 44px tall`);
  // progress bar: fresh game = 43 left, 0% done
  const lbl0 = await page.textContent('#progressLbl');
  if (!/43 cards left · 0% to victory/.test(lbl0)) fail('initial progress label wrong: ' + lbl0);
  // win-chance chip: a plausible fresh-game estimate in the progress corner
  const wc0 = await page.textContent('#winChance');
  if (!/^win \d+%$/.test(wc0)) fail('win chance chip missing: "' + wc0 + '"');
  const wcv = parseInt(wc0.match(/\d+/)[0], 10);
  if (!(wcv >= 20 && wcv <= 70)) fail('fresh-game win chance implausible: ' + wc0);
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
  const wcEnd = await page.textContent('#winChance');
  if (!/^win (100|0)%$/.test(wcEnd)) fail('terminal win chance should be 0/100: ' + wcEnd);
  const goSub = await page.textContent('#gameover .sub');
  if (!/Score: \d+/.test(goSub)) fail('game over should show the final score: ' + goSub);
  const badge = await page.textContent('#bestBadge');
  if (!/best/i.test(badge)) fail('best-score badge missing: ' + badge);
  if (!(await page.locator('#shareBtn').count())) fail('share button missing');
  await page.locator('#shareBtn').click(); // must not crash (clipboard may be blocked headless)
  const scoreEnd = await page.textContent('#scoreChip');
  if (!/^\d+ pts$/.test(scoreEnd)) fail('score chip should show a number: ' + scoreEnd);
  await page.screenshot({ path: SCRATCH + '/shot-5-gameover.png' });

  // new game resets board but keeps session drinks
  const sessionBefore = await page.textContent('#drinkCount');
  await page.locator('#again').click();
  await page.waitForTimeout(200);
  if ((await page.textContent('#deckCount')) !== '43') fail('new game should reset deck to 43');
  if ((await page.locator('.pile.dead').count()) !== 0) fail('new game should have no dead piles');
  if ((await page.textContent('#drinkCount')) !== sessionBefore) fail('session drink counter must survive new game');
  await page.screenshot({ path: SCRATCH + '/shot-6-newgame.png' });

  // Nate mode: face-down deal, flip to play, everything leaky hidden
  await page.locator('#nateBtn').click();
  await page.waitForTimeout(200);
  if ((await page.locator('.card.back').count()) !== 9) fail('nate: expected 9 face-down piles');
  if ((await page.locator('.guess').count()) !== 0) fail('nate: no guess buttons before a flip');
  if ((await page.locator('.pile.rec').count()) !== 0) fail('nate: no gold recommendation');
  if ((await page.textContent('#winChance')) !== 'win ?%') fail('nate: win chance must be hidden');
  if ((await page.textContent('#deckCount')) !== '43') fail('nate toggle should deal a fresh game');
  await page.locator('.card.back[data-flip="4"]').click();
  await page.waitForTimeout(200);
  if ((await page.locator('.card.back').count()) !== 8) fail('nate: tap should flip the pile');
  const nbtns = await page.locator('.guess').allTextContents();
  if (nbtns.length !== 2 || nbtns.some(t => /%/.test(t))) fail('nate: revealed pile plays blind (no odds)');
  await page.screenshot({ path: SCRATCH + '/shot-7-nate.png' });
  await page.locator('.guess[data-i="4"][data-dir="higher"]').click();
  await page.waitForTimeout(150);
  if ((await page.textContent('#deckCount')) !== '42') fail('nate: blind guess should consume a card');
  await page.waitForTimeout(1500); // let a possible drink toast clear
  // toggling back restarts a normal face-up game
  await page.locator('#nateBtn').click();
  await page.waitForTimeout(200);
  if ((await page.locator('.card.back').count()) !== 0) fail('nate off: face-up deal');
  if ((await page.textContent('#deckCount')) !== '43') fail('nate off: fresh game');
  if ((await page.locator('.guess.best').count()) !== 1) fail('nate off: recommendation returns');

  // Wacky Werner: guessing a pile locks you to it until it busts
  await page.locator('#wernerBtn').click();
  await page.waitForTimeout(200);
  if ((await page.textContent('#deckCount')) !== '43') fail('werner toggle should deal a fresh game');
  if ((await page.locator('.guess').count()) !== 18) fail('werner: all piles playable before the first guess');
  const wst = await page.evaluate(() => {
    window.__game.onGuess(0, 'higher');
    return { lock: window.__game.state.lock, alive: window.__game.state.piles[0].alive };
  });
  await page.waitForTimeout(250);
  if (wst.alive) {
    if (wst.lock !== 0) fail('werner: surviving pile should hold the lock');
    if ((await page.locator('.guess').count()) !== 18) fail('werner: every pile keeps its buttons visible');
    if ((await page.locator('.guess.off[disabled]').count()) !== 16) fail('werner: other piles disabled while locked');
    if ((await page.locator('.guess:not(.off)[data-i="0"]').count()) !== 2) fail('werner: the locked pile stays playable');
    const offTxt = (await page.locator('.guess.off').first().textContent()).trim();
    if (!/%/.test(offTxt)) fail('werner: locked-out buttons still show the odds: ' + offTxt);
    const rejected = await page.evaluate(() => {
      const before = window.__game.state.deck.length;
      window.__game.onGuess(1, 'higher');
      return window.__game.state.deck.length === before;
    });
    if (!rejected) fail('werner: guesses on locked-out piles must be rejected');
  } else if (wst.lock !== -1) {
    fail('werner: a bust should release the lock');
  }
  await page.screenshot({ path: SCRATCH + '/shot-8-werner.png' });
  await page.waitForTimeout(1500); // let a possible drink toast clear
  await page.locator('#wernerBtn').click(); // back to normal
  await page.waitForTimeout(200);
  if ((await page.locator('.guess').count()) !== 18) fail('werner off: free pile choice returns');

  // Streak flame: shows on the hot pile once a win streak starts
  const streakN = await page.evaluate(() => {
    const g = window.__game;
    let guard = 0;
    while (g.state.streak.n < 1 && !g.state.over && guard++ < 50) {
      const rec = g.Engine.recommend(g.state);
      g.Engine.guess(g.state, rec.pile, rec.dir);
    }
    g.refresh();
    return g.state.over ? 0 : g.state.streak.n;
  });
  if (streakN >= 1 && !(await page.locator('.flame').count())) fail('streak flame missing');
  if (!(await page.locator('#confetti').count())) fail('confetti canvas missing');
  await page.evaluate(() => window.__game.reset());
  await page.waitForTimeout(150);

  // Sound: mute toggle exists and persists
  const mLbl = await page.textContent('#muteBtn');
  if (!/🔊|🔇/.test(mLbl)) fail('mute button missing: ' + mLbl);
  await page.locator('#muteBtn').click();
  const mutedStored = await page.evaluate(() => {
    try { return localStorage.getItem('hl.muted'); } catch (_) { return 'blocked'; }
  });
  if (mutedStored !== '1' && mutedStored !== 'blocked') fail('mute state should persist: ' + mutedStored);
  if ((await page.textContent('#muteBtn')) !== '🔇') fail('mute button should show muted state');
  await page.locator('#muteBtn').click(); // back on

  // Multiplayer: editor, turn strip, named toast, leaderboard
  await page.locator('#drinkStat').click();
  if (!(await page.locator('#playersOv.show').count())) fail('players editor should open from the 🍺 chip');
  await page.locator('#addPlayer').click();
  await page.locator('#plist input').nth(1).fill('Werner');
  await page.locator('#playersDone').click();
  await page.waitForTimeout(200);
  let names = await page.evaluate(() => window.__game.state.players.map(p => p.name));
  if (JSON.stringify(names) !== JSON.stringify(['You', 'Werner'])) fail('editor roster wrong: ' + names);

  await page.evaluate(() => window.__game.setRoster(['Toby', 'Nate']));
  await page.waitForTimeout(200);
  if ((await page.locator('#turnStrip:not([hidden])').count()) !== 1) fail('multi: turn strip should show');
  let strip = await page.textContent('#turnStrip');
  if (!/Toby/.test(strip) || !/Nate/.test(strip)) fail('multi: strip should name current and next: ' + strip);
  await page.evaluate(() => window.__game.onGuess(0, 'higher'));
  await page.waitForTimeout(250);
  strip = await page.textContent('#turnStrip');
  if (!/▶ Nate/.test(strip)) fail('multi: the turn should pass to Nate: ' + strip);

  // hunt a loss to see the named drink toast
  let namedToast = false;
  for (let k = 0; k < 30 && !namedToast; k++) {
    const alive = await page.evaluate(() => {
      const s = window.__game.state;
      if (s.over) return false;
      let bi = -1, bd = null, bp = 2;
      s.piles.forEach((pile, i) => {
        if (!pile.alive) return;
        const p = window.__game.Engine.probs(s, i);
        if (p.higher < bp) { bp = p.higher; bi = i; bd = 'higher'; }
        if (p.lower < bp) { bp = p.lower; bi = i; bd = 'lower'; }
      });
      window.__game.onGuess(bi, bd);
      return true;
    });
    if (!alive) break;
    await page.waitForTimeout(150);
    if (await page.locator('#toast.show').count()) {
      const big = await page.textContent('#toast .big');
      if (!/(TOBY|NATE) DRINKS \d+/.test(big)) fail('multi: toast should name the drinker: ' + big);
      namedToast = true;
      await page.screenshot({ path: SCRATCH + '/shot-9-multi-toast.png' });
    }
    await page.waitForTimeout(1400);
  }
  if (!namedToast) fail('multi: never saw a named drink toast');

  // drive to game over at engine speed and check the leaderboard
  await page.evaluate(() => {
    const g = window.__game;
    let guard = 0;
    while (!g.state.over && guard++ < 300) {
      const rec = g.Engine.recommend(g.state);
      if (!rec) break;
      g.Engine.guess(g.state, rec.pile, rec.dir);
    }
    g.refresh();
  });
  await page.waitForTimeout(300);
  if (!(await page.locator('#gameover.show').count())) fail('multi: game over should show');
  const lb = await page.textContent('#gameover .sub');
  if (!/🏆/.test(lb) || !/(Toby|Nate)/.test(lb)) fail('multi: expected a leaderboard: ' + lb);
  await page.screenshot({ path: SCRATCH + '/shot-10-leaderboard.png' });

  // back to solo: strip hides, UI matches the classic game
  await page.evaluate(() => window.__game.setRoster(['You']));
  await page.waitForTimeout(200);
  if ((await page.locator('#turnStrip:not([hidden])').count()) !== 0) fail('solo: turn strip must hide');

  if (errors.length) fail('console errors: ' + errors.join(' | '));
  console.log(process.exitCode ? 'UI TESTS FAILED' : 'all UI checks passed');
  await browser.close();
})();
