// Bake rank/suit bit templates into apps/cardgame/index.html.
// Renders glyphs on canvas in headless Chromium and normalizes them with the
// page's own Vision.normalizeBits so runtime + template pipelines match.
const fs = require('fs');
const { chromium } = require('playwright-core');
const FILE = require('path').join(__dirname, '..', 'index.html');
const SCRATCH = require('path').join(__dirname, 'out');
require('fs').mkdirSync(SCRATCH, { recursive: true });

(async () => {
  const html = fs.readFileSync(FILE, 'utf8');
  const stub = html.replace('__TEMPLATES_JSON__', '{"ranks":{},"suits":{}}');
  const genPath = SCRATCH + '/gen-page.html';
  fs.writeFileSync(genPath, stub);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('pageerror:', e); process.exitCode = 1; });
  await page.goto('file://' + genPath);

  const result = await page.evaluate(() => {
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const SUITS = ['♠', '♥', '♦', '♣'];
    const FONTS = ['bold 90px sans-serif', '900 90px sans-serif', 'bold 90px serif'];

    function renderGlyph(text, font) {
      const c = document.createElement('canvas');
      c.width = 220; c.height = 160;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#000'; ctx.font = font;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(text, c.width / 2, c.height / 2);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const w = c.width, h = c.height;
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = img.data[i * 4] < 128 ? 1 : 0;
      // overall bbox of everything drawn (handles the two glyphs of "10")
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) return null;
      const bits = Vision.normalizeBits(mask, w, x0, y0, x1, y1);
      let hex = '';
      for (let i = 0; i < bits.length; i += 4) {
        hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
      }
      return hex;
    }

    const out = { ranks: {}, suits: {} };
    for (const r of RANKS) {
      out.ranks[r] = FONTS.map(f => renderGlyph(r, f)).filter(Boolean);
    }
    for (const s of SUITS) {
      out.suits[s] = ['90px sans-serif', '90px serif'].map(f => renderGlyph(s, f)).filter(Boolean);
    }
    return out;
  });
  await browser.close();

  // sanity: every rank/suit produced at least one template, all distinct enough
  const ranks = Object.keys(result.ranks);
  if (ranks.length !== 13) throw new Error('missing ranks');
  for (const r of ranks) if (!result.ranks[r].length) throw new Error('no template for ' + r);
  for (const s of Object.keys(result.suits)) if (!result.suits[s].length) throw new Error('no template for ' + s);

  const json = JSON.stringify(result);
  const updated = html.replace('__TEMPLATES_JSON__', json);
  if (updated === html) throw new Error('placeholder __TEMPLATES_JSON__ not found (already baked?)');
  fs.writeFileSync(FILE, updated);
  console.log('baked templates:', json.length, 'chars');
})();
