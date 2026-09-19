#!/usr/bin/env node
/* ==========================================================================
   Urban Showroom — engine tests
   Run: node tools/test_engine.js      (exits non-zero on any failure)

   Covers the parts that decide whether the product works: the EXIF reader,
   the geography, the matcher, the stage and pair logic, and the search
   ranker. Every assertion here is either a property that must hold or a
   defect that was actually found — not a hypothetical.

   The browser modules use top-level `const` and reference each other through
   the shared global lexical scope, exactly as a page's <script> tags do. So
   they are loaded into one VM context in dependency order rather than
   require()d, which would give each its own scope and break the references.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, Date, JSON, Map, Set, Array, Object, Number, String, isFinite, parseInt, parseFloat, DataView, ArrayBuffer, Uint8Array, Float32Array, TextEncoder });

// Dependency order matters: taxonomy defines the vocabulary the others read.
['taxonomy', 'geo', 'exif', 'imaging', 'store', 'intel', 'search'].forEach((m) => {
  vm.runInContext(fs.readFileSync(path.join(APP, 'assets', `${m}.js`), 'utf8'), ctx, { filename: `${m}.js` });
});
// Top-level `const` in a VM script is a lexical binding, not a property of
// the context object, so the pieces are handed out explicitly.
vm.runInContext(`globalThis.__api = {
  Taxonomy: { DIMENSIONS, labelFor, swatchFor, tradeSet, primaryTrade, TERM_INDEX,
              TRADES, TYPES, MATERIALS, PATTERNS, FINISHES, COLORS, FEATURES, IMPLIED_TRADE },
  Geo, EXIF, Imaging, Store, Intel, Search
};`, ctx);
const { Geo, EXIF, Imaging, Store, Intel, Search, Taxonomy } = ctx.__api;

/* ---- tiny harness ------------------------------------------------------- */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  FAIL  ${name}${detail ? '\n        ' + detail : ''}`);
}
function near(name, actual, expected, tol) {
  const good = Math.abs(actual - expected) <= tol;
  ok(name, good, good ? '' : `got ${actual}, wanted ${expected} ±${tol}`);
}
function section(t) { console.log(`\n=== ${t} ===`); }

/* ==========================================================================
   1. EXIF — built from a synthetic JPEG with known values
   ========================================================================== */
section('EXIF reader');

/* Lays out a minimal but structurally real JPEG: SOI, APP1 holding a TIFF
   header with IFD0 → ExifIFD (DateTimeOriginal) and GPS IFD (lat/lng), EOI.
   Offsets are computed rather than hard-coded so the intent is readable. */
function buildTestJpeg({ lat = [35, 2, 31.2], latRef = 'N', lng = [89, 39, 52.2], lngRef = 'W',
                         date = '2024:06:14 08:31:05', little = true } = {}) {
  const IFD0_AT = 8;
  const IFD0_SIZE = 2 + 2 * 12 + 4;          // 2 entries
  const EXIF_AT = IFD0_AT + IFD0_SIZE;       // 38
  const EXIF_SIZE = 2 + 1 * 12 + 4;          // 1 entry
  const GPS_AT = EXIF_AT + EXIF_SIZE;        // 56
  const GPS_SIZE = 2 + 4 * 12 + 4;           // 4 entries
  const DATA_AT = GPS_AT + GPS_SIZE;         // 110
  const DATE_AT = DATA_AT;                   // 20 bytes
  const LAT_AT = DATE_AT + 20;               // 24 bytes
  const LNG_AT = LAT_AT + 24;                // 24 bytes
  const TIFF_LEN = LNG_AT + 24;

  const tiff = new DataView(new ArrayBuffer(TIFF_LEN));
  const u8 = new Uint8Array(tiff.buffer);
  const w16 = (o, v) => tiff.setUint16(o, v, little);
  const w32 = (o, v) => tiff.setUint32(o, v, little);

  // TIFF header
  u8[0] = little ? 0x49 : 0x4d; u8[1] = little ? 0x49 : 0x4d;
  w16(2, 42); w32(4, IFD0_AT);

  const entry = (off, tag, type, count, valueOrOffset, inlineBytes) => {
    w16(off, tag); w16(off + 2, type); w32(off + 4, count);
    if (inlineBytes) inlineBytes.forEach((b, i) => { u8[off + 8 + i] = b; });
    else w32(off + 8, valueOrOffset);
  };

  // IFD0: pointers to the Exif and GPS sub-IFDs. Tags must ascend.
  w16(IFD0_AT, 2);
  entry(IFD0_AT + 2, 0x8769, 4, 1, EXIF_AT);
  entry(IFD0_AT + 14, 0x8825, 4, 1, GPS_AT);
  w32(IFD0_AT + 26, 0);

  // Exif sub-IFD: DateTimeOriginal
  w16(EXIF_AT, 1);
  entry(EXIF_AT + 2, 0x9003, 2, 20, DATE_AT);
  w32(EXIF_AT + 14, 0);

  // GPS sub-IFD
  w16(GPS_AT, 4);
  entry(GPS_AT + 2, 0x0001, 2, 2, 0, [latRef.charCodeAt(0), 0]);
  entry(GPS_AT + 14, 0x0002, 5, 3, LAT_AT);
  entry(GPS_AT + 26, 0x0003, 2, 2, 0, [lngRef.charCodeAt(0), 0]);
  entry(GPS_AT + 38, 0x0004, 5, 3, LNG_AT);
  w32(GPS_AT + 50, 0);

  // data area
  for (let i = 0; i < 19; i++) u8[DATE_AT + i] = date.charCodeAt(i);
  u8[DATE_AT + 19] = 0;
  const rational = (at, val) => {
    // Keep a tenth of a second of precision on the seconds field.
    const den = Number.isInteger(val) ? 1 : 10;
    w32(at, Math.round(val * den)); w32(at + 4, den);
  };
  lat.forEach((v, i) => rational(LAT_AT + i * 8, v));
  lng.forEach((v, i) => rational(LNG_AT + i * 8, v));

  // Wrap in a JPEG: SOI + APP1("Exif\0\0" + tiff) + EOI
  const app1Len = 2 + 6 + TIFF_LEN;
  const out = new Uint8Array(2 + 2 + app1Len + 2);
  let o = 0;
  out[o++] = 0xff; out[o++] = 0xd8;
  out[o++] = 0xff; out[o++] = 0xe1;
  out[o++] = (app1Len >> 8) & 0xff; out[o++] = app1Len & 0xff;
  'Exif'.split('').forEach((c) => { out[o++] = c.charCodeAt(0); });
  out[o++] = 0; out[o++] = 0;
  out.set(u8, o); o += TIFF_LEN;
  out[o++] = 0xff; out[o++] = 0xd9;
  return out.buffer;
}

{
  const r = EXIF.parse(buildTestJpeg());
  ok('finds EXIF in a JPEG', r.hasExif === true);
  near('latitude decoded', r.lat, 35.0420, 0.0002);
  near('longitude decoded', r.lng, -89.6645, 0.0002);
  ok('west longitude is negative', r.lng < 0, `got ${r.lng}`);
  ok('timestamp decoded', typeof r.takenAt === 'string' && r.takenAt.length > 0);

  // EXIF has no timezone, so it must be read as LOCAL time. Parsing as UTC
  // is the classic bug and shifts a photo by up to a day.
  const back = new Date(r.takenAt);
  ok('timestamp is local, not UTC', back.getHours() === 8 && back.getDate() === 14,
    `got ${back.getFullYear()}-${back.getMonth() + 1}-${back.getDate()} ${back.getHours()}h local`);
}

{
  const r = EXIF.parse(buildTestJpeg({ little: false }));
  near('big-endian (MM) files decode too', r.lat, 35.0420, 0.0002);
}

{
  const r = EXIF.parse(buildTestJpeg({ latRef: 'S', lngRef: 'E' }));
  ok('southern hemisphere is negative', r.lat < 0, `got ${r.lat}`);
  ok('eastern longitude is positive', r.lng > 0, `got ${r.lng}`);
}

{
  // A 0,0 fix means "no lock", not "the Gulf of Guinea".
  const r = EXIF.parse(buildTestJpeg({ lat: [0, 0, 0], lng: [0, 0, 0] }));
  ok('null island is treated as no fix', r.lat === null && r.lng === null);
}

{
  ok('garbage returns empty rather than throwing',
    EXIF.parse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer).hasExif === false);
  ok('empty buffer is safe', EXIF.parse(new ArrayBuffer(0)).hasExif === false);
  // Truncating mid-TIFF must not throw or read out of bounds.
  const full = new Uint8Array(buildTestJpeg());
  ok('truncated file is safe', EXIF.parse(full.slice(0, 60).buffer) !== null);
}

/* ==========================================================================
   2. Geography
   ========================================================================== */
section('Geography');

{
  // Memphis to Collierville is about 21–23 straight-line miles.
  const d = Geo.milesBetween({ lat: 35.1495, lng: -90.0490 }, { lat: 35.0420, lng: -89.6645 });
  near('known distance is right', d, 22.4, 1.5);
  ok('identical points are zero', Geo.milesBetween({ lat: 35, lng: -90 }, { lat: 35, lng: -90 }) < 0.0001);
  ok('missing coords return null', Geo.milesBetween(null, { lat: 1, lng: 1 }) === null);
  ok('NaN coords return null', Geo.milesBetween({ lat: NaN, lng: 1 }, { lat: 1, lng: 1 }) === null);
}

{
  /* The coarsened pin. The property that matters is NOT how far the pin
     moved — a house sitting near a cell centre barely moves and is no less
     protected. It is that the mapping throws information away: many houses
     produce one pin, and nothing recovers which. The previous offset-based
     blur satisfied the distance assertions below and was still invertible
     to zero feet, which is why those assertions are no longer the test. */
  const a = Geo.blur(35.0420, -89.6645);
  const b = Geo.blur(35.0420, -89.6645);
  ok('coarsening is deterministic', a.lat === b.lat && a.lng === b.lng);

  // ~200 ft apart, north-south. Same cell, therefore the same pin.
  const near = Geo.blur(35.0425, -89.6645);
  ok('two houses in one cell are indistinguishable', near.lat === a.lat && near.lng === a.lng,
    `${a.lat},${a.lng} vs ${near.lat},${near.lng}`);

  // Half a mile apart. Different cells, so the map still tells them apart.
  const far = Geo.blur(35.0520, -89.6645);
  ok('houses a block apart still land on different pins', far.lat !== a.lat || far.lng !== a.lng);

  ok('no id is consulted, so no id can undo it', Geo.blur.length === 2, `arity ${Geo.blur.length}`);

  // The pin is never further out than half a cell in each axis.
  const moved = Geo.milesBetween({ lat: 35.0420, lng: -89.6645 }, a);
  ok('the pin stays in the right neighbourhood', moved < 0.14, `moved ${(moved * 5280).toFixed(0)} ft`);

  // A sweep: every point inside one cell must produce that cell's pin.
  let collapsed = true;
  for (let i = 0; i < 40; i++) {
    const lat = 35.0372 + (i - 20) * 0.00004;    // +/- 290 ft around a cell centre
    if (Geo.blur(lat, -89.6821).lat !== Geo.blur(35.0372, -89.6821).lat) collapsed = false;
  }
  ok('a sweep across one cell collapses to a single pin', collapsed);
}

{
  /* The search index must not confirm what the display withheld. */
  const project = {
    id: 'oracle', name: 'A driveway', address: '1420 Poplar Ave, Collierville, TN',
    city: 'Collierville', state: 'TN', neighborhood: '', notes: '', tags: [],
    type: 'driveway', trade: ['concrete'], material: [], pattern: '', finish: [],
    color: [], feature: [], lat: 35.04, lng: -89.66, visibility: 'public',
    exactAddress: false, pairs: [], updated: '2024-01-01T00:00:00.000Z'
  };
  const pub = Search.haystack(project, [], false);
  const own = Search.haystack(project, [], true);
  ok('the house number is not in the public index', !pub.includes('1420'), pub);
  ok('the street still is', pub.includes('poplar'));
  ok('the contractor keeps the full address', own.includes('1420'));

  const parsed = Search.parse('1420', { places: new Map() });
  const out = Search.run([project], parsed, null, new Map(), { isOwner: false });
  ok('searching the house number finds nothing', !out.results.some((r) => r.hit),
    `${out.results.length} results, cut=${out.cut}`);
  const ownOut = Search.run([project], parsed, null, new Map(), { isOwner: true });
  ok('but the contractor can still find his own job by it', ownOut.results.some((r) => r.hit));
}

{
  /* Place centroids are the anchor every on-screen distance is measured
     from. Built from true coordinates they were solvable back to a real
     house; they must be built from the coarsened one. */
  const one = [{
    id: 'solo', name: 'x', city: '', neighborhood: 'Bray Station', state: 'TN',
    lat: 35.037136, lng: -89.682251, type: 'patio', trade: [], material: [],
    pattern: '', finish: [], color: [], feature: [], tags: [], notes: '',
    visibility: 'public', exactAddress: false, pairs: [], updated: '2024-01-01T00:00:00.000Z'
  }];
  const places = Search.buildPlaceIndex(one);
  const rec = places.get('bray station');
  const coarse = Geo.visibleCoord(one[0], false);
  ok('a one-project place centroid is the coarsened point, not the house',
    Math.abs(rec.lat - coarse.lat) < 1e-9 && Math.abs(rec.lng - coarse.lng) < 1e-9,
    `${rec.lat},${rec.lng}`);
  ok('and therefore is not the true coordinate', rec.lat !== one[0].lat);
}

{
  /* Addresses as a contractor actually types them off a work order. */
  [
    ['Unit B 512 Mud Island Rd, Memphis, TN', 'Mud Island Rd'],
    ['Apt 4 1234 Poplar Ave, Memphis, TN', 'Poplar Ave'],
    ['#12 1200 Peabody Ave, Memphis, TN', 'Peabody Ave'],
    ['Suite 200 8100 Players Club Dr', 'Players Club Dr'],
    ['1234B Poplar Ave, Collierville, TN', 'Poplar Ave'],
    ['1420 Poplar Ave #4, Eads', 'Poplar Ave'],
    ['1420 Poplar Ave Collierville TN 38017', 'Poplar Ave Collierville'],
    // An ordinal street name is not a house number.
    ['5th Ave', '5th Ave'],
    ['7th Street Cove', '7th Street Cove']
  ].forEach(([input, want]) => {
    ok(`streetOnly: ${input}`, Geo.streetOnly(input) === want, `got "${Geo.streetOnly(input)}"`);
  });
}

{
  ok('house number stripped', Geo.streetOnly('1234 Poplar Ave, Collierville TN') === 'Poplar Ave',
    `got "${Geo.streetOnly('1234 Poplar Ave, Collierville TN')}"`);
  ok('no number is left alone', Geo.streetOnly('Poplar Ave') === 'Poplar Ave');
  ok('empty address is safe', Geo.streetOnly('') === '' && Geo.streetOnly(null) === '');
}

{
  // The four levels, and who may see what.
  const P = (v) => ({ visibility: v });
  ok('owner sees private', Geo.canView(P('private'), 'owner') === true);
  ok('public does not see private', Geo.canView(P('private'), 'public') === false);
  ok('public does not see client-only', Geo.canView(P('client'), 'public') === false);
  ok('public sees public', Geo.canView(P('public'), 'public') === true);
  ok('client sees client', Geo.canView(P('client'), 'client') === true);
  ok('client sees public', Geo.canView(P('public'), 'client') === true);
  ok('client does not see team-only', Geo.canView(P('team'), 'client') === false);
  ok('team sees team', Geo.canView(P('team'), 'team') === true);
  ok('missing visibility is treated as private', Geo.canView({}, 'public') === false);
}

{
  // The privacy default the brief insists on.
  const proj = { id: 'x', lat: 35.04, lng: -89.66, address: '1234 Poplar Ave', visibility: 'public' };
  const seen = Geo.visibleCoord(proj, false);
  ok('a prospect never gets the exact pin', seen.exact === false);
  ok('the contractor does', Geo.visibleCoord(proj, true).exact === true);
  ok('prospect address hides the number', !Geo.visibleAddress(proj, false).includes('1234'),
    Geo.visibleAddress(proj, false));
  ok('contractor address keeps it', Geo.visibleAddress(proj, true).includes('1234'));
  proj.exactAddress = true;
  ok('exactAddress opt-in shows the number', Geo.visibleAddress(proj, false).includes('1234'));
}

/* ==========================================================================
   3. Hashing and distances
   ========================================================================== */
section('Hashing');

{
  ok('identical hashes are distance 0', Imaging.hamming('0123456789abcdef', '0123456789abcdef') === 0);
  ok('one flipped bit is distance 1', Imaging.hamming('0000000000000000', '0000000000000001') === 1);
  ok('inverted hash is distance 64', Imaging.hamming('0000000000000000', 'ffffffffffffffff') === 64);
  /* "Cannot compare" and "nothing like it" are different answers, and
     returning 64 for both hid a real bug: an uppercase digest scored 64
     against its own lowercase twin, so identical photographs read as
     maximally different and pairing silently stopped working. */
  ok('an uppercase hash still matches its lowercase twin',
    Imaging.hamming('0123456789abcdef', '0123456789ABCDEF') === 0);
  ok('mismatched lengths cannot be compared', Imaging.hamming('abc', 'abcd') === null);
  ok('a non-hex digit cannot be compared', Imaging.hamming('zzzzzzzzzzzzzzzz', '0123456789abcdef') === null);
  ok('non-strings are safe', Imaging.hamming(null, undefined) === null);

  /* And nothing downstream may read that null as zero — `null <= 12` is
     true in JavaScript, which would turn an unreadable hash into a
     perfect match. */
  const bad = { id: 'bad', hash: 'zzzz', layout: [1, 2, 3, 4], exif: { takenAt: '2024-01-01T10:00:00Z' } };
  const good = { id: 'good', hash: '0123456789abcdef', layout: [1, 2, 3, 4], exif: { takenAt: '2024-01-03T10:00:00Z' } };
  ok('an unreadable hash is not "the same view"', Intel.sameView(bad, good) === false);
  ok('an unreadable hash is not a duplicate', Intel.findDuplicates([bad, good]).length === 0);
  ok('an unreadable hash cannot be paired', Intel.pairScore(bad, good) === null);

  ok('identical layouts are distance 0', Imaging.layoutDistance([1, 2, 3], [1, 2, 3]) === 0);
  near('layout distance is a mean', Imaging.layoutDistance([0, 0, 0], [10, 20, 30]), 20, 0.001);
  ok('bad layouts are unrelated', Imaging.layoutDistance(null, [1]) === 255);
}

/* ==========================================================================
   4. Matching a photo to a project
   ========================================================================== */
section('Photo → project matching');

const ADDR = { lat: 35.0420, lng: -89.6645 };
const projects = [
  {
    id: 'near-and-now', name: 'Collierville patio', lat: ADDR.lat, lng: ADDR.lng,
    type: 'patio', trade: ['concrete'],
    startedAt: '2024-06-01T12:00:00.000Z', completedAt: '2024-06-20T12:00:00.000Z'
  },
  {
    id: 'near-wrong-time', name: 'Same street, years earlier', lat: ADDR.lat + 0.0004, lng: ADDR.lng,
    type: 'driveway', trade: ['concrete'],
    startedAt: '2018-03-01T12:00:00.000Z', completedAt: '2018-03-20T12:00:00.000Z'
  },
  {
    id: 'far-right-time', name: 'Across the metro, same week', lat: 35.3415, lng: -89.8973,
    type: 'pool-deck', trade: ['pools'],
    startedAt: '2024-06-05T12:00:00.000Z', completedAt: '2024-06-18T12:00:00.000Z'
  }
];

{
  const photo = { id: 'ph1', exif: { lat: ADDR.lat + 0.0002, lng: ADDR.lng, takenAt: '2024-06-14T13:31:05.000Z' } };
  const s = Intel.suggestProjects(photo, projects);
  ok('a photo at the address during the job ranks first', s[0] && s[0].projectId === 'near-and-now',
    s[0] ? s[0].projectId : 'nothing');
  ok('and is called very likely', s[0] && Intel.confidenceLabel(s[0].score) === 'very likely',
    s[0] ? `${Intel.confidenceLabel(s[0].score)} @ ${s[0].score.toFixed(2)}` : '');
  ok('the same address at the wrong time ranks below it',
    s.findIndex((x) => x.projectId === 'near-wrong-time') > 0 || !s.some((x) => x.projectId === 'near-wrong-time'));
  ok('it explains itself', s[0] && s[0].reasons.length > 0, JSON.stringify(s[0] && s[0].reasons));
}

{
  // Location alone is strong but must not reach certainty: two jobs can share
  // one driveway across six years.
  const photo = { id: 'ph2', exif: { lat: ADDR.lat, lng: ADDR.lng, takenAt: null } };
  const s = Intel.suggestProjects(photo, projects);
  ok('location alone still suggests', s.length > 0);
  ok('location alone is capped below certainty', s[0].score <= 0.76, `scored ${s[0].score.toFixed(2)}`);
}

{
  // Date alone is weak: a contractor runs several jobs a week.
  const photo = { id: 'ph3', exif: { lat: null, lng: null, takenAt: '2024-06-14T13:31:05.000Z' } };
  const s = Intel.suggestProjects(photo, projects);
  ok('date alone is capped lower still', !s.length || s[0].score <= 0.46, s.length ? `scored ${s[0].score.toFixed(2)}` : 'none');
}

{
  const photo = { id: 'ph4', exif: { lat: null, lng: null, takenAt: null } };
  ok('a photo with no metadata suggests nothing', Intel.suggestProjects(photo, projects).length === 0);
}

{
  near('distance score is full at the address', Intel.distanceScore(0.01), 1, 0.001);
  near('distance score is zero far away', Intel.distanceScore(2), 0, 0.001);
  ok('distance score decays in between', Intel.distanceScore(0.2) > 0 && Intel.distanceScore(0.2) < 1);
  ok('missing distance is null not zero', Intel.distanceScore(null) === null);
}

/* ==========================================================================
   5. Stages and before/after pairing
   ========================================================================== */
section('Stages and pairs');

const day = (d, h = 12) => new Date(2024, 5, d, h, 0, 0).toISOString();

{
  // One visit: everything is "after", weakly.
  const photos = [
    { id: 'a', exif: { takenAt: day(20, 9) } },
    { id: 'b', exif: { takenAt: day(20, 10) } }
  ];
  const st = Intel.inferStages(photos);
  ok('a single-day shoot is all after', st.get('a').stage === 'after' && st.get('b').stage === 'after');
  ok('and says so with low confidence', st.get('a').confidence < 0.6);
}

{
  // Three visits across three weeks: the real shape of a job.
  const photos = [
    { id: 'b1', exif: { takenAt: day(1, 9) } },
    { id: 'd1', exif: { takenAt: day(9, 11) } },
    { id: 'd2', exif: { takenAt: day(9, 15) } },
    { id: 'a1', exif: { takenAt: day(21, 16) } }
  ];
  const st = Intel.inferStages(photos);
  ok('earliest day is before', st.get('b1').stage === 'before', st.get('b1').stage);
  ok('middle days are during', st.get('d1').stage === 'during' && st.get('d2').stage === 'during');
  ok('latest day is after', st.get('a1').stage === 'after', st.get('a1').stage);
}

{
  ok('undated photos get no stage', Intel.inferStages([{ id: 'x', exif: {} }]).size === 0);
  ok('an empty set is safe', Intel.inferStages([]).size === 0);
  ok('null is safe', Intel.inferStages(null).size === 0);
}

{
  // The band that separates a transformation from a duplicate.
  ok('identical structure scores zero (that is a duplicate)', Intel.structureBandScore(1) === 0);
  ok('mid-band structure scores one', Intel.structureBandScore(18) === 1);
  ok('unrelated structure scores zero', Intel.structureBandScore(55) === 0);
  ok('the band ramps rather than steps', Intel.structureBandScore(6) > 0 && Intel.structureBandScore(6) < 1);
}

{
  /* A believable pair: same framing (close layout), different surface
     (mid-band structure), three weeks apart. */
  const layoutA = Array.from({ length: 48 }, (_, i) => (i * 5) % 200);
  const layoutB = layoutA.map((v, i) => (i % 3 === 0 ? v + 22 : v + 4));   // shifted, not random
  const photos = [
    { id: 'before1', width: 4032, height: 3024, hash: '0f1e2d3c4b5a6978', layout: layoutA, exif: { takenAt: day(1, 9) } },
    { id: 'after1', width: 4032, height: 3024, hash: '0f1e2d3c4b5a1234', layout: layoutB, exif: { takenAt: day(21, 16) } }
  ];
  const pairs = Intel.proposePairs(photos, { threshold: 0.4 });
  ok('a plausible before/after is proposed', pairs.length === 1, `got ${pairs.length}`);
  if (pairs.length) {
    ok('with the right orientation', pairs[0].beforeId === 'before1' && pairs[0].afterId === 'after1');
    ok('and a human-readable reason', typeof pairs[0].reason === 'string' && pairs[0].reason.length > 0, pairs[0].reason);
  }
}

{
  // Two shots seconds apart are a duplicate, never a transformation.
  const layout = Array.from({ length: 48 }, (_, i) => i * 4);
  const photos = [
    { id: 'p1', hash: 'aaaaaaaaaaaaaaaa', layout, exif: { takenAt: day(10, 12) } },
    { id: 'p2', hash: 'aaaaaaaaaaaaaaaa', layout, exif: { takenAt: day(10, 12) } }
  ];
  ok('same-moment shots never pair', Intel.proposePairs(photos).length === 0);
}

{
  // Without dates there is no way to tell a transformation from two angles.
  const layout = Array.from({ length: 48 }, (_, i) => i * 4);
  const photos = [
    { id: 'p1', hash: '0f1e2d3c4b5a6978', layout, exif: {} },
    { id: 'p2', hash: '0f1e2d3c4b5a1234', layout, exif: {} }
  ];
  ok('undated photos never pair', Intel.proposePairs(photos).length === 0);
}

{
  // Each photo may appear in at most one pair.
  const layoutA = Array.from({ length: 48 }, (_, i) => (i * 5) % 200);
  const photos = [
    { id: 'b1', width: 4, height: 3, hash: '0f1e2d3c4b5a6978', layout: layoutA, exif: { takenAt: day(1, 9) } },
    { id: 'a1', width: 4, height: 3, hash: '0f1e2d3c4b5a1234', layout: layoutA.map((v) => v + 6), exif: { takenAt: day(21, 9) } },
    { id: 'a2', width: 4, height: 3, hash: '0f1e2d3c4b5a5678', layout: layoutA.map((v) => v + 8), exif: { takenAt: day(21, 10) } }
  ];
  const pairs = Intel.proposePairs(photos, { threshold: 0.4 });
  const used = pairs.flatMap((p) => [p.beforeId, p.afterId]);
  ok('no photo is used twice', new Set(used).size === used.length, JSON.stringify(used));
}

/* ==========================================================================
   6. Captions, tags and filenames
   ========================================================================== */
section('Captions and tags');

{
  const t = Intel.tokensFromFilename('wilson_patio_stamped_AFTER.jpg');
  ok('filename stage is read', t.stage === 'after', t.stage);
  ok('filename facets are read', t.facets.type && t.facets.type.has('patio'));
  ok('noise words are dropped', !t.words.includes('img'));

  const t2 = Intel.tokensFromFilename('IMG_4821.HEIC');
  ok('a meaningless filename yields nothing', !t2.stage && Object.keys(t2.facets).length === 0);
}

{
  const project = {
    type: 'driveway', pattern: 'ashlar-slate', color: ['charcoal', 'slate-grey'],
    finish: ['color-hardener'], city: 'Collierville', neighborhood: ''
  };
  const photo = { id: 'p', stage: 'after', exif: { takenAt: '2024-06-14T13:31:05.000Z' } };
  const cap = Intel.HeuristicVision.caption(photo, project);
  ok('caption names the stage', /after/i.test(cap), cap);
  ok('caption names the work', /driveway/i.test(cap), cap);
  ok('caption names the place and date', /Collierville/.test(cap) && /2024/.test(cap), cap);
  ok('caption is a sentence', cap.endsWith('.') && cap[0] === cap[0].toUpperCase(), cap);

  const tags = Intel.HeuristicVision.tags(photo, project, { filename: 'wilson driveway.jpg' });
  ok('tags include the project type', tags.some((t) => t.dim === 'type' && t.id === 'driveway'));
  ok('tags include the colours', tags.some((t) => t.dim === 'color' && t.id === 'charcoal'));
  ok('tags carry their source', tags.every((t) => typeof t.source === 'string'));
  const keys = tags.map((t) => t.dim + ':' + t.id);
  ok('tags are deduplicated', new Set(keys).size === keys.length);
}

{
  const near = Intel.nearestPaletteColor([46, 44, 43]);
  ok('a near-black maps to Black Granite', near && near.id === 'black-granite', near && near.id);
  const sand = Intel.nearestPaletteColor([200, 172, 130]);
  ok('a tan maps to Sandstone', sand && sand.id === 'sandstone', sand && sand.id);
  ok('bad input is safe', Intel.nearestPaletteColor(null) === null);
}

/* ==========================================================================
   7. Search — the queries the product is pitched on
   ========================================================================== */
section('Search');

const seed = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'seed.json'), 'utf8'));
const SEED_PROJECTS = seed.projects;
const photosBy = new Map();
seed.photos.forEach((ph) => {
  if (!photosBy.has(ph.projectId)) photosBy.set(ph.projectId, []);
  photosBy.get(ph.projectId).push(ph);
});
const PLACES = Search.buildPlaceIndex(SEED_PROJECTS);
const HERE = { lat: 35.0420, lng: -89.6645 };   // standing in Collierville

function q(query, expect = {}) {
  const parsed = Search.parse(query, { places: PLACES });
  const out = Search.run(SEED_PROJECTS, parsed, expect.here === null ? null : HERE, photosBy);
  const top = out.results.slice(0, 3).map((r) => r.project.id);
  const facets = Object.fromEntries(Object.entries(parsed.facets).map(([k, v]) => [k, [...v]]));

  let good = true;
  const notes = [];
  if (expect.facets) {
    for (const [dim, ids] of Object.entries(expect.facets)) {
      for (const id of ids) {
        if (!(facets[dim] || []).includes(id)) { good = false; notes.push(`missing facet ${dim}=${id}`); }
      }
    }
  }
  if (expect.topIs && top[0] !== expect.topIs) { good = false; notes.push(`top was ${top[0]}, wanted ${expect.topIs}`); }
  if (expect.within) {
    const w = out.results.slice(0, expect.within.n).map((r) => r.project.id);
    expect.within.ids.forEach((id) => { if (!w.includes(id)) { good = false; notes.push(`${id} not in top ${expect.within.n}`); } });
  }
  if (expect.minResults && out.results.length < expect.minResults) { good = false; notes.push(`only ${out.results.length} results`); }
  if (expect.maxResults && out.results.length > expect.maxResults) { good = false; notes.push(`${out.results.length} results, wanted at most ${expect.maxResults}`); }
  if (expect.notCut && out.cut) { good = false; notes.push('fell back to closest-matches'); }
  if (expect.nearMe !== undefined && parsed.nearMe !== expect.nearMe) { good = false; notes.push(`nearMe was ${parsed.nearMe}`); }
  if (expect.wantPairs !== undefined && parsed.wantPairs !== expect.wantPairs) { good = false; notes.push(`wantPairs was ${parsed.wantPairs}`); }
  if (expect.place && (!parsed.nearPlace || parsed.nearPlace.name !== expect.place)) {
    good = false; notes.push(`place was ${parsed.nearPlace ? parsed.nearPlace.name : 'none'}`);
  }
  if (expect.years) {
    expect.years.forEach((y) => { if (!parsed.years.includes(y)) { good = false; notes.push(`year ${y} not parsed`); } });
  }
  if (expect.allTop) {
    out.results.slice(0, 3).forEach((r) => {
      if (!expect.allTop(r.project)) { good = false; notes.push(`${r.project.id} should not be top-3`); }
    });
  }

  ok(`"${query}"`, good, notes.join('; ') + (notes.length ? `\n        top: ${top.join(', ')}` : ''));
  return out;
}

// The two the product was pitched on.
q('stamped & colored driveway', {
  facets: { type: ['driveway'] }, minResults: 4, notCut: true,
  allTop: (p) => p.type === 'driveway' && Taxonomy.tradeSet(p).includes('decorative-concrete')
});
q('patio with black granite colored', {
  facets: { type: ['patio'], color: ['black-granite'] },
  topIs: 'seed-compass-patio-collierville', notCut: true
});

// The way people actually talk.
q('stamped concrete driveway near me', { nearMe: true, facets: { type: ['driveway'] } });
q('pool deck washed aggregate', { facets: { type: ['pool-deck'], finish: ['washed'] }, minResults: 3 });
q('do you have any stamped patios', { facets: { type: ['patio'] } });
q('exposed aggregate drive', { facets: { type: ['driveway'], finish: ['exposed-aggregate'] }, topIs: 'seed-exposed-drive-germantown' });
q('outdoor kitchen with a fireplace', { facets: { type: ['outdoor-kitchen'] }, topIs: 'seed-kitchen-fireplace-collierville' });
q('black bar top', { facets: { color: ['black-granite'], type: ['countertop'] }, topIs: 'seed-bartop-waterfall-memphis' });
q('retaining wall', { facets: { type: ['retaining-wall'] }, topIs: 'seed-retaining-brighton' });
q('somethin like a cobblestone driveway', { facets: { pattern: ['colonial-cobble'] }, topIs: 'seed-cobble-drive-germantown' });
q('grey pool deck no grout lines', { facets: { pattern: ['seamless-slate'] }, topIs: 'seed-seamless-deck-collierville' });

// New axes the brief asked for.
section('Search — the brief’s new axes');
q('brick', { facets: { material: ['brick'] }, minResults: 1 });
q('stacked stone outdoor kitchen', { facets: { material: ['stacked-stone'] }, topIs: 'seed-kitchen-fireplace-collierville' });
q('masonry', { facets: { trade: ['masonry'] }, minResults: 2 });
q('projects near Germantown', { place: 'Germantown', minResults: 3, allTop: (p) => p.city === 'Germantown' });
q('patios in Collierville', { place: 'Collierville', facets: { type: ['patio'] } });
q('driveways from 2024', { years: [2024], facets: { type: ['driveway'] }, allTop: (p) => Search.projectYears(p).includes(2024) });
q('before and after', { wantPairs: true, maxResults: 0 });   // honest: the sample book has none

// Edge cases.
section('Search — edges');
q('', { minResults: 30 });
q('zzzzqqq nonsense', {});
q('driveway', { facets: { type: ['driveway'] }, minResults: 6 });

{
  /* "Seamless slate patio": he has no such thing. Patios first is correct,
     but the one seamless-slate job he owns must not be buried — in v1 it sat
     at rank six, which on a real book of hundreds is page three.

     What matters to the customer is the pair of properties below, not which
     mechanism delivered them. An earlier version of this test asserted that
     ranking alone lifted it, which was true only because the comparator was
     intransitive and the sort happened to land that way. */
  const out = q('seamless slate patio', { facets: { pattern: ['seamless-slate'] }, minResults: 4 });
  const ids = out.results.slice(0, 2).map((r) => r.project.id);
  const rare = out.results.find((r) => r.project.id === 'seed-seamless-deck-collierville');
  ok('the rare match reaches the top two', ids.includes('seed-seamless-deck-collierville'), ids.join(', '));
  ok('and, being a pool deck rather than the patio asked for, says so',
    rare && typeof rare.spotlight === 'string' && /seamless slate/i.test(rare.spotlight),
    rare ? String(rare.spotlight) : 'no entry');
}

{
  /* The promotion path, on a corpus built to need it: five near patios that
     all match the common noun, and the single rare-pattern job sitting
     thirty miles away so distance cannot lift it. Without promotion it lands
     sixth; with it, second and labelled. */
  const mk = (id, type, pattern, lat, lng) => ({
    id, name: id, type, pattern, trade: ['concrete'], material: [], finish: [],
    color: [], feature: [], tags: [], lat, lng, city: 'X', state: 'TN',
    visibility: 'public', pairs: [], updated: '2024-01-01T00:00:00.000Z'
  });
  const corpus = [
    mk('patio-1', 'patio', '', 35.042, -89.664),
    mk('patio-2', 'patio', '', 35.043, -89.665),
    mk('patio-3', 'patio', '', 35.044, -89.666),
    mk('patio-4', 'patio', '', 35.045, -89.667),
    mk('patio-5', 'patio', '', 35.046, -89.668),
    mk('rare-deck', 'pool-deck', 'seamless-slate', 35.5645, -89.6461)   // ~36 mi north
  ];
  const parsed = Search.parse('seamless slate patio', { places: new Map() });
  const out = Search.run(corpus, parsed, HERE, new Map());
  const ids = out.results.map((r) => r.project.id);
  ok('promotion lifts the buried rare match to second', ids[1] === 'rare-deck', ids.join(', '));
  const promoted = out.results.find((r) => r.project.id === 'rare-deck');
  ok('and labels it as not an exact match', promoted && typeof promoted.spotlight === 'string',
    promoted ? String(promoted.spotlight) : 'no entry');
  ok('the label names what actually matched', promoted && /seamless slate/i.test(promoted.spotlight),
    promoted ? promoted.spotlight : '');
  ok('nothing relevant was demoted out of the list', ids.length === 6);
}

{
  /* A sixty-photo drop covering several jobs. Stage is a statement about
     ONE job's timeline, and inferring it across the whole batch labelled
     the middle two thirds "during" — including finished shots — and left
     almost nothing marked "after", so no pairs were ever proposed. */
  const day = 24 * 3600 * 1000;
  const base = Date.parse('2024-05-01T15:00:00Z');
  const jobs = [];
  const photos = [];
  for (let j = 0; j < 4; j++) {
    const start = base + j * 30 * day;          // each job a month apart
    jobs.push({
      id: `job${j}`, name: `Job ${j}`, lat: 35.0 + j * 0.2, lng: -89.7,
      city: 'X', state: 'TN', neighborhood: '', type: 'patio', trade: ['concrete'],
      material: [], pattern: '', finish: [], color: [], feature: [], tags: [], notes: '',
      startedAt: new Date(start).toISOString(),
      completedAt: new Date(start + 10 * day).toISOString(),
      visibility: 'public', exactAddress: false, pairs: [],
      updated: '2024-01-01T00:00:00.000Z'
    });
    [0, 5, 10].forEach((offset, k) => {
      photos.push({
        id: `j${j}p${k}`, filename: `job${j}-${k}.jpg`,
        hash: '0123456789abcdef', layout: [10, 20, 30, 40],
        width: 4032, height: 3024,
        exif: { lat: 35.0 + j * 0.2, lng: -89.7, takenAt: new Date(start + offset * day).toISOString() },
        takenAt: new Date(start + offset * day).toISOString()
      });
    });
  }

  const analysed = Intel.analyseImport(photos, jobs);
  const stageById = new Map(analysed.map((a) => [a.photo.id, a.stage]));
  let right = 0;
  const wantStage = ['before', 'during', 'after'];
  for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 3; k++) if (stageById.get(`j${j}p${k}`) === wantStage[k]) right += 1;
  }
  ok('every photo is filed to its own job',
    analysed.every((a, i) => a.bestProjectId === `job${Math.floor(i / 3)}`),
    analysed.map((a) => a.bestProjectId).join(','));
  ok('stages are inferred inside each job, not across the batch', right === 12, `${right}/12 correct`);
  ok('the last shot of each job is the finished one',
    [0, 1, 2, 3].every((j) => stageById.get(`j${j}p2`) === 'after'));
  ok('no genuine after is mislabelled "during"',
    ![0, 1, 2, 3].some((j) => stageById.get(`j${j}p2`) === 'during'));
}

{
  /* Stage words in a filename. "final" used to be stripped as noise, and
     the multi-word terms were unreachable because only single words were
     tested against STAGES. */
  const st = (name) => Intel.HeuristicVision.stage({ id: 'x' }, [], { filename: name }).stage;
  ok('"final" in a filename means finished', st('driveway final.jpg') === 'after');
  ok('"demo" is a stage, not a repair feature', st('driveway demo.jpg') === 'before');
  ok('"tear out" is reachable as a phrase', st('patio tear out.jpg') === 'before');
  ok('"in progress" is reachable as a phrase', st('patio in progress.jpg') === 'during');
  ok('an ordinary filename still has no stage', st('ashlar driveway.jpg') === null);
}

{
  /* A match must show the evidence against it, not only the evidence for. */
  const far = {
    id: 'far', exif: { lat: 35.60, lng: -89.70, takenAt: '2024-05-05T15:00:00Z' }
  };
  const job = {
    id: 'j', name: 'j', lat: 35.04, lng: -89.66, type: 'patio', trade: [],
    startedAt: '2024-05-01T00:00:00Z', completedAt: '2024-05-10T00:00:00Z'
  };
  const [hit] = Intel.suggestProjects(far, [job], { floor: 0 });
  ok('a photo taken thirty miles away says so', hit && hit.reasons.some((r) => /from the address/.test(r)),
    hit ? hit.reasons.join('; ') : 'no suggestion');
  ok('and the dates still count in its favour', hit && hit.reasons.some((r) => /during this job/.test(r)));

  const noPin = { id: 'np', exif: { lat: 35.04, lng: -89.66, takenAt: '2024-05-05T15:00:00Z' } };
  const unpinned = { ...job, lat: null, lng: null };
  const [h2] = Intel.suggestProjects(noPin, [unpinned], { floor: 0 });
  ok('a job with no pin is named as the thing missing a location',
    h2 && h2.reasons.some((r) => /this job has no pin/.test(r)),
    h2 ? h2.reasons.join('; ') : 'no suggestion');
}

{
  /* The headline query the whole product is pitched on. "stamped" and
     "colored" are not values in the taxonomy, they are families: every way
     of stamping a slab, every way of colouring one. They have to parse, and
     four driveways with a colour hardener in them have to beat a coloured
     patio, because the customer said driveway. */
  const out = q('stamped & colored driveway', {
    facets: { type: ['driveway'], trade: ['decorative-concrete'] },
    topIs: 'seed-ashlar-drive-collierville'
  });
  const top4 = out.results.slice(0, 4);
  ok('a bare "colored" expands to the colour finishes',
    ['integral-color', 'color-hardener'].every((id) =>
      Search.parse('colored', { places: PLACES }).facets.finish.has(id)));
  ok('a bare "stamped" reaches the decorative trade',
    Search.parse('stamped', { places: PLACES }).facets.trade.has('decorative-concrete'));
  ok('everything above the fold is actually a driveway',
    top4.every((r) => r.project.type === 'driveway'),
    top4.map((r) => `${r.project.id}[${r.project.type}]`).join(', '));
  ok('an expanded family never triggers a promotion',
    !out.results.some((r) => r.spotlight),
    (out.results.find((r) => r.spotlight) || {}).spotlight || '');
}

{
  /* An expanded id is marked broad; one the customer typed out is not. */
  const loose = Search.parse('colored patio', { places: PLACES });
  ok('expanded ids are marked as a family', loose.broad.finish && loose.broad.finish.has('integral-color'));
  const tight = Search.parse('integral color patio', { places: PLACES });
  ok('a named value is not', !(tight.broad.finish && tight.broad.finish.has('integral-color')));
}

{
  /* The result comparator must be a real ordering. The previous one asked
     "are these two within six points of each other?" pairwise, which is not
     transitive: A ties B, B ties C, and A beats C. Array.prototype.sort is
     entitled to return anything at all for a comparator like that, and the
     same result set came back in different orders on different renders. */
  const parsed = Search.parse('driveway', { places: PLACES });
  const out = Search.run(SEED_PROJECTS, parsed, HERE, photosBy);
  const order = out.results.map((r) => r.project.id);

  const shuffled = SEED_PROJECTS.slice().reverse();
  const again = Search.run(shuffled, Search.parse('driveway', { places: PLACES }), HERE, photosBy);
  ok('the same query gives the same order whatever order the book is in',
    again.results.map((r) => r.project.id).join(',') === order.join(','));

  // And the order it gives is consistent with the comparator's own verdict.
  const rank = new Map(order.map((id, i) => [id, i]));
  let consistent = true;
  for (let i = 0; i < out.results.length; i++) {
    for (let j = i + 1; j < out.results.length; j++) {
      const a = out.results[i];
      const b = out.results[j];
      if (Math.round(b.score / 6) > Math.round(a.score / 6)) consistent = false;
    }
  }
  ok('no result outranks a strictly better-scoring tier above it', consistent);
  ok('every result appears exactly once', new Set(order).size === order.length);
  void rank;
}

{
  // Distance decides between equally relevant results.
  const parsed = Search.parse('driveway', { places: PLACES });
  const out = Search.run(SEED_PROJECTS, parsed, HERE, photosBy);
  const withMiles = out.results.filter((r) => r.miles != null).slice(0, 3);
  const sortedByDistance = withMiles.every((r, i, a) => i === 0 || a[i - 1].miles <= r.miles + 0.001);
  ok('equally good matches are ordered by distance', sortedByDistance,
    withMiles.map((r) => `${r.project.city} ${r.miles.toFixed(1)}mi`).join(' | '));
}

/* ==========================================================================
   8. Migration from v1
   ========================================================================== */
section('v1 → v2 migration');

{
  const v1 = {
    id: 'job-1', title: 'Old stamped driveway', service: ['stamped-concrete'], surface: 'driveway',
    pattern: 'ashlar-slate', color: ['charcoal'], finish: ['color-hardener'], feature: ['border'],
    description: 'A note the contractor wrote', address: '1234 Poplar Ave', city: 'Collierville',
    state: 'TN', neighborhood: 'Bray Station', year: 2023, lat: 35.04, lng: -89.66,
    privacy: true, demo: false,
    photos: [{ src: 'data:image/webp;base64,AAAA' }, { src: 'img/x.webp' }],
    someFutureField: 'must survive'
  };
  const { project, photos } = Store.migrateJob(v1);

  ok('title becomes name', project.name === 'Old stamped driveway');
  ok('notes survive', project.notes === 'A note the contractor wrote');
  ok('surface becomes type', project.type === 'driveway');
  ok('service becomes trades', project.trade.includes('decorative-concrete') && project.trade.includes('concrete'),
    JSON.stringify(project.trade));
  ok('year becomes a completion date', String(project.completedAt).startsWith('2023-'));
  ok('privacy:true keeps the address protected', project.exactAddress === false);
  ok('the project stays visible in the showroom', project.visibility === 'public');
  ok('unknown fields are carried, not dropped', project.someFutureField === 'must survive');
  ok('v1 field names are cleaned up', project.title === undefined && project.surface === undefined && project.privacy === undefined);
  ok('photos become their own records', photos.length === 2);
  ok('photos point back at the project', photos.every((p) => p.projectId === 'job-1'));
  ok('photo order is preserved', photos[0].order === 0 && photos[1].order === 1);
  ok('a cover is chosen', project.coverPhotoId === photos[0].id);
  ok('inline photo arrays are removed from the project', project.photos === undefined);

  const noPhotos = Store.migrateJob({ id: 'j2', title: 'Bare', privacy: false });
  ok('a job with no photos migrates', noPhotos.photos.length === 0 && noPhotos.project.coverPhotoId === null);
  /* v1's `privacy` flag meant "hide this pin". v2's `exactAddress` means
     "publish this house number". Carrying one across as the other pushed
     real street addresses into the public showroom the moment a
     contractor upgraded, for a field he had never been asked about. The
     migration now always lands on the safe side and he opts in per job. */
  ok('no v1 flag can opt a job into publishing its address', noPhotos.project.exactAddress === false);
  const wasPrivate = Store.migrateJob({ id: 'j3', title: 'P', privacy: true });
  ok('and the same is true the other way round', wasPrivate.project.exactAddress === false);
}

/* ==========================================================================
   9. Taxonomy integrity — cheap checks that catch copy-paste damage
   ========================================================================== */
section('Taxonomy integrity');

{
  const seenIds = new Map();
  let dupes = 0, emptyTerms = 0, badCase = 0;
  Taxonomy.DIMENSIONS.forEach(({ key, list }) => {
    const ids = new Set();
    list.forEach((item) => {
      if (ids.has(item.id)) { dupes++; }
      ids.add(item.id);
      seenIds.set(key + ':' + item.id, true);
      if (!item.terms || !item.terms.length) emptyTerms++;
      (item.terms || []).forEach((t) => { if (t !== t.toLowerCase()) badCase++; });
    });
  });
  ok('no duplicate ids within a dimension', dupes === 0, `${dupes} duplicates`);
  ok('every entry has search terms', emptyTerms === 0, `${emptyTerms} without terms`);
  ok('every term is lowercase', badCase === 0, `${badCase} with uppercase`);

  // Every colour needs a swatch the UI can paint.
  const noSwatch = Taxonomy.COLORS.filter((c) => !/^#[0-9a-f]{6}$/i.test(c.swatch || ''));
  ok('every colour has a valid swatch', noSwatch.length === 0, noSwatch.map((c) => c.id).join(', '));

  // Every value the seed uses must exist in the taxonomy, or search silently
  // cannot find it.
  const bad = [];
  SEED_PROJECTS.forEach((p) => {
    const check = (dim, v) => { if (v && !seenIds.has(dim + ':' + v)) bad.push(`${p.id}: ${dim}=${v}`); };
    check('type', p.type);
    (p.trade || []).forEach((v) => check('trade', v));
    (p.material || []).forEach((v) => check('material', v));
    check('pattern', p.pattern);
    (p.finish || []).forEach((v) => check('finish', v));
    (p.color || []).forEach((v) => check('color', v));
    (p.feature || []).forEach((v) => check('feature', v));
  });
  ok('the seed only uses values the taxonomy knows', bad.length === 0, bad.slice(0, 6).join('; '));
}

{
  // Implied trades must resolve to real trades, or tradeSet() emits ghosts.
  const tradeIds = new Set(Taxonomy.TRADES.map((t) => t.id));
  const ghosts = [];
  Object.values(Taxonomy.IMPLIED_TRADE).forEach((table) => {
    Object.values(table).forEach((v) => { if (!tradeIds.has(v)) ghosts.push(v); });
  });
  ok('every implied trade exists', ghosts.length === 0, [...new Set(ghosts)].join(', '));
}

/* ==========================================================================
   done
   ========================================================================== */
console.log(`\n${'='.repeat(60)}`);
console.log(fail ? `${fail} FAILING, ${pass} passing` : `All ${pass} checks passed.`);
if (fail) { console.log(''); failures.forEach((f) => console.log('  · ' + f)); }
console.log('');
process.exit(fail ? 1 : 0);
