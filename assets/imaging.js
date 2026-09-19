/* ==========================================================================
   Urban Showroom — imaging
   Built by Dive In Digital Marketing

   Everything that touches pixels: decoding a phone photo, turning it into
   something a browser can store thousands of, and reducing it to two small
   descriptors the matcher can compare cheaply.

   WHY TWO DESCRIPTORS

   The brief wants two different things from image comparison, and one
   descriptor cannot do both:

     "use visual similarity to group photographs from the same job or
      physical area"                    → needs STRUCTURE. dHash.

     "automatically suggest before-and-after pairs when images appear to
      depict the same view or feature at different stages"
                                        → a before and an after of the same
                                          driveway are deliberately NOT
                                          structurally similar. That is the
                                          entire point of the photograph.

   So a second, coarser descriptor: a 4×4 grid of average colour. Point a
   camera at the same corner of the same yard twice and the house stays top
   left, the sky stays top, the grass stays green at the edges — even when
   the middle changes from mud to stamped concrete. Layout survives what
   structure does not.

   The pairing rule in intel.js reads both: near in LAYOUT, far apart in TIME,
   and only moderately near in STRUCTURE. Identical structure means somebody
   took two shots ten seconds apart, which is a duplicate, not a transform.

   STORAGE

   Photos are held as Blobs, not data: URLs. A data URL costs about 33% more
   bytes, is a JavaScript string the engine has to keep whole in memory, and
   pushes a modest photo book past browser quota. IndexedDB stores Blobs
   natively. `objectUrl()` hands out an ephemeral URL and keeps a registry so
   they can be revoked; a leaked object URL pins the whole decoded image.
   ========================================================================== */
'use strict';

