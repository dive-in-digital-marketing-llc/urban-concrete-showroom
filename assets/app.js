/* ==========================================================================
   Urban Concrete Showroom — application
   Baltz & Sons Concrete · built by Dive In Digital Marketing

   Depends on vocab.js (loaded first) and Leaflet.

   THE SHAPE OF THIS FILE
     1. utilities        — distance, formatting, DOM, escaping
     2. store            — IndexedDB with a localStorage fallback
     3. search           — query parser + ranker (the product, really)
     4. map              — Leaflet, pins, clustering
     5. render           — result cards, detail view
     6. owner            — PIN gate, add/edit job, geocoding, photos
     7. boot

   TWO RULES THIS CODE KEEPS
     · Nothing this app shows a customer was invented by the app. Distances are
       computed from real coordinates; a job with no coordinate says so rather
       than guessing one.
     · Job sites are people's houses. The privacy switch on every job is not
       decoration — when it is on, the customer-facing view gets the street and
       the town and a pin offset to the block, never the house number.
   ========================================================================== */
'use strict';

/* ==========================================================================
   1. utilities
   ========================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const uid = () => 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* Great-circle distance in miles. The app is a single metro, so a spherical
   earth is well inside the error a pin already carries. */
function milesBetween(a, b) {
  if (!a || !b) return null;
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const fmtMiles = (mi) => {
  if (mi === null || mi === undefined || !isFinite(mi)) return null;
  if (mi < 0.1) return 'right here';
  if (mi < 1) return `${(mi * 5280 / 3).toFixed(0)} yd`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
};

/* Drive time is deliberately NOT computed. We have straight-line distance and
   no routing engine; calling 4.2 straight-line miles "9 minutes" would be a
   number we did not measure. The UI says "away", not "minutes". */

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ==========================================================================
   2. store — IndexedDB, with localStorage as the fallback
   Photos are data URLs and get big, so IndexedDB is the real home. The
   fallback keeps the app usable in a locked-down browser; it just holds less.
   ========================================================================== */
const Store = (() => {
  const DB = 'ucs-baltz';
  const VER = 1;
  const JOBS = 'jobs';
  const META = 'meta';
  let db = null;
  let usingFallback = false;

  function open() {
    return new Promise((resolve) => {
      if (db) return resolve(db);
      if (!('indexedDB' in window)) { usingFallback = true; return resolve(null); }
      let req;
      try { req = indexedDB.open(DB, VER); } catch (e) { usingFallback = true; return resolve(null); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(JOBS)) d.createObjectStore(JOBS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'k' });
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => { usingFallback = true; resolve(null); };
      // Private-mode Safari can hang here rather than error.
      setTimeout(() => { if (!db) { usingFallback = true; resolve(null); } }, 2500);
    });
  }

  const lsGet = (k, d) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch (e) { return d; }
  };
  const lsSet = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('Storage is full — export a backup and remove some photos.'); return false; }
  };

  async function allJobs() {
    await open();
    if (!db) return lsGet('ucs-jobs', []);
    return new Promise((res) => {
      const tx = db.transaction(JOBS, 'readonly').objectStore(JOBS).getAll();
      tx.onsuccess = () => res(tx.result || []);
      tx.onerror = () => res([]);
    });
  }

  async function putJob(job) {
    await open();
    if (!db) {
      const all = lsGet('ucs-jobs', []).filter((j) => j.id !== job.id);
      all.push(job);
      return lsSet('ucs-jobs', all);
    }
    return new Promise((res) => {
      const tx = db.transaction(JOBS, 'readwrite');
      tx.objectStore(JOBS).put(job);
      tx.oncomplete = () => res(true);
      tx.onerror = () => { toast('Could not save — storage may be full.'); res(false); };
    });
  }

  async function delJob(id) {
    await open();
    if (!db) return lsSet('ucs-jobs', lsGet('ucs-jobs', []).filter((j) => j.id !== id));
    return new Promise((res) => {
      const tx = db.transaction(JOBS, 'readwrite');
      tx.objectStore(JOBS).delete(id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  }

  async function clearJobs() {
    await open();
    if (!db) return lsSet('ucs-jobs', []);
    return new Promise((res) => {
      const tx = db.transaction(JOBS, 'readwrite');
      tx.objectStore(JOBS).clear();
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  }

  async function meta(k, v) {
    await open();
    if (!db) {
      if (v === undefined) return lsGet('ucs-meta-' + k, null);
      return lsSet('ucs-meta-' + k, v);
    }
    if (v === undefined) {
      return new Promise((res) => {
        const tx = db.transaction(META, 'readonly').objectStore(META).get(k);
        tx.onsuccess = () => res(tx.result ? tx.result.v : null);
        tx.onerror = () => res(null);
      });
    }
    return new Promise((res) => {
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put({ k, v });
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  }

  return { allJobs, putJob, delJob, clearJobs, meta, get fallback() { return usingFallback; } };
})();

/* A job sits on more than one service line, and the search has to know it.
   A stamped cobblestone driveway is filed under Stamped Concrete on the
   website AND it is a driveway, so "cobblestone driveway" has to reach it
   without the word "driveway" counting against it. `service` is therefore an
   array, primary first, and these are the lines implied by what the job is
   rather than typed by hand. Getting this wrong is not a ranking nicety: with
   a single service, a search for "cobblestone driveway" put two driveways that
   were not cobble above the one that was. */
const IMPLIED_SERVICE = {
  surface: {
    driveway: 'concrete-driveways',
    patio: 'concrete-patios',
    'pool-deck': 'pool-decks',
    walkway: 'concrete-paving',
    steps: 'concrete-paving',
    porch: 'concrete-paving',
    countertop: 'concrete-countertops',
    'outdoor-kitchen': 'outdoor-living',
    firepit: 'outdoor-living',
    wall: 'masonry',
    'parking-lot': 'commercial-concrete'
  },
  finish: {
    // "Stained & Colored Concrete" is one service line on the website, so any
    // deliberate colour puts the job on it — which is what makes a search for
    // "colored driveway" find a stamped drive with a hardener in it.
    'acid-stain': 'stained-concrete',
    'water-stain': 'stained-concrete',
    'integral-color': 'stained-concrete',
    'color-hardener': 'stained-concrete',
    polished: 'polished-concrete-floors',
    'epoxy-flake': 'epoxy-flake-floors'
  }
};

function serviceSet(job) {
  const out = [];
  const push = (id) => { if (id && !out.includes(id)) out.push(id); };
  (Array.isArray(job.service) ? job.service : [job.service]).forEach(push);
  push(IMPLIED_SERVICE.surface[job.surface]);
  (job.finish || []).forEach((f) => push(IMPLIED_SERVICE.finish[f]));
  return out;
}

/* The one the pin glyph and the card eyebrow use. */
function primaryService(job) {
  return Array.isArray(job.service) ? job.service[0] : job.service;
}

/* ==========================================================================
   3. search — the parser and the ranker
   ========================================================================== */
const Search = (() => {
  /* Normalise the way a person types into the way the index is keyed.
     "Stamped & Colored Driveway!" -> "stamped and colored driveway" */
  function normalise(q) {
    return String(q || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Walk the query longest-phrase-first. The greedy pass is what makes
     "black granite" one colour instead of the word "black" plus the word
     "granite", and it is why PATTERNS lists "colonial cobble" before the
     bare "cobble" ever matters. */
  function parse(raw) {
    let q = normalise(raw);

    // Proximity words are an instruction, not a filter — pull them out first.
    let nearMe = false;
    PROXIMITY_WORDS.forEach((p) => {
      if (q.includes(p)) { nearMe = true; q = q.replace(new RegExp(p, 'g'), ' '); }
    });
    q = q.replace(/\s+/g, ' ').trim();

    const words = q ? q.split(' ') : [];
    const facets = {};   // dim -> Set(id)
    const free = [];
    const matchedPhrases = [];

    let i = 0;
    while (i < words.length) {
      let hit = null;
      let len = 0;
      const maxSpan = Math.min(TERM_INDEX.maxWords, words.length - i);
      for (let n = maxSpan; n >= 1; n--) {
        const phrase = words.slice(i, i + n).join(' ');
        const found = TERM_INDEX.idx.get(phrase);
        if (found) { hit = found; len = n; break; }
      }
      if (hit) {
        hit.forEach(({ dim, id }) => {
          if (!facets[dim]) facets[dim] = new Set();
          facets[dim].add(id);
        });
        matchedPhrases.push(words.slice(i, i + len).join(' '));
        i += len;
      } else {
        const w = words[i];
        if (!STOPWORDS.has(w) && w.length > 1) free.push(w);
        i += 1;
      }
    }

    return { raw: String(raw || ''), facets, free, nearMe, matchedPhrases, isEmpty: !Object.keys(facets).length && !free.length };
  }

  /* How rare is each facet value across the jobs actually loaded?

     Without this, every hit is worth the same and the common noun swamps the
     specific one: a search for "seamless slate patio" scored three ordinary
     patios above the single seamless-slate job in the book, because "patio"
     hit twice (service + surface) and "seamless slate" only once. Rarity is
     the standard fix — a facet almost no job has is a much stronger statement
     of intent than one half the book shares. Recomputed whenever the job list
     changes, which is cheap at this size and correct as he adds work. */
  let RARITY = new Map();
  let rarityFor = () => 1;

  function indexRarity(jobs) {
    const N = Math.max(jobs.length, 1);
    const df = new Map();
    jobs.forEach((job) => {
      DIMENSIONS.forEach((d) => {
        const raw = d.key === 'service' ? serviceSet(job) : job[d.key];
        const vals = new Set(Array.isArray(raw) ? raw : raw ? [raw] : []);
        vals.forEach((v) => {
          const k = `${d.key}:${v}`;
          df.set(k, (df.get(k) || 0) + 1);
        });
      });
    });
    RARITY = df;
    const lnN = Math.log(N) || 1;
    rarityFor = (dim, id) => {
      const seen = RARITY.get(`${dim}:${id}`) || 0;
      // 1.0 for a facet every job has, up to ~2.1 for one only a single job has.
      return 1 + 1.4 * (Math.log(N / (seen + 1)) / lnN);
    };
  }

  /* Score one job against one parsed query.

     The shape of the scoring matters more than the exact numbers:
       · a facet the query asked for and the job has  -> full dimension weight
       · a facet the query asked for and the job lacks -> a penalty, not a
         rejection, so "stamped driveway" still surfaces the stamped patio
         underneath the stamped driveways rather than showing nothing
       · every asked-for dimension satisfied -> a completeness bonus, which is
         what puts an exact "patio + black granite" match on top
       · free words fall back to the text of the job                        */
  function score(job, parsed) {
    if (parsed.isEmpty) return { score: 1, matchedDims: [], missedDims: [] };

    let s = 0;
    const matchedDims = [];
    const missedDims = [];
    let asked = 0;
    let satisfied = 0;

    for (const dim of DIMENSIONS) {
      const want = parsed.facets[dim.key];
      if (!want || !want.size) continue;
      asked += 1;

      const haveRaw = dim.key === 'service' ? serviceSet(job) : job[dim.key];
      const have = new Set(Array.isArray(haveRaw) ? haveRaw : haveRaw ? [haveRaw] : []);
      const overlap = [...want].filter((id) => have.has(id));

      if (overlap.length) {
        satisfied += 1;
        // Diminishing return on multiple hits in one dimension: asking for two
        // colours and getting both is better than one, but not twice as good.
        // Each hit is scaled by how rare that value is in the book.
        const rare = Math.max(...overlap.map((id) => rarityFor(dim.key, id)));
        s += dim.weight * rare * (1 + (overlap.length - 1) * 0.35);
        matchedDims.push({ dim: dim.key, ids: overlap });
      } else {
        /* A miss is a demotion, not a veto. It was 0.55 and that was too harsh:
           it buried a seamless-slate POOL DECK below a plain broom patio when
           somebody asked for a "seamless slate patio", which is the closest
           thing he owns and exactly what he would want to show. */
        s -= dim.weight * 0.35;
        missedDims.push({ dim: dim.key, ids: [...want] });
      }
    }

    if (asked > 0 && satisfied === asked) s += 9;          // exact description
    if (asked > 1 && satisfied === asked) s += asked * 3;  // multi-facet exact

    // Free words against the job's own words.
    if (parsed.free.length) {
      const hay = [
        job.title, job.description, job.city, job.state, job.neighborhood, job.year
      ].filter(Boolean).join(' ').toLowerCase();
      parsed.free.forEach((w) => {
        if (hay.includes(w)) s += 3.5;
        else if (w.length >= 4 && hay.includes(w.slice(0, Math.max(4, w.length - 2)))) s += 1.2;
      });
    }

    return { score: s, matchedDims, missedDims };
  }

  /* Rank everything, then decide what is worth showing. */
  function run(jobs, parsed, here) {
    indexRarity(jobs);
    const scored = jobs.map((job) => {
      const r = score(job, parsed);
      r.hit = r.matchedDims.length > 0;
      const mi = here && job.lat != null ? milesBetween(here, { lat: job.lat, lng: job.lng }) : null;
      return { job, ...r, miles: mi };
    });

    if (parsed.isEmpty) {
      // No query: distance first when we know where we are, newest otherwise.
      scored.sort((a, b) => {
        if (a.miles != null && b.miles != null) return a.miles - b.miles;
        if (a.miles != null) return -1;
        if (b.miles != null) return 1;
        return (b.job.year || 0) - (a.job.year || 0);
      });
      return { results: scored, cut: false };
    }

    /* Keep anything that satisfied at least one dimension the person actually
       asked for, or hit on their own words. Filtering on a positive total
       instead threw away partial matches that were the best answer available —
       ask for a "seamless slate patio" he has never built and the seamless
       slate deck he HAS built should still be on the screen, just lower.
       If a strict read returns nothing, fall back to the best few so the list
       is never blank in front of a customer; the header then says "closest". */
    let keep = scored.filter((r) => r.hit || (parsed.free.length && r.score > 0));
    let cut = false;
    if (!keep.length) {
      keep = scored.filter((r) => r.score > -Infinity).sort((a, b) => b.score - a.score).slice(0, 6);
      cut = true;
    }

    const sortFn = (a, b) => {
      // Within a band of comparable relevance, nearer wins. That is the whole
      // "show me the closest one like this" behaviour.
      const band = 6;
      if (Math.abs(b.score - a.score) > band) return b.score - a.score;
      if (a.miles != null && b.miles != null) return a.miles - b.miles;
      if (b.score !== a.score) return b.score - a.score;
      return (b.job.year || 0) - (a.job.year || 0);
    };
    keep.sort(sortFn);

    /* "Closest thing I've got."

       Ask for a "seamless slate patio" when the only seamless slate in the book
       is a pool deck, and plain ranking is right to put the patios first — that
       is what was asked for. But the specific job then sits at rank six, and in
       a real book of hundreds it would sit on page three, which is the same as
       not existing. So: if the person named a RARE facet and nothing near the
       top satisfies it, pull up the best job that does and label it for what it
       is. Promoting beats reranking here — nothing relevant gets demoted, and
       the customer is told plainly that it is not an exact match. */
    const RARE = 1.7;
    const head = new Set(keep.slice(0, 3).map((r) => r.job.id));
    let spotlight = null;
    for (const dim of ['pattern', 'color', 'feature', 'finish']) {
      const want = parsed.facets[dim];
      if (!want || !want.size) continue;
      const rareIds = [...want].filter((id) => rarityFor(dim, id) >= RARE);
      if (!rareIds.length) continue;
      const satisfiedUpTop = keep.slice(0, 3).some((r) =>
        r.matchedDims.some((m) => m.dim === dim && m.ids.some((id) => rareIds.includes(id))));
      if (satisfiedUpTop) continue;
      const best = keep.find((r) => !head.has(r.job.id) &&
        r.matchedDims.some((m) => m.dim === dim && m.ids.some((id) => rareIds.includes(id))));
      if (best) {
        spotlight = { entry: best, dim, ids: rareIds.filter((id) =>
          best.matchedDims.some((m) => m.dim === dim && m.ids.includes(id))) };
        break;
      }
    }
    if (spotlight) {
      const i = keep.indexOf(spotlight.entry);
      if (i > 1) {
        keep.splice(i, 1);
        keep.splice(1, 0, spotlight.entry);
        spotlight.entry.spotlight = `Closest ${spotlight.ids.map((id) => labelFor(spotlight.dim, id)).join(' + ')} we have built`;
      }
    }

    return { results: keep, cut };
  }

  return { parse, run, normalise };
})();

/* ==========================================================================
   4. app state
   ========================================================================== */
const State = {
  jobs: [],
  results: [],
  parsed: Search.parse(''),
  cut: false,
  here: null,          // {lat,lng} from geolocation
  watchId: null,
  activeId: null,
  ownerMode: false,
  editing: null,
  sheetOpen: false,
  map: null,
  layer: null,
  meMarker: null,
  markers: new Map(),
  pendingPhotos: [],
  pendingLoc: null,
  locMap: null,
  locMarker: null
};

/* ==========================================================================
   5. map
   ========================================================================== */
const SERVICE_GLYPH = {
  'stamped-concrete': '<path d="M3 3h18v18H3z"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  'stained-concrete': '<path d="M12 2s6 6.6 6 11a6 6 0 1 1-12 0c0-4.4 6-11 6-11z"/>',
  'concrete-patios': '<path d="M3 7h18v12H3z"/><path d="M3 12h18"/><path d="M8 7V4h8v3"/>',
  'concrete-driveways': '<path d="M8 21L10 3h4l2 18"/><path d="M12 7v3M12 13v3"/>',
  'pool-decks': '<path d="M3 17c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M7 9V5a2 2 0 0 1 4 0M13 9V5a2 2 0 0 1 4 0"/>',
  'outdoor-living': '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  'concrete-paving': '<path d="M4 20l4-16M16 4l4 16"/><path d="M7 9h10M6 14h12"/>',
  masonry: '<path d="M3 5h18v5H3zM3 14h18v5H3z"/><path d="M9 5v5M15 14v5"/>',
  'epoxy-flake-floors': '<path d="M3 4h18v16H3z"/><circle cx="8" cy="9" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="11" cy="14" r="1"/><circle cx="17" cy="15" r="1"/><circle cx="6" cy="16" r="1"/>',
  'polished-concrete-floors': '<path d="M3 5h18v14H3z"/><path d="M6 16l5-8M12 16l5-8"/>',
  'commercial-concrete': '<path d="M4 21V6l8-3 8 3v15"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01"/>',
  'concrete-countertops': '<path d="M2 9h20v3H2z"/><path d="M5 12v8M19 12v8"/>'
};

function pinSVG(job, cls) {
  const glyph = SERVICE_GLYPH[primaryService(job)] || SERVICE_GLYPH['concrete-patios'];
  return `<div class="pin ${cls}">
    <div class="ring"></div>
    <svg viewBox="0 0 38 46" aria-hidden="true">
      <path class="body" d="M19 0C8.5 0 0 8.4 0 18.7 0 32.3 19 46 19 46s19-13.7 19-27.3C38 8.4 29.5 0 19 0z" fill="#C4873F"/>
      <path d="M19 2.4C9.8 2.4 2.4 9.7 2.4 18.7c0 5.2 3.4 11 7.4 15.6a71 71 0 0 0 9.2 9 71 71 0 0 0 9.2-9c4-4.6 7.4-10.4 7.4-15.6 0-9-7.4-16.3-16.6-16.3z" fill="none" stroke="rgba(18,16,14,.30)" stroke-width="1.4"/>
    </svg>
    <span class="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"
      stroke-linecap="round" stroke-linejoin="round">${glyph}</svg></span>
  </div>`;
}

function initMap() {
  /* No Leaflet means no map. It does not mean no app: the list, the search,
     the photos and the distances all work without one, and a contractor who
     can still answer "here are my four stamped drives, the closest is 1.1
     miles away" has lost a nicety, not the product. */
  if (typeof L === 'undefined') {
    document.body.classList.add('no-map');
    return null;
  }
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false,
    tap: true
  }).setView([35.18, -89.78], 10);

  /* CARTO dark matter — the only widely-available free basemap that is already
     a warm-neutral dark. A light basemap under this palette looks like a bug. */
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(map);

  map.zoomControl.setPosition('bottomright');
  State.layer = L.layerGroup().addTo(map);
  State.map = map;
  return map;
}

/* Shown in place of the map when Leaflet could not load. */
function mapFallbackNotice() {
  const host = $('#map');
  host.innerHTML = '';
  host.appendChild(el('div', {
    style: 'position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:28px;color:#9E958A'
  }, [
    el('div', {}, [
      el('p', { style: 'font-family:var(--font-display);font-size:1.25rem;color:#EFE9E1;margin:0 0 8px', text: 'Map unavailable offline' }),
      el('p', { style: 'font-size:.86rem;margin:0;max-width:30ch', text: 'Search, photos and distances all still work. The map comes back when you have signal.' })
    ])
  ]));
}

/* Grid clustering. Cheap, deterministic, and enough for a metro's worth of
   pins — a real clustering plugin would be another 40KB for no visible gain. */
function clusterFor(items, map) {
  const z = map.getZoom();
  if (z >= 12 || items.length <= 12) return items.map((r) => ({ single: r }));
  const cell = z >= 10 ? 46 : 62;
  const buckets = new Map();
  items.forEach((r) => {
    const p = map.latLngToContainerPoint([r.job.lat, r.job.lng]);
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  });
  return [...buckets.values()].map((group) => (group.length === 1 ? { single: group[0] } : { group }));
}

function drawPins() {
  if (!State.map) return;
  State.layer.clearLayers();
  State.markers.clear();

  const withCoords = State.results.filter((r) => r.job.lat != null && r.job.lng != null);
  const nearestId = State.results.find((r) => r.miles != null)?.job.id || null;

  clusterFor(withCoords, State.map).forEach((entry) => {
    if (entry.group) {
      const g = entry.group;
      const lat = g.reduce((s, r) => s + r.job.lat, 0) / g.length;
      const lng = g.reduce((s, r) => s + r.job.lng, 0) / g.length;
      const m = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'pin-hit',
          html: `<div class="cluster ${g.length > 9 ? 'lg' : ''}">${g.length}</div>`,
          iconSize: [44, 44], iconAnchor: [22, 22]
        }),
        keyboard: false
      });
      m.on('click', () => State.map.flyTo([lat, lng], Math.min(State.map.getZoom() + 2.4, 16), { duration: .6 }));
      m.addTo(State.layer);
      return;
    }

    const r = entry.single;
    const cls = [
      State.parsed.isEmpty ? '' : 'is-match',
      r.job.id === State.activeId ? 'is-active' : '',
      r.job.id === nearestId && !State.parsed.isEmpty ? 'is-nearest' : ''
    ].filter(Boolean).join(' ');

    const m = L.marker([r.job.lat, r.job.lng], {
      icon: L.divIcon({ className: 'pin-hit', html: pinSVG(r.job, cls), iconSize: [38, 46], iconAnchor: [19, 46] }),
      title: r.job.title,
      riseOnHover: true
    });
    m.on('click', () => openDetail(r.job.id));
    m.addTo(State.layer);
    State.markers.set(r.job.id, m);
  });

  if (State.here) {
    if (State.meMarker) State.layer.removeLayer(State.meMarker);
    State.meMarker = L.marker([State.here.lat, State.here.lng], {
      icon: L.divIcon({ className: '', html: '<div class="mepin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      interactive: false, zIndexOffset: -500
    }).addTo(State.layer);
  }
}

function fitToResults(animate = true) {
  if (!State.map) return;
  const pts = State.results.filter((r) => r.job.lat != null).slice(0, 24)
    .map((r) => [r.job.lat, r.job.lng]);
  if (State.here) pts.push([State.here.lat, State.here.lng]);
  if (!pts.length) return;
  if (pts.length === 1) {
    State.map.flyTo(pts[0], 14, { duration: animate ? .7 : 0 });
    return;
  }
  const pad = window.innerWidth >= 860 ? [70, 440] : [60, 60];
  State.map.flyToBounds(L.latLngBounds(pts), {
    paddingTopLeft: [pad[0], 150],
    paddingBottomRight: [window.innerWidth >= 860 ? 440 : 60, window.innerWidth >= 860 ? 60 : 220],
    maxZoom: 15, duration: animate ? .75 : 0
  });
}

/* ==========================================================================
   6. render
   ========================================================================== */
function jobCover(job) {
  const p = job.photos && job.photos[0];
  return p ? (p.src || p) : null;
}

function placeLabel(job) {
  // What a customer is allowed to see. Privacy on => block, not house number.
  if (job.privacy && !State.ownerMode) {
    const bits = [job.neighborhood, job.city, job.state].filter(Boolean);
    return bits.length ? bits.join(', ') : 'Location approximate';
  }
  return job.address || [job.neighborhood, job.city, job.state].filter(Boolean).join(', ') || '—';
}

function renderParsed() {
  const box = $('#parsed');
  box.innerHTML = '';
  const p = State.parsed;
  if (p.isEmpty && !p.nearMe) return;

  DIMENSIONS.forEach((d) => {
    const ids = p.facets[d.key];
    if (!ids) return;
    [...ids].forEach((id) => {
      const tag = el('span', { class: 'ptag' });
      if (d.key === 'color') tag.appendChild(el('span', { class: 'dot', style: `background:${swatchFor(id)}` }));
      tag.appendChild(el('span', { class: 'k', text: d.label }));
      tag.appendChild(document.createTextNode(labelFor(d.key, id)));
      box.appendChild(tag);
    });
  });
  p.free.forEach((w) => box.appendChild(el('span', { class: 'ptag free', text: `"${w}"` })));
  if (p.nearMe) box.appendChild(el('span', { class: 'ptag', text: '📍 nearest first' }));
}

function cardFor(r, isNearest) {
  const j = r.job;
  const spot = r.spotlight;
  const cover = jobCover(j);
  const dist = fmtMiles(r.miles);
  const n = (j.photos || []).length;

  const thumb = el('div', { class: 'card-thumb' }, [
    cover
      ? el('img', { src: cover, alt: j.photoAlt || j.title, loading: 'lazy', decoding: 'async' })
      : el('div', { class: 'empty-thumb', style: 'width:100%;height:100%;display:grid;place-items:center;color:#5E574F;font-size:.7rem;text-align:center;padding:6px', text: 'No photo yet' }),
    n > 1 ? el('span', { class: 'n', text: `${n} photos` }) : null
  ]);

  const eyebrow = el('div', { class: 'card-eyebrow' }, [
    isNearest ? el('span', { class: 'badge', text: 'Nearest match' }) : null,
    spot ? el('span', { class: 'badge ghost', text: spot }) : null,
    document.createTextNode(labelFor('service', primaryService(j)))
  ]);

  const meta = el('div', { class: 'card-meta' }, [
    dist ? el('span', { class: 'card-dist' }, [
      el('span', { html: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>' }),
      document.createTextNode(`${dist} away`)
    ]) : null,
    el('span', { text: placeLabel(j) }),
    j.year ? el('span', { text: String(j.year) }) : null,
    (j.color || []).length
      ? el('span', { class: 'card-swatches' }, (j.color || []).slice(0, 4).map((c) =>
          el('span', { class: 'sw', style: `background:${swatchFor(c)}`, title: labelFor('color', c) })))
      : null,
    j.demo ? el('span', { class: 'badge demo', text: 'Sample' }) : null
  ]);

  return el('button', {
    class: `card${isNearest ? ' is-nearest' : ''}`,
    type: 'button',
    onclick: () => openDetail(j.id)
  }, [thumb, el('div', { class: 'card-main' }, [eyebrow, el('div', { class: 'card-title', text: j.title }), meta])]);
}

const EXAMPLES = [
  'stamped & colored driveway',
  'patio with black granite',
  'pool deck washed aggregate',
  'seamless slate patio',
  'stained patio with a fire pit',
  'exposed aggregate driveway',
  'masonry retaining wall',
  'outdoor kitchen countertop'
];

function renderResults() {
  const body = $('#sheetBody');
  body.innerHTML = '';

  const p = State.parsed;
  const n = State.results.length;
  const hasQuery = !p.isEmpty;

  $('#sheetCount').textContent = hasQuery
    ? (State.cut ? `${n} closest` : `${n} match${n === 1 ? '' : 'es'}`)
    : `${n} project${n === 1 ? '' : 's'}`;

  $('#sheetSub').textContent = State.cut
    ? 'Nothing matched exactly — here is the closest work'
    : State.here
      ? 'Nearest first'
      : hasQuery ? 'Best match first' : 'Turn on location to sort by distance';

  if (!n) {
    body.appendChild(el('div', { class: 'empty' }, [
      el('h3', { text: 'Nothing here yet' }),
      el('p', { text: State.jobs.length
        ? 'No project matched that. Try one of these:'
        : 'No projects have been added yet. Open owner tools to add the first one.' }),
      State.jobs.length ? el('div', { class: 'chips' }, EXAMPLES.slice(0, 4).map((x) =>
        el('button', { class: 'chip', type: 'button', text: x, onclick: () => setQuery(x) }))) : null
    ]));
    return;
  }

  const nearestId = State.results.find((r) => r.miles != null)?.job.id || null;
  State.results.forEach((r) => {
    body.appendChild(cardFor(r, hasQuery && State.here && r.job.id === nearestId));
  });

  body.appendChild(el('p', {
    class: 'hint',
    style: 'text-align:center;padding:14px 0 4px',
    text: State.here ? 'Distance is straight-line from where you are standing.' : 'Distances appear once you turn on location.'
  }));
}

/* --- detail ------------------------------------------------------------- */
function openDetail(id) {
  const r = State.results.find((x) => x.job.id === id) || { job: State.jobs.find((j) => j.id === id), miles: null };
  if (!r || !r.job) return;
  const j = r.job;
  State.activeId = id;

  const photos = (j.photos || []).map((p) => (p.src || p));
  const gal = $('#galTrack');
  gal.innerHTML = '';
  if (photos.length) {
    photos.forEach((src, i) => gal.appendChild(el('div', { class: 'gal-slide' }, [
      el('img', { src, alt: `${j.title} — photo ${i + 1}`, loading: i === 0 ? 'eager' : 'lazy', decoding: 'async' })
    ])));
  } else {
    gal.appendChild(el('div', { class: 'gal-slide', style: 'display:grid;place-items:center;color:#5E574F' }, [
      el('span', { text: 'No photos on this job yet' })
    ]));
  }
  const dots = $('#galDots');
  dots.innerHTML = '';
  if (photos.length > 1) photos.forEach((_, i) => dots.appendChild(el('span', { class: `gal-dot${i === 0 ? ' on' : ''}` })));
  $('#galCount').textContent = photos.length > 1 ? `1 / ${photos.length}` : '';
  $('#galCount').style.display = photos.length > 1 ? '' : 'none';

  $('#dEyebrow').innerHTML = '';
  $('#dEyebrow').appendChild(document.createTextNode(labelFor('service', primaryService(j))));
  if (j.demo) $('#dEyebrow').appendChild(el('span', { class: 'badge demo', text: 'Sample data' }));

  $('#dTitle').textContent = j.title;
  $('#dLede').textContent = j.description || '';
  $('#dLede').style.display = j.description ? '' : 'none';

  // distance row
  const dist = fmtMiles(r.miles);
  const drow = $('#dDist');
  drow.innerHTML = '';
  if (dist) {
    drow.style.display = '';
    drow.appendChild(el('span', { class: 'big', text: dist }));
    drow.appendChild(el('span', { class: 'lbl', text: `from where you are now · ${placeLabel(j)}` }));
  } else if (j.lat != null) {
    drow.style.display = '';
    drow.appendChild(el('span', { class: 'lbl', text: `${placeLabel(j)} — turn on location to see how far this is from you.` }));
    drow.appendChild(el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Locate me', onclick: () => requestLocation(true) }));
  } else {
    drow.style.display = 'none';
  }

  // spec sheet
  const spec = $('#dSpec');
  spec.innerHTML = '';
  const row = (k, vals) => {
    const list = (Array.isArray(vals) ? vals : [vals]).filter(Boolean);
    if (!list.length) return;
    spec.appendChild(el('div', { class: 'spec-row' }, [
      el('div', { class: 'spec-k', text: k }),
      el('div', { class: 'spec-v' }, list)
    ]));
  };
  row('Service', serviceSet(j).map((id) => el('span', { class: 'tagv', text: labelFor('service', id) })));
  row('Surface', j.surface ? [el('span', { class: 'tagv', text: labelFor('surface', j.surface) })] : []);
  row('Pattern', j.pattern ? [el('span', { class: 'tagv', text: labelFor('pattern', j.pattern) })] : []);
  row('Color', (j.color || []).map((c) => el('span', { class: 'tagv' }, [
    el('span', { class: 'sw', style: `background:${swatchFor(c)}` }),
    document.createTextNode(labelFor('color', c))
  ])));
  row('Finish', (j.finish || []).map((f) => el('span', { class: 'tagv', text: labelFor('finish', f) })));
  row('Details', (j.feature || []).map((f) => el('span', { class: 'tagv', text: labelFor('feature', f) })));
  row('Where', [el('span', { text: placeLabel(j) })]);
  row('Completed', j.year ? [el('span', { text: String(j.year) })] : []);

  // actions
  const acts = $('#dActions');
  acts.innerHTML = '';
  if (j.lat != null) {
    const q = j.privacy && !State.ownerMode
      ? `${j.lat.toFixed(4)},${j.lng.toFixed(4)}`
      : encodeURIComponent(j.address || `${j.lat},${j.lng}`);
    acts.appendChild(el('a', {
      class: 'btn btn-primary',
      href: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
      target: '_blank', rel: 'noopener'
    }, [
      el('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>' }),
      document.createTextNode('Directions')
    ]));
    if (State.map) acts.appendChild(el('button', {
      class: 'btn btn-ghost', type: 'button', text: 'Show on map',
      onclick: () => { closeDetail(); State.map.flyTo([j.lat, j.lng], 16, { duration: .8 }); drawPins(); }
    }));
  }
  if (State.ownerMode) {
    acts.appendChild(el('button', { class: 'btn btn-ghost', type: 'button', text: 'Edit job', onclick: () => { closeDetail(); openEditor(j); } }));
  }

  $('#detail').classList.add('open');
  $('#detail').setAttribute('aria-hidden', 'false');
  $('#detailScroll').scrollTop = 0;
  drawPins();
}

function closeDetail() {
  $('#detail').classList.remove('open');
  $('#detail').setAttribute('aria-hidden', 'true');
  State.activeId = null;
  drawPins();
}

/* ==========================================================================
   7. query pipeline
   ========================================================================== */
function runSearch() {
  State.parsed = Search.parse($('#q').value);
  const out = Search.run(State.jobs, State.parsed, State.here);
  State.results = out.results;
  State.cut = out.cut;
  renderParsed();
  renderResults();
  drawPins();
  $('#searchClear').classList.toggle('on', !!$('#q').value);
  $$('.chip[data-ex]').forEach((c) => c.classList.toggle('on', c.dataset.ex === $('#q').value));
}

function setQuery(text, { fit = true } = {}) {
  $('#q').value = text;
  runSearch();
  openSheet();
  if (fit) fitToResults();
}

function openSheet() { $('#sheet').classList.add('open'); State.sheetOpen = true; }
function toggleSheet() { $('#sheet').classList.toggle('open'); State.sheetOpen = $('#sheet').classList.contains('open'); }

/* ==========================================================================
   8. location
   ========================================================================== */
function requestLocation(announce) {
  if (!('geolocation' in navigator)) { toast('This device will not share a location.'); return; }
  const btn = $('#btnLocate');
  btn.setAttribute('aria-pressed', 'true');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      State.here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      runSearch();
      fitToResults();
      if (announce) toast('Location on — sorted by how close each job is.');
      // Keep it fresh while he walks the street.
      if (State.watchId === null) {
        State.watchId = navigator.geolocation.watchPosition(
          (p) => { State.here = { lat: p.coords.latitude, lng: p.coords.longitude }; runSearch(); },
          () => {}, { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
        );
      }
    },
    (err) => {
      btn.setAttribute('aria-pressed', 'false');
      toast(err.code === 1
        ? 'Location is blocked for this site — turn it on in browser settings.'
        : 'Could not get a location fix right now.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

/* ==========================================================================
   9. owner mode
   ========================================================================== */
const DEFAULT_PIN = '1945';   // the year the business was founded; changeable in owner tools

async function ownerPin() {
  const stored = await Store.meta('pin');
  return stored || DEFAULT_PIN;
}

function openPinPad() {
  const m = $('#modal');
  let entered = '';
  const err = el('p', { class: 'pin-err' });
  const dots = el('div', { class: 'pin-dots' }, [0, 1, 2, 3].map(() => el('span', { class: 'pin-dot' })));

  const paint = () => $$('.pin-dot', dots).forEach((d, i) => d.classList.toggle('on', i < entered.length));

  const submit = async () => {
    const pin = await ownerPin();
    if (entered === pin) {
      State.ownerMode = true;
      $('#btnOwner').classList.add('owner-on');
      $('#btnOwner').setAttribute('aria-pressed', 'true');
      $('#btnAdd').style.display = '';
      closeModal();
      toast('Owner tools unlocked.');
      runSearch();
    } else {
      err.textContent = 'That PIN did not match.';
      entered = ''; paint();
      if (navigator.vibrate) navigator.vibrate(140);
    }
  };

  const key = (d) => {
    if (d === 'del') entered = entered.slice(0, -1);
    else if (entered.length < 4) entered += d;
    err.textContent = '';
    paint();
    if (entered.length === 4) setTimeout(submit, 130);
  };

  showModal('Owner tools', el('div', { class: 'pinpad' }, [
    el('p', { class: 'hint', style: 'text-align:center', text: 'Enter the owner PIN to add or edit jobs. Customers never see this.' }),
    dots,
    el('div', { class: 'pin-keys' }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) =>
      el('button', { class: 'pin-key', type: 'button', text: String(d), onclick: () => key(String(d)) }))
      .concat([
        el('span'),
        el('button', { class: 'pin-key', type: 'button', text: '0', onclick: () => key('0') }),
        el('button', { class: 'pin-key', type: 'button', html: '&#9003;', onclick: () => key('del') })
      ])),
    err
  ]), [el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: closeModal })]);
}

function showModal(title, body, footButtons) {
  $('#modalTitle').textContent = title;
  const b = $('#modalBody');
  b.innerHTML = '';
  b.appendChild(body);
  const f = $('#modalFoot');
  f.innerHTML = '';
  (footButtons || []).forEach((x) => f.appendChild(x));
  f.style.display = (footButtons || []).length ? '' : 'none';
  $('#modal').classList.add('open');
  $('#modal').setAttribute('aria-hidden', 'false');
}

function closeModal() {
  $('#modal').classList.remove('open');
  $('#modal').setAttribute('aria-hidden', 'true');
  State.pendingPhotos = [];
  State.pendingLoc = null;
  if (State.locMap) { State.locMap.remove(); State.locMap = null; State.locMarker = null; }
}

/* --- photo intake -------------------------------------------------------
   Phone cameras produce 4–12MB files. Stored raw, twenty jobs would blow past
   every browser quota there is, so every photo is drawn to a canvas, capped on
   the long edge and re-encoded before it is ever held in memory as a record. */
function compressImage(file, maxEdge = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxEdge) {
        const s = maxEdge / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      // WebP where the browser will, JPEG everywhere else.
      let out = c.toDataURL('image/webp', quality);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', quality);
      resolve({ src: out, w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

async function addPhotoFiles(files, grid) {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  toast(`Processing ${list.length} photo${list.length === 1 ? '' : 's'}…`);
  for (const f of list) {
    if (State.pendingPhotos.length >= 12) { toast('Twelve photos is the cap per job.'); break; }
    try {
      const p = await compressImage(f);
      State.pendingPhotos.push(p);
      paintPhotoGrid(grid);
    } catch (e) {
      toast(`Could not read ${f.name}`);
    }
  }
}

function paintPhotoGrid(grid) {
  grid.innerHTML = '';
  State.pendingPhotos.forEach((p, i) => {
    grid.appendChild(el('div', { class: 'photo' }, [
      el('img', { src: p.src, alt: `Photo ${i + 1}` }),
      i === 0 ? el('span', { class: 'cover-tag', text: 'Cover' }) : null,
      el('button', {
        class: 'rm', type: 'button', 'aria-label': `Remove photo ${i + 1}`,
        html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        onclick: () => { State.pendingPhotos.splice(i, 1); paintPhotoGrid(grid); }
      })
    ]));
  });
  const add = el('button', { class: 'photo-add', type: 'button' }, [
    el('span', { html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' }),
    el('span', { text: State.pendingPhotos.length ? 'Add more' : 'Add photos' })
  ]);
  add.onclick = () => $('#photoInput').click();
  grid.appendChild(add);
}

/* --- geocoding -----------------------------------------------------------
   Nominatim: free, no key, and explicitly rate-limited to one request a second
   with a real User-Agent. We debounce hard, only fire on an explicit tap, and
   degrade to "drop the pin yourself" whenever it fails — which it will, on a
   job site with one bar of signal.                                          */
async function geocode(address) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q='
    + encodeURIComponent(address);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) throw new Error('lookup failed');
    const rows = await res.json();
    if (!rows.length) return null;
    return {
      lat: parseFloat(rows[0].lat),
      lng: parseFloat(rows[0].lon),
      display: rows[0].display_name
    };
  } catch (e) {
    clearTimeout(timer);
    return undefined; // undefined = could not reach the service; null = no result
  }
}

/* --- the add / edit form ------------------------------------------------- */
function openEditor(job) {
  const isNew = !job;
  const j = job || {
    id: uid(), title: '', address: '', city: '', state: 'TN', neighborhood: '',
    service: ['stamped-concrete'], surface: '', pattern: '', color: [], finish: [], feature: [],
    description: '', year: new Date().getFullYear(), lat: null, lng: null,
    privacy: true, photos: [], demo: false
  };
  State.editing = j;
  State.pendingPhotos = (j.photos || []).slice();
  State.pendingLoc = j.lat != null ? { lat: j.lat, lng: j.lng } : null;

  const form = el('div');

  /* -- name -- */
  const fTitle = el('input', { class: 'input', type: 'text', id: 'fTitle', value: j.title,
    placeholder: 'e.g. Henderson driveway — Collierville', maxlength: '90' });
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'fTitle' }, [document.createTextNode('Job name '), el('span', { class: 'req', text: '*' })]),
    fTitle,
    el('p', { class: 'hint', text: 'What you would call it out loud. Customers see this, so a street or a neighbourhood reads better than an invoice number.' })
  ]));

  /* -- address + location -- */
  const fAddr = el('input', { class: 'input', type: 'text', id: 'fAddr', value: j.address,
    placeholder: '1234 Poplar Ave, Collierville TN', autocomplete: 'off' });
  const locStatus = el('div', { class: 'loc-status', text: j.lat != null ? `Pin set · ${j.lat.toFixed(5)}, ${j.lng.toFixed(5)}` : 'No pin set yet' });
  if (j.lat != null) locStatus.classList.add('ok');

  const setLoc = (lat, lng, msg, cls) => {
    State.pendingLoc = { lat, lng };
    locStatus.className = 'loc-status ' + (cls || 'ok');
    locStatus.textContent = msg || `Pin set · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (State.locMap) {
      State.locMap.setView([lat, lng], Math.max(State.locMap.getZoom(), 16));
      if (State.locMarker) State.locMarker.setLatLng([lat, lng]);
    }
  };

  const btnGeo = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Find address' });
  btnGeo.onclick = async () => {
    const q = fAddr.value.trim();
    if (!q) { toast('Type an address first.'); return; }
    locStatus.className = 'loc-status';
    locStatus.innerHTML = '';
    locStatus.appendChild(el('span', { class: 'spin' }));
    locStatus.appendChild(document.createTextNode('Looking up that address…'));
    btnGeo.disabled = true;
    const hit = await geocode(q);
    btnGeo.disabled = false;
    if (hit === undefined) setLoc(State.pendingLoc?.lat || 35.2959, State.pendingLoc?.lng || -89.6687,
      'Address lookup is unreachable right now — drag the pin instead.', 'err');
    else if (hit === null) { locStatus.className = 'loc-status err'; locStatus.textContent = 'No match for that address. Drag the pin, or use “I am here now”.'; }
    else setLoc(hit.lat, hit.lng);
  };

  const btnHere = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, [
    el('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>' }),
    document.createTextNode('I am here now')
  ]);
  btnHere.onclick = () => {
    if (!('geolocation' in navigator)) { toast('This device will not share a location.'); return; }
    locStatus.className = 'loc-status';
    locStatus.innerHTML = '';
    locStatus.appendChild(el('span', { class: 'spin' }));
    locStatus.appendChild(document.createTextNode('Getting a fix…'));
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc(p.coords.latitude, p.coords.longitude, `Pinned where you are standing · ±${Math.round(p.coords.accuracy)}m`),
      () => { locStatus.className = 'loc-status err'; locStatus.textContent = 'Could not get a fix. Type the address instead.'; },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const locMapDiv = el('div', { class: 'locmap', id: 'locMap' });
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'fAddr' }, [document.createTextNode('Job address '), el('span', { class: 'req', text: '*' })]),
    fAddr,
    el('div', { class: 'locbox', style: 'margin-top:8px' }, [
      locMapDiv,
      el('div', { class: 'locbar' }, [btnHere, btnGeo]),
      locStatus
    ]),
    el('p', { class: 'hint', text: 'Standing on the job when you finish it? Tap “I am here now” and the pin lands exactly right. Otherwise type the address, or drag the pin.' })
  ]));

  /* -- privacy -- */
  const fPriv = el('input', { type: 'checkbox', id: 'fPriv' });
  fPriv.checked = j.privacy !== false;
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'switch' }, [
      fPriv, el('span', { class: 'track' }),
      el('span', { class: 'tx' }, [
        el('b', { text: 'Protect the homeowner’s address' }),
        el('span', { text: 'On: customers see the street and town and a pin on the block, never the house number. Off: the full address shows. Ask the homeowner before turning this off.' })
      ])
    ])
  ]));

  /* -- photos -- */
  const grid = el('div', { class: 'photos' });
  paintPhotoGrid(grid);
  form.appendChild(el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Photos of the work' }),
    grid,
    el('p', { class: 'hint', text: 'First photo is the cover. Shoot wide first, then the detail shots — the close-up of the stamp is what sells the job.' })
  ]));

  /* -- what it is -- */
  const fService = el('select', { class: 'input', id: 'fService' },
    SERVICES.map((s) => el('option', { value: s.id, selected: s.id === primaryService(j) }, [document.createTextNode(s.label)])));
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'fService' }, [document.createTextNode('Service '), el('span', { class: 'req', text: '*' })]),
    fService
  ]));

  const fSurface = el('select', { class: 'input', id: 'fSurface' },
    [el('option', { value: '' }, [document.createTextNode('— choose —')])].concat(
      SURFACES.map((s) => el('option', { value: s.id, selected: s.id === j.surface }, [document.createTextNode(s.label)]))));
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'fSurface', text: 'What is it' }), fSurface
  ]));

  const fPattern = el('select', { class: 'input', id: 'fPattern' },
    [el('option', { value: '' }, [document.createTextNode('— none / not stamped —')])].concat(
      PATTERNS.map((s) => el('option', { value: s.id, selected: s.id === j.pattern }, [document.createTextNode(s.label)]))));
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'fPattern', text: 'Stamp pattern' }), fPattern
  ]));

  // multi-selects as pills
  const pickState = { color: new Set(j.color || []), finish: new Set(j.finish || []), feature: new Set(j.feature || []) };
  const pillGroup = (key, list, label, hint) => {
    const wrap = el('div', { class: 'pills' });
    list.forEach((item) => {
      const b = el('button', { class: `pill${pickState[key].has(item.id) ? ' on' : ''}`, type: 'button' });
      if (key === 'color') b.appendChild(el('span', { class: 'sw', style: `background:${item.swatch}` }));
      b.appendChild(document.createTextNode(item.label));
      b.onclick = () => {
        if (pickState[key].has(item.id)) pickState[key].delete(item.id);
        else pickState[key].add(item.id);
        b.classList.toggle('on');
      };
      wrap.appendChild(b);
    });
    form.appendChild(el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }), wrap,
      hint ? el('p', { class: 'hint', text: hint }) : null
    ]));
  };
  pillGroup('color', COLORS, 'Color', 'Tap every colour on the job. This is what a customer types — "black granite patio" only finds this job if Black Granite is tapped here.');
  pillGroup('finish', FINISHES, 'Finish');
  pillGroup('feature', FEATURES, 'Details worth searching for');

  /* -- description + year -- */
  const fDesc = el('textarea', { class: 'input', id: 'fDesc', maxlength: '600',
    placeholder: 'What you built, what the customer wanted, anything unusual about it.' });
  fDesc.value = j.description || '';
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: 'fDesc', text: 'Description' }), fDesc,
    el('p', { class: 'hint', text: 'Words typed here are searchable too, so write the way a customer talks.' })
  ]));

  const fYear = el('input', { class: 'input', type: 'number', id: 'fYear', value: j.year || '',
    min: '1945', max: String(new Date().getFullYear()), placeholder: String(new Date().getFullYear()) });
  const fCity = el('input', { class: 'input', type: 'text', id: 'fCity', value: j.city || '', placeholder: 'Collierville' });
  form.appendChild(el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Town and year' }),
    el('div', { class: 'input-row' }, [fCity, fYear])
  ]));

  /* -- save -- */
  const save = el('button', { class: 'btn btn-primary', type: 'button', text: isNew ? 'Save job' : 'Save changes' });
  save.onclick = async () => {
    const title = fTitle.value.trim();
    if (!title) { toast('Give the job a name.'); fTitle.focus(); return; }
    if (!State.pendingLoc) { toast('Set the pin — tap “I am here now” or find the address.'); return; }

    const rec = {
      ...j,
      title,
      address: fAddr.value.trim(),
      city: fCity.value.trim(),
      state: j.state || 'TN',
      neighborhood: j.neighborhood || '',
      service: [fService.value],   // the rest are derived by serviceSet()
      surface: fSurface.value,
      pattern: fPattern.value,
      color: [...pickState.color],
      finish: [...pickState.finish],
      feature: [...pickState.feature],
      description: fDesc.value.trim(),
      year: fYear.value ? parseInt(fYear.value, 10) : null,
      lat: State.pendingLoc.lat,
      lng: State.pendingLoc.lng,
      privacy: fPriv.checked,
      photos: State.pendingPhotos,
      demo: false,                       // anything the owner touches is real
      updated: new Date().toISOString()
    };

    save.disabled = true;
    const ok = await Store.putJob(rec);
    save.disabled = false;
    if (!ok) return;
    await reload();
    closeModal();
    toast(isNew ? 'Job added.' : 'Job updated.');
    setTimeout(() => openDetail(rec.id), 220);
  };

  const foot = [save];
  if (!isNew) {
    const del = el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete' });
    del.onclick = async () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Tap again to delete';
        setTimeout(() => { del.dataset.armed = '0'; del.textContent = 'Delete'; }, 4000);
        return;
      }
      await Store.delJob(j.id);
      await reload();
      closeModal();
      toast('Job deleted.');
    };
    foot.push(del);
  }

  showModal(isNew ? 'Add a job' : 'Edit job', form, foot);

  // The little location map has to be built after the modal is in the DOM.
  setTimeout(() => {
    if (typeof L === 'undefined') {
      // No map to drag a pin on — "I am here now" and the address lookup still
      // set a location, so the form stays usable.
      locMapDiv.style.cssText = 'height:auto;padding:18px;text-align:center;font-size:.82rem;color:#9E958A';
      locMapDiv.textContent = 'Map unavailable offline — use “I am here now”, or type the address and tap Find address.';
      return;
    }
    const start = State.pendingLoc || { lat: 35.2959, lng: -89.6687 };  // shop address
    State.locMap = L.map(locMapDiv, { zoomControl: false, attributionControl: false })
      .setView([start.lat, start.lng], State.pendingLoc ? 16 : 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 20 })
      .addTo(State.locMap);
    State.locMarker = L.marker([start.lat, start.lng], {
      draggable: true,
      icon: L.divIcon({ className: 'pin-hit', html: pinSVG({ service: fService.value }, 'is-active'), iconSize: [38, 46], iconAnchor: [19, 46] })
    }).addTo(State.locMap);
    State.locMarker.on('dragend', (e) => {
      const p = e.target.getLatLng();
      setLoc(p.lat, p.lng, `Pin moved · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
    });
    State.locMap.on('click', (e) => {
      State.locMarker.setLatLng(e.latlng);
      setLoc(e.latlng.lat, e.latlng.lng);
    });
    setTimeout(() => State.locMap.invalidateSize(), 120);
  }, 60);
}

