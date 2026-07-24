// Synthetic card frames for tests — paints glyphs straight from the baked
// templates so recognition tests are deterministic. Works in Node and browser.
(function (root) {
  function makePainter(Vision) {
    const CW = Vision.CW, CH = Vision.CH;

    function paintBits(img, w, bits, x0, y0, cw, ch, rgb) {
      for (let gy = 0; gy < Vision.GH; gy++) {
        for (let gx = 0; gx < Vision.GW; gx++) {
          if (!bits[gy * Vision.GW + gx]) continue;
          for (let dy = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++) {
            const p = ((y0 + gy * ch + dy) * w + (x0 + gx * cw + dx)) * 4;
            img[p] = rgb[0]; img[p + 1] = rgb[1]; img[p + 2] = rgb[2]; img[p + 3] = 255;
          }
        }
      }
    }

    // canonical 200x280 card face with rank+suit in both index corners
    function paintCanonical(rankLabel, suit) {
      const img = new Uint8ClampedArray(CW * CH * 4);
      for (let i = 0; i < CW * CH; i++) {
        img[i * 4] = 245; img[i * 4 + 1] = 243; img[i * 4 + 2] = 232; img[i * 4 + 3] = 255;
      }
      const T = Vision.TEMPLATES;
      const rankBits = Vision.hexToBits(T.ranks[rankLabel][0]);
      const suitBits = Vision.hexToBits(T.suits[suit][0]);
      const red = suit === '♥' || suit === '♦';
      const rgb = red ? [198, 22, 40] : [12, 12, 18];
      paintBits(img, CW, rankBits, 12, 10, 2, 2, rgb);   // 32x48 rank
      paintBits(img, CW, suitBits, 12, 66, 2, 2, rgb);   // 32x48 suit below
      // opposite corner, 180-rotated
      const rot = new Uint8ClampedArray(img);
      for (let y = 0; y < 120; y++) for (let x = 0; x < 54; x++) {
        const src = (y * CW + x) * 4;
        const dst = ((CH - 1 - y) * CW + (CW - 1 - x)) * 4;
        rot[dst] = img[src]; rot[dst + 1] = img[src + 1]; rot[dst + 2] = img[src + 2];
      }
      return { data: rot, width: CW, height: CH };
    }

    function blankFrame(fw, fh) {
      fw = fw || 640; fh = fh || 480;
      const img = new Uint8ClampedArray(fw * fh * 4);
      for (let i = 0; i < fw * fh; i++) {
        img[i * 4] = 14; img[i * 4 + 1] = 16; img[i * 4 + 2] = 22; img[i * 4 + 3] = 255;
      }
      return { data: img, width: fw, height: fh };
    }

    // card blitted into a dark 640x480 "night table" frame
    function paintFrame(rankLabel, suit, opts) {
      opts = opts || {};
      const frame = blankFrame();
      const card = paintCanonical(rankLabel, suit);
      const scale = opts.scale || 1.4, x0 = opts.x0 || 180, y0 = opts.y0 || 40;
      const w = Math.round(CW * scale), h = Math.round(CH * scale);
      for (let y = 0; y < h && y0 + y < frame.height; y++) {
        for (let x = 0; x < w && x0 + x < frame.width; x++) {
          const sx = Math.min(CW - 1, Math.floor(x / scale));
          const sy = Math.min(CH - 1, Math.floor(y / scale));
          const s = (sy * CW + sx) * 4, d = ((y0 + y) * frame.width + (x0 + x)) * 4;
          frame.data[d] = card.data[s]; frame.data[d + 1] = card.data[s + 1]; frame.data[d + 2] = card.data[s + 2];
        }
      }
      return frame;
    }

    return { paintCanonical, paintFrame, blankFrame };
  }
  if (typeof module !== 'undefined') module.exports = makePainter;
  else root.makePainter = makePainter;
})(typeof self !== 'undefined' ? self : this);
