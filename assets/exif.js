/* ==========================================================================
   Urban Showroom — EXIF reader
   Built by Dive In Digital Marketing

   Kevin's brief calls photo intelligence "a core product capability, not an
   accessory", and the first thing it asks for is the part that needs no model
   at all: "use available geolocation metadata, timestamps, project address,
   and date ranges to identify likely project photographs."

   That is exactly what this file does. A phone writes where and when it took
   a picture into the file itself. Read it and you can tell the contractor
   "these eleven photos were taken at that address in June" without asking him
   anything.

   TWO THINGS THAT WILL BITE ANYONE EDITING THIS

   1. Read EXIF from the ORIGINAL File, before any canvas work. Drawing an
      image to a canvas and re-encoding it throws every tag away. The pipeline
      in imaging.js depends on this order and says so.

   2. EXIF timestamps carry no timezone. "2024:06:14 08:31:05" means 8:31 in
      the morning wherever the photographer was standing. Parsing it as UTC
      shifts a photo by up to a day and quietly breaks date matching, so it is
      parsed as local time unless the file also carries an offset tag.

   Input here is a file off a stranger's phone, so every read is bounds
   checked and the whole parse is wrapped: a corrupt header returns null
   rather than throwing into the upload loop.
   ========================================================================== */
'use strict';