const Imaging = (() => {
  /* Long-edge caps. A contractor shows this on a phone and occasionally casts
     it to a TV, so the display copy is generous; the thumb is what a 200-photo
     grid actually scrolls. */
  const FULL_EDGE = 1600;
  const THUMB_EDGE = 400;
  const FULL_QUALITY = 0.82;
  const THUMB_QUALITY = 0.72;

  /* ---- decode -----------------------------------------------------------
     createImageBitmap with imageOrientation:'from-image' applies the EXIF
     rotation for us where it is supported. Where it is not, we rotate by
     hand from the tag exif.js already read. Getting this wrong is the bug
     where every portrait photo from an iPhone lies on its side.            */
  async function decode(file, orientation = 1) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { bmp, oriented: true };
      } catch (e) { /* fall through to the <img> path */ }
      try {
        const bmp = await createImageBitmap(file);
        return { bmp, oriented: false };
      } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('Could not decode that image'));
        i.decoding = 'async';
        i.src = url;
      });
      return { bmp: img, oriented: false };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* Canvas transform for each of the eight EXIF orientations. Returns the
     output canvas size, since 5–8 swap width and height. */
  function applyOrientation(ctx, orientation, w, h) {
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); return [w, h];
      case 3: ctx.transform(-1, 0, 0, -1, w, h); return [w, h];
      case 4: ctx.transform(1, 0, 0, -1, 0, h); return [w, h];
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); return [h, w];
      case 6: ctx.transform(0, 1, -1, 0, h, 0); return [h, w];
      case 7: ctx.transform(0, -1, -1, 0, h, w); return [h, w];
      case 8: ctx.transform(0, -1, 1, 0, 0, w); return [h, w];
      default: return [w, h];
    }
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === 'function') {
      try { return new OffscreenCanvas(w, h); } catch (e) { /* fall through */ }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* Draw a decoded bitmap into a canvas capped at `maxEdge`, applying
     orientation when the decoder did not. */
  function drawScaled(source, maxEdge, orientation, alreadyOriented) {
    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    if (!sw || !sh) throw new Error('Image has no dimensions');

    const needsRotate = !alreadyOriented && orientation >= 5 && orientation <= 8;
    const logicalW = needsRotate ? sh : sw;
    const logicalH = needsRotate ? sw : sh;

    const scale = Math.min(1, maxEdge / Math.max(logicalW, logicalH));
    const outW = Math.max(1, Math.round(logicalW * scale));
    const outH = Math.max(1, Math.round(logicalH * scale));

    const canvas = makeCanvas(outW, outH);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (!alreadyOriented && orientation > 1) {
      // Scale first, then orient, so the transform works in output space.
      ctx.save();
      const drawW = needsRotate ? outH : outW;
      const drawH = needsRotate ? outW : outH;
      applyOrientation(ctx, orientation, drawW, drawH);
      ctx.drawImage(source, 0, 0, drawW, drawH);
      ctx.restore();
    } else {
      ctx.drawImage(source, 0, 0, outW, outH);
    }
    return { canvas, width: outW, height: outH };
  }

  /* WebP where the browser will take it, JPEG everywhere else. Both are
     checked by round-tripping, because Safari has historically claimed WebP
     encode support and returned a PNG. */
  async function toBlob(canvas, quality) {
    const attempt = async (type) => {
      if (canvas.convertToBlob) {
        try { return await canvas.convertToBlob({ type, quality }); } catch (e) { return null; }
      }
      return new Promise((res) => {
        try { canvas.toBlob((b) => res(b), type, quality); } catch (e) { res(null); }
      });
    };
    let blob = await attempt('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await attempt('image/jpeg');
    if (!blob) throw new Error('Could not encode that image');
    return blob;
  }

  /* ---- descriptors ------------------------------------------------------ */

  /* Grayscale samples on a w×h grid, used by both descriptors. */
  function gridLuma(source, w, h, orientation, alreadyOriented) {
    const { canvas } = drawScaled(source, Math.max(w, h), orientation, alreadyOriented);
    const small = makeCanvas(w, h);
    const ctx = small.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(canvas, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const out = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Rec. 601 luma: matches how the eye weights the channels.
      out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return out;
  }

  /* dHash — 9×8 grayscale, one bit per horizontal neighbour comparison.
     64 bits, robust to scale and compression, sensitive to structure.
     Returned as 16 hex characters so it stores and compares as a string. */
  function dHash(source, orientation, alreadyOriented) {
    const W = 9, H = 8;
    const l = gridLuma(source, W, H, orientation, alreadyOriented);
    const bits = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        bits.push(l[y * W + x] < l[y * W + x + 1] ? 1 : 0);
      }
    }
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
    }
    return hex;                                  // 64 bits → 16 hex chars
  }

  /* Colour layout — average RGB over a 4×4 grid, 48 bytes. This is the
     descriptor that survives a driveway being replaced. */
  function colorLayout(source, orientation, alreadyOriented) {
    const N = 4;
    const { canvas } = drawScaled(source, 64, orientation, alreadyOriented);
    const small = makeCanvas(N, N);
    const ctx = small.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);
    const out = [];
    for (let i = 0; i < data.length; i += 4) out.push(data[i], data[i + 1], data[i + 2]);
    return out;                                   // 48 integers, 0–255
  }

  /* The single average colour, for caption drafting. */
  function averageColor(layout) {
    if (!Array.isArray(layout) || layout.length < 3) return null;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 2 < layout.length; i += 3) { r += layout[i]; g += layout[i + 1]; b += layout[i + 2]; n++; }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
  }

  /* ---- distances -------------------------------------------------------- */

  const HEX = (() => { const m = {}; for (let i = 0; i < 16; i++) m[i.toString(16)] = i; return m; })();
  const POP = (() => { const t = new Uint8Array(16); for (let i = 0; i < 16; i++) t[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1); return t; })();

  /* Hamming distance between two dHashes, 0 (identical) to 64 (inverted). */
  /* Hex is normalised before it is read. HEX['A'] is undefined, so an
     uppercase digest scored 64 against its own lowercase twin — identical
     bits reported as maximally different, which silently switched off
     duplicate detection and before/after pairing for that photo with no
     error anywhere. A malformed hash returns null now, so a caller can
     tell "cannot compare" from "nothing like it". */
  function hamming(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (!x.length || x.length !== y.length) return null;
    let d = 0;
    for (let i = 0; i < x.length; i++) {
      const av = HEX[x[i]];
      const bv = HEX[y[i]];
      if (av === undefined || bv === undefined) return null;
      d += POP[av ^ bv];
    }
    return d;
  }

  /* Mean per-channel difference between two colour layouts, 0 (identical) to
     255. Mean rather than Euclidean so the number reads as "how many shades
     apart", which is what the thresholds in intel.js are tuned against. */
  function layoutDistance(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 255;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  /* ---- the one call the upload path makes ------------------------------- */

  /* Takes a File, returns everything a Photo record needs. EXIF is read by
     the caller BEFORE this runs, because re-encoding destroys it — the
     orientation argument is the proof of that ordering. */
  async function process(file, orientation = 1) {
    const { bmp, oriented } = await decode(file, orientation);
    try {
      const full = drawScaled(bmp, FULL_EDGE, orientation, oriented);
      const thumbSrc = full.canvas;
      const thumb = drawScaled(thumbSrc, THUMB_EDGE, 1, true);

      const [blob, thumbBlob] = await Promise.all([
        toBlob(full.canvas, FULL_QUALITY),
        toBlob(thumb.canvas, THUMB_QUALITY)
      ]);

      // Descriptors come off the already-oriented full canvas, so two photos
      // of the same view hash the same regardless of how the phone was held.
      const hash = dHash(full.canvas, 1, true);
      const layout = colorLayout(full.canvas, 1, true);

      return {
        blob,
        thumbBlob,
        width: full.width,
        height: full.height,
        bytes: blob.size,
        hash,
        layout,
        avgColor: averageColor(layout)
      };
    } finally {
      if (bmp && typeof bmp.close === 'function') bmp.close();
    }
  }

  /* ---- object URL registry ----------------------------------------------
     One URL per blob, handed out repeatedly and revoked together. Without
     this, scrolling a gallery leaks a decoded bitmap per repaint.          */
  const urls = new Map();

  function objectUrl(blob, key) {
    if (!blob) return null;
    const k = key || blob;
    if (urls.has(k)) return urls.get(k);
    const u = URL.createObjectURL(blob);
    urls.set(k, u);
    return u;
  }

  function release(key) {
    if (!urls.has(key)) return;
    URL.revokeObjectURL(urls.get(key));
    urls.delete(key);
  }

  function releaseAll() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  }

  /* Revoke everything the app no longer has a record for. `keep` is the set
     of keys still in use; `owned` decides which keys this sweep is allowed
     to touch, so an import in progress is not swept out from under itself.
     Without this the registry only ever grew: a deleted photo's URL stayed
     alive for the life of the tab, holding a decoded full-size image, and a
     restored backup that reused an id was served the old bytes. */
  function releaseExcept(keep, owned) {
    const doomed = [];
    urls.forEach((_, k) => {
      if (keep && keep.has(k)) return;
      if (typeof owned === 'function' && !owned(k)) return;
      doomed.push(k);
    });
    doomed.forEach(release);
    return doomed.length;
  }

  return {
    process, decode, drawScaled, toBlob,
    dHash, colorLayout, averageColor, hamming, layoutDistance,
    objectUrl, release, releaseAll, releaseExcept,
    FULL_EDGE, THUMB_EDGE
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Imaging;