/* --- owner menu ---------------------------------------------------------- */
function openOwnerMenu() {
  const body = el('div');
  const realCount = State.jobs.filter((j) => !j.demo).length;
  const demoCount = State.jobs.filter((j) => j.demo).length;

  body.appendChild(el('p', { class: 'hint', style: 'margin-bottom:16px',
    text: `${realCount} of your own job${realCount === 1 ? '' : 's'} saved${demoCount ? `, plus ${demoCount} sample job${demoCount === 1 ? '' : 's'} that shipped with the app.` : '.'}` }));

  const btn = (label, hint, fn, cls) => {
    const b = el('button', { class: `btn ${cls || 'btn-ghost'}`, type: 'button', text: label, style: 'width:100%' });
    b.onclick = fn;
    body.appendChild(el('div', { class: 'field' }, [b, hint ? el('p', { class: 'hint', text: hint }) : null]));
  };

  btn('Add a job', 'Name, address, photos, and what it is.', () => { closeModal(); setTimeout(() => openEditor(null), 180); }, 'btn-primary');

  btn('Export a backup', 'Downloads every job and photo as one file. Do this before changing phones.', async () => {
    const data = { app: 'urban-concrete-showroom', version: 1, exported: new Date().toISOString(), jobs: State.jobs };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `urban-concrete-showroom-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    toast('Backup downloaded.');
  });

  btn('Restore from a backup', 'Adds the jobs in a backup file. Jobs already here are kept.', () => $('#importInput').click());

  if (demoCount) {
    btn(`Remove the ${demoCount} sample jobs`, 'Clears the demo pins that shipped with the app. Your own jobs are untouched.', async () => {
      for (const j of State.jobs.filter((x) => x.demo)) await Store.delJob(j.id);
      await reload();
      closeModal();
      toast('Sample jobs removed.');
    });
  }

  btn('Change the owner PIN', 'Four digits. Only needed to add or edit jobs.', () => {
    const inp = el('input', { class: 'input', type: 'tel', maxlength: '4', inputmode: 'numeric', placeholder: '••••' });
    const okBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Set PIN' });
    okBtn.onclick = async () => {
      const v = inp.value.replace(/\D/g, '');
      if (v.length !== 4) { toast('Four digits, please.'); return; }
      await Store.meta('pin', v);
      closeModal();
      toast('PIN changed.');
    };
    showModal('New owner PIN', el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Four digits' }), inp,
      el('p', { class: 'hint', text: 'Written on this device only. If you forget it, clear the site data and it resets to 1945.' })
    ]), [okBtn, el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: closeModal })]);
  });

  btn('Lock owner tools', 'Hands the phone to a customer safely.', () => {
    State.ownerMode = false;
    $('#btnOwner').classList.remove('owner-on');
    $('#btnOwner').setAttribute('aria-pressed', 'false');
    $('#btnAdd').style.display = 'none';
    closeModal();
    runSearch();
    toast('Locked. Customer view.');
  });

  showModal('Owner tools', body, [el('button', { class: 'btn btn-ghost', type: 'button', text: 'Close', onclick: closeModal })]);
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : data.jobs;
    if (!Array.isArray(rows)) throw new Error('not a backup file');
    let n = 0;
    for (const r of rows) {
      if (!r || !r.id || !r.title) continue;
      const exists = State.jobs.some((j) => j.id === r.id);
      await Store.putJob(exists ? { ...r, id: uid() } : r);
      n += 1;
    }
    await reload();
    closeModal();
    toast(`Restored ${n} job${n === 1 ? '' : 's'}.`);
  } catch (e) {
    toast('That file is not a Showroom backup.');
  }
}

/* ==========================================================================
   10. boot
   ========================================================================== */
async function reload() {
  State.jobs = await Store.allJobs();
  runSearch();
}

async function seedIfEmpty() {
  const seeded = await Store.meta('seeded');
  const existing = await Store.allJobs();
  if (seeded || existing.length) return;
  try {
    const res = await fetch('data/seed.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('no seed');
    const rows = await res.json();
    for (const r of rows) await Store.putJob({ ...r, demo: true });
    await Store.meta('seeded', true);
  } catch (e) {
    // An empty app is a valid state — the owner adds the first job.
  }
}

function wireUI() {
  const q = $('#q');
  q.addEventListener('input', debounce(runSearch, 130));
  q.addEventListener('focus', openSheet);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); q.blur(); runSearch(); fitToResults(); openSheet(); }
    if (e.key === 'Escape') { q.value = ''; runSearch(); }
  });
  $('#searchGo').onclick = () => { q.blur(); runSearch(); fitToResults(); openSheet(); };
  $('#searchClear').onclick = () => { q.value = ''; q.focus(); runSearch(); };

  $('#chips').innerHTML = '';
  EXAMPLES.forEach((x) => $('#chips').appendChild(
    el('button', { class: 'chip', type: 'button', 'data-ex': x, text: x, onclick: () => setQuery(x) })));

  $('#btnLocate').onclick = () => requestLocation(true);
  $('#btnOwner').onclick = () => (State.ownerMode ? openOwnerMenu() : openPinPad());
  $('#btnAdd').onclick = () => openEditor(null);
  $('#btnAdd').style.display = 'none';

  $('#sheetGrab').onclick = toggleSheet;
  $('#dClose').onclick = closeDetail;
  $('#modalClose').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  $('#photoInput').addEventListener('change', (e) => {
    const grid = $('.photos');
    if (grid) addPhotoFiles(e.target.files, grid);
    e.target.value = '';
  });
  $('#importInput').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  $('#demoDismiss').onclick = () => $('#demoBanner').classList.add('gone');

  // gallery dots
  const track = $('#galTrack');
  track.addEventListener('scroll', debounce(() => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    $$('#galDots .gal-dot').forEach((d, k) => d.classList.toggle('on', k === i));
    const total = $$('#galDots .gal-dot').length;
    if (total > 1) $('#galCount').textContent = `${i + 1} / ${total}`;
  }, 60));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#modal').classList.contains('open')) closeModal();
    else if ($('#detail').classList.contains('open')) closeDetail();
  });

  // Drag the sheet on touch.
  let y0 = null, h0 = 0;
  const sheet = $('#sheet');
  $('#sheetGrab').addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; h0 = sheet.classList.contains('open') ? 1 : 0; }, { passive: true });
  $('#sheetGrab').addEventListener('touchend', (e) => {
    if (y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    if (dy < -30) openSheet();
    else if (dy > 30) sheet.classList.remove('open');
    y0 = null;
  }, { passive: true });

  window.addEventListener('resize', debounce(() => { if (State.map) State.map.invalidateSize(); }, 200));
  if (State.map) State.map.on('zoomend moveend', debounce(drawPins, 120));
}

async function boot() {
  /* Every step here is allowed to fail without taking the app with it. The
     splash is dismissed in a finally, because a permanent splash screen in
     front of a customer is the single worst thing this app could do — and it
     is exactly what happened the first time the map library failed to load. */
  try {
    let map = null;
    try { map = initMap(); } catch (e) { document.body.classList.add('no-map'); }
    if (!map) mapFallbackNotice();

    wireUI();

    try { await seedIfEmpty(); } catch (e) { /* an empty book is a valid state */ }
    await reload();

    if (!State.jobs.some((j) => j.demo)) $('#demoBanner').classList.add('gone');

    if (!map) openSheet();   // with no map the list IS the app
    fitToResults(false);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch (e) {
    // Last resort: show whatever we have rather than a loading screen.
    try { renderResults(); } catch (e2) {}
    toast('Something went wrong loading the app.');
    if (window.console) console.error(e);
  } finally {
    setTimeout(() => $('#splash').classList.add('gone'), 420);
  }
}

document.addEventListener('DOMContentLoaded', boot);