const EXIF = (() => {
  /* TIFF field types → byte width. 0 marks a type we do not decode. */
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  const TAG = {
    MAKE: 0x010f,
    MODEL: 0x0110,
    ORIENTATION: 0x0112,
    DATETIME: 0x0132,
    EXIF_IFD: 0x8769,
    GPS_IFD: 0x8825,
    DATETIME_ORIGINAL: 0x9003,
    DATETIME_DIGITIZED: 0x9004,
    OFFSET_TIME_ORIGINAL: 0x9011,
    PIXEL_X: 0xa002,
    PIXEL_Y: 0xa003
  };

  const GPS = {
    LAT_REF: 0x0001, LAT: 0x0002,
    LNG_REF: 0x0003, LNG: 0x0004,
    ALT_REF: 0x0005, ALT: 0x0006,
    TIMESTAMP: 0x0007, DATESTAMP: 0x001d
  };

  /* ---- little binary reader, bounds checked ---------------------------- */
  function reader(view, little) {
    const len = view.byteLength;
    return {
      u8:  (o) => (o + 1 <= len ? view.getUint8(o) : 0),
      u16: (o) => (o + 2 <= len ? view.getUint16(o, little) : 0),
      u32: (o) => (o + 4 <= len ? view.getUint32(o, little) : 0),
      i32: (o) => (o + 4 <= len ? view.getInt32(o, little) : 0),
      ok:  (o, n) => o >= 0 && o + n <= len
    };
  }

  /* Decode one IFD entry's value. Values of 4 bytes or fewer live inline in
     the entry; anything longer is an offset from the TIFF header. */
  function readValue(view, little, entryOffset, tiffStart) {
    const r = reader(view, little);
    const type = r.u16(entryOffset + 2);
    const count = r.u32(entryOffset + 4);
    const size = TYPE_SIZE[type];
    if (!size || count <= 0 || count > 0x10000) return null;

    const total = size * count;
    const valueOffset = total <= 4 ? entryOffset + 8 : tiffStart + r.u32(entryOffset + 8);
    if (!r.ok(valueOffset, Math.min(total, 4))) return null;

    switch (type) {
      case 2: { // ASCII
        let s = '';
        for (let i = 0; i < count; i++) {
          if (!r.ok(valueOffset + i, 1)) break;
          const c = r.u8(valueOffset + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      case 1:
      case 6:
      case 7: {
        if (count === 1) return r.u8(valueOffset);
        const out = [];
        for (let i = 0; i < count; i++) out.push(r.u8(valueOffset + i));
        return out;
      }
      case 3:
      case 8: {
        if (count === 1) return r.u16(valueOffset);
        const out = [];
        for (let i = 0; i < count; i++) out.push(r.u16(valueOffset + i * 2));
        return out;
      }
      case 4:
      case 9: {
        if (count === 1) return r.u32(valueOffset);
        const out = [];
        for (let i = 0; i < count; i++) out.push(r.u32(valueOffset + i * 4));
        return out;
      }
      case 5:
      case 10: { // RATIONAL / SRATIONAL — numerator/denominator pairs
        /* A zero denominator is a corrupt component, not a zero. Reading
           it as 0 turned 35 deg 2' 31.2" into 35.0333 — six tenths of a
           mile out, which is past `distanceScore`'s 0.4 mi cutoff, so the
           photo silently stopped matching the job it was taken on. NaN
           propagates instead and the caller drops the whole tag. */
        const one = (o) => {
          const n = type === 10 ? r.i32(o) : r.u32(o);
          const d = type === 10 ? r.i32(o + 4) : r.u32(o + 4);
          return d === 0 ? NaN : n / d;
        };
        if (count === 1) return one(valueOffset);
        const out = [];
        for (let i = 0; i < count; i++) out.push(one(valueOffset + i * 8));
        return out;
      }
      default:
        return null;
    }
  }

  /* Walk one IFD, returning {tag: value}. `seen` guards against a malformed
     file whose IFD pointers form a loop. */
  function readIFD(view, little, ifdOffset, tiffStart, seen) {
    const out = {};
    const r = reader(view, little);
    if (!r.ok(ifdOffset, 2)) return out;
    if (seen.has(ifdOffset)) return out;
    seen.add(ifdOffset);

    const count = r.u16(ifdOffset);
    if (count > 512) return out;            // no sane IFD is this big
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (!r.ok(entry, 12)) break;
      const tag = r.u16(entry);
      const v = readValue(view, little, entry, tiffStart);
      if (v !== null) out[tag] = v;
    }
    return out;
  }

  /* ---- GPS --------------------------------------------------------------
     EXIF stores latitude as three rationals (degrees, minutes, seconds) plus
     a hemisphere letter held separately. Forgetting the ref is the classic
     bug: it puts Memphis in Kazakhstan.                                     */
  function dmsToDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 2) return null;
    const [d = 0, m = 0, s = 0] = dms;
    let dec = Math.abs(d) + m / 60 + s / 3600;
    if (!isFinite(dec)) return null;
    const r = String(ref || '').trim().toUpperCase();
    if (r === 'S' || r === 'W') dec = -dec;
    return dec;
  }

  /* ---- timestamps -------------------------------------------------------
     "YYYY:MM:DD HH:MM:SS", local to the camera. Parsed with the local-time
     Date constructor on purpose; see the header note.                       */
  function parseExifDate(s, offsetStr) {
    if (typeof s !== 'string') return null;
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const [, Y, Mo, D, H, Mi, S] = m.map(Number);
    if (Y < 1970 || Y > 2200 || Mo < 1 || Mo > 12 || D < 1 || D > 31) return null;
    /* The clock was never checked, so "99:99:99" rolled forward four days
       and "2024:02:31" became March — either of which moves a photo out of
       the 45-day window its project is matched on. */
    if (H > 23 || Mi > 59 || S > 60) return null;

    // If the file carries an explicit UTC offset ("+05:30"), honour it.
    const off = typeof offsetStr === 'string' && offsetStr.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (off) {
      const sign = off[1] === '-' ? -1 : 1;
      const mins = sign * (Number(off[2]) * 60 + Number(off[3]));
      return new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S) - mins * 60000);
    }
    const d = new Date(Y, Mo - 1, D, H, Mi, S);
    if (isNaN(d.getTime())) return null;
    // Reject a day that does not exist in that month rather than let the
    // Date constructor roll it into the next one.
    if (d.getMonth() !== Mo - 1 || d.getDate() !== D) return null;
    return d;
  }

  /* ---- container sniffing ----------------------------------------------
     Returns the byte offset of the TIFF header inside the file, or -1.      */
  function findTiffStart(view) {
    const r = reader(view, false);
    if (view.byteLength < 12) return -1;

    // JPEG: FFD8, then a chain of markers. APP1 holds "Exif\0\0" + TIFF.
    if (r.u16(0) === 0xffd8) {
      let o = 2;
      const len = view.byteLength;
      while (o + 4 <= len) {
        if (r.u8(o) !== 0xff) { o += 1; continue; }   // resync on padding
        /* Fill bytes are legal (ITU T.81 B.1.1.2) and common in re-muxed
           files: a marker may be preceded by any number of 0xFF. Treating
           0xFF as the marker itself read the next two bytes as a segment
           length, which was garbage, and every scrap of photo intelligence
           for that file silently vanished. */
        let marker = r.u8(o + 1);
        if (marker === 0xff) { o += 1; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
        if (marker === 0xda || marker === 0xd9) return -1;  // start of scan; no EXIF
        const segLen = r.u16(o + 2);
        if (segLen < 2) return -1;
        if (marker === 0xe1 && r.ok(o + 4, 6)) {
          let tag = '';
          for (let i = 0; i < 4; i++) tag += String.fromCharCode(r.u8(o + 4 + i));
          if (tag === 'Exif') return o + 10;           // skip "Exif\0\0"
        }
        o += 2 + segLen;
      }
      return -1;
    }

    // WebP: RIFF container with an optional "EXIF" chunk.
    if (r.u32(0) === 0x52494646 /* RIFF */ && r.u32(8) === 0x57454250 /* WEBP */) {
      let o = 12;
      const len = view.byteLength;
      while (o + 8 <= len) {
        let fourcc = '';
        for (let i = 0; i < 4; i++) fourcc += String.fromCharCode(r.u8(o + i));
        const size = view.getUint32(o + 4, true);      // RIFF sizes are LE
        if (size < 0 || o + 8 + size > len) return -1;
        if (fourcc === 'EXIF') {
          // Some writers prefix the payload with "Exif\0\0", some do not.
          let head = '';
          for (let i = 0; i < 4; i++) head += String.fromCharCode(r.u8(o + 8 + i));
          return head === 'Exif' ? o + 14 : o + 8;
        }
        o += 8 + size + (size % 2);                    // chunks are padded even
      }
      return -1;
    }

    // PNG and HEIC are not handled: PNG rarely carries EXIF, and HEIC needs a
    // full ISO-BMFF walk that is not worth the bytes. Both fall through to
    // "no metadata", and the UI asks the contractor to place them by hand.
    return -1;
  }

  /* ---- public -----------------------------------------------------------
     Reads an ArrayBuffer and returns a plain object. Never throws.          */
  function parse(buffer) {
    const empty = { lat: null, lng: null, takenAt: null, orientation: 1, make: '', model: '', width: null, height: null, hasExif: false };
    try {
      const view = new DataView(buffer);
      const tiffStart = findTiffStart(view);
      if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return empty;

      const byteOrder = view.getUint16(tiffStart, false);
      if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return empty;
      const little = byteOrder === 0x4949;
      const r = reader(view, little);
      if (r.u16(tiffStart + 2) !== 42) return empty;

      const seen = new Set();
      const ifd0 = readIFD(view, little, tiffStart + r.u32(tiffStart + 4), tiffStart, seen);

      let exif = {};
      if (ifd0[TAG.EXIF_IFD]) {
        exif = readIFD(view, little, tiffStart + ifd0[TAG.EXIF_IFD], tiffStart, seen);
      }
      let gps = {};
      if (ifd0[TAG.GPS_IFD]) {
        gps = readIFD(view, little, tiffStart + ifd0[TAG.GPS_IFD], tiffStart, seen);
      }

      const lat = dmsToDecimal(gps[GPS.LAT], gps[GPS.LAT_REF]);
      const lng = dmsToDecimal(gps[GPS.LNG], gps[GPS.LNG_REF]);
      const validCoord = lat !== null && lng !== null &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
        !(Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9);   // 0,0 means "no fix"

      const takenAt =
        parseExifDate(exif[TAG.DATETIME_ORIGINAL], exif[TAG.OFFSET_TIME_ORIGINAL]) ||
        parseExifDate(exif[TAG.DATETIME_DIGITIZED], exif[TAG.OFFSET_TIME_ORIGINAL]) ||
        parseExifDate(ifd0[TAG.DATETIME]) ||
        null;

      const orientation = Number(ifd0[TAG.ORIENTATION]) || 1;

      return {
        lat: validCoord ? lat : null,
        lng: validCoord ? lng : null,
        takenAt: takenAt ? takenAt.toISOString() : null,
        orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
        make: typeof ifd0[TAG.MAKE] === 'string' ? ifd0[TAG.MAKE] : '',
        model: typeof ifd0[TAG.MODEL] === 'string' ? ifd0[TAG.MODEL] : '',
        width: Number(exif[TAG.PIXEL_X]) || null,
        height: Number(exif[TAG.PIXEL_Y]) || null,
        hasExif: true
      };
    } catch (e) {
      return empty;
    }
  }

  /* Convenience: read only the leading bytes of a File. EXIF lives in the
     first APP1 segment, so slicing keeps a 12MB photo off the main thread's
     memory just to read a date. 256KB is generous; some phones write a large
     thumbnail into APP1 ahead of the tags we want. */
  async function fromFile(file, sliceBytes = 262144) {
    try {
      const head = file.slice(0, Math.min(sliceBytes, file.size));
      const buf = await head.arrayBuffer();
      const out = parse(buf);
      /* The old guard was `out.hasExif`, which only means a TIFF header was
         found. A header at the end of the slice with its tags past the cut
         returned an empty result and the full-file re-read never happened.
         Ask whether we actually got anything worth having. */
      const useful = out.takenAt !== null || out.lat !== null || !!out.make;
      if (useful || file.size <= sliceBytes) return out;
      // The tags sat past the slice. Pay for the whole file once.
      return parse(await file.arrayBuffer());
    } catch (e) {
      return parse(new ArrayBuffer(0));
    }
  }

  /* The last-resort date when a file carries no EXIF: the filesystem's own
     modified time, which phones and cloud exports usually preserve. Marked
     `dateSource` by the caller so the UI can be honest that it is weaker. */
  function fallbackDate(file) {
    const t = Number(file && file.lastModified);
    if (!t || !isFinite(t)) return null;
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  return { parse, fromFile, fallbackDate, parseExifDate, dmsToDecimal };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EXIF;
