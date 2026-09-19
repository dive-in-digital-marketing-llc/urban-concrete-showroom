/* ==========================================================================
   Urban Showroom — search
   Built by Dive In Digital Marketing

   The brief asks for search across "project type, trade, material, finish,
   color, feature, neighborhood/area, date, and custom tags", and for the
   ability to pull together a set for one prospect: "Outdoor Kitchens",
   "Exposed Aggregate Driveways", "Projects Near Germantown".

   All of that is one parser. A person types a sentence, not a filter:

     "stamped and colored driveway"
     "patio with black granite colored"
     "outdoor kitchens near Germantown"
     "before and afters from 2024"

   So the query is read, not matched. Four passes:

     1. normalise   "&" becomes "and", punctuation and case go
     2. lift out the instructions — "near me" means sort by distance,
        "before and after" means only show paired sets, "2024" is a year,
        "near Germantown" is a place anchor, not a word to score
     3. walk what is left LONGEST PHRASE FIRST against the taxonomy, so
        "black granite" is one colour and not the word black plus the word
        granite, and "colonial cobble" is found before the bare "cobble"
     4. whatever never matched is free text, scored against the project's own
        words and its photos' captions

   THREE RANKING DECISIONS THAT ARE LOAD-BEARING

   Each came from a defect the tests caught on real data, and each has a test
   guarding it in tools/test_search.js:

     · A project sits in more than one bucket. A stamped cobblestone driveway
       is Decorative Concrete AND Concrete AND a driveway. With one trade
       value, "cobblestone driveway" ranked two non-cobble driveways above
       the one that was cobble.

     · A miss demotes, it does not veto. Ask for something never built and
       the nearest thing to it should still be on the screen, lower down.

     · Rare facets count for more. Without it the common noun swamps the
       specific one: "seamless slate patio" buried the only seamless-slate
       job under three ordinary patios.
   ========================================================================== */
'use strict';

const Search = (() => {
  /* Normalise the way a person types into the way the index is keyed. */
  function normalise(q) {
    return String(q || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Place names come from the data, not a hard-coded list, so the moment a
     contractor adds a job in a new town that town becomes searchable. */
  /* Centroids are built from the COARSENED coordinate, never the real one.

     The centroid becomes the anchor every distance on screen is measured
     from, and a neighbourhood with one project in it has a centroid equal
     to that project's coordinate. Built from true coordinates, the screen
     then showed thirty distances from a real house — enough to solve back
     to it by least squares to within about 130 ft, with no console and no
     project id, just numbers read off one screen. Coarsened first, the
     same arithmetic lands on the cell, which is all it was ever going to
     be allowed to know. */
  function buildPlaceIndex(projects) {
    const places = new Map();
    (projects || []).forEach((p) => {
      const c = Geo.visibleCoord(p, false);
      [p.city, p.neighborhood].forEach((raw) => {
        const name = String(raw || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!places.has(key)) places.set(key, { name, count: 0, lat: 0, lng: 0, n: 0 });
        const rec = places.get(key);
        rec.count += 1;
        if (c) { rec.lat += c.lat; rec.lng += c.lng; rec.n += 1; }
      });
    });
    places.forEach((rec) => {
      if (rec.n) { rec.lat /= rec.n; rec.lng /= rec.n; } else { rec.lat = null; rec.lng = null; }
    });
    return places;
  }

  /* ---- parse ------------------------------------------------------------ */
  function parse(raw, { places = new Map() } = {}) {
    let q = normalise(raw);

    /* Whole phrases only. A bare `includes` found "near me" inside "near
       MEmphis" and "close by" inside "close BYhalia" — in a Memphis-metro
       product, where "pool decks near Memphis" then lost its place anchor
       entirely and returned a pergola. The same query with "in" instead of
       "near" worked, which made it look random. */
    const cutPhrase = (haystack, phrase) => {
      const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(^|\\s)' + esc + '(?=\\s|$)', 'g');
      if (!re.test(haystack)) return null;
      return haystack.replace(new RegExp('(^|\\s)' + esc + '(?=\\s|$)', 'g'), ' ');
    };

    let nearMe = false;
    PROXIMITY_WORDS.forEach((w) => {
      const cut = cutPhrase(q, normalise(w));
      if (cut !== null) { nearMe = true; q = cut; }
    });

    let wantPairs = false;
    PAIR_WORDS.forEach((w) => {
      const cut = cutPhrase(q, normalise(w));
      if (cut !== null) { wantPairs = true; q = cut; }
    });

    // Years. "2024", "in 2023", "2022 2024" — a range if two are given.
    const years = [];
    q = q.replace(/\b(19|20)\d{2}\b/g, (m) => { years.push(Number(m)); return ' '; });

    // Place anchor. Longest place name first so "olive branch" beats "olive".
    let nearPlace = null;
    const placeKeys = [...places.keys()].sort((a, b) => b.length - a.length);
    for (const key of placeKeys) {
      if (!key) continue;
      const re = new RegExp('(^|\\s)(near\\s+|in\\s+|around\\s+)?' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
      if (re.test(q)) {
        nearPlace = places.get(key);
        q = q.replace(re, ' ');
        break;
      }
    }

    q = q.replace(/\s+/g, ' ').trim();
    const words = q ? q.split(' ') : [];
    const facets = {};
    const free = [];

    /* One word can name a family rather than a value. "colored" is every
       way of putting colour into a slab; "stamped" is the whole decorative
       trade. Those ids went into the query looking exactly like an id the
       customer had typed out, and the spotlight promoter then hoisted a
       patio above four driveways to show off an "Integral color" the
       customer had never heard of. Record which ids arrived by expansion
       so the rest of the engine can tell the two apart. */
    const broad = {};
    const families = [];   // {dim, phrase, ids} — for saying it back in their words
    /* A word that means something in two different dimensions. "pool" is a
       project type AND a trade; "deck" is a type AND carpentry; "seat wall"
       is a type AND a feature. Scored as two independent asks, the second
       one always missed: a pool deck lost 4.2 points and the all-satisfied
       bonus for not being `type:pool`, and a book holding two pool decks
       reported that nothing matched "deck" at all. One word is one ask. */
    const alts = [];       // [[{dim,id},...], ...]

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
        const phrase = words.slice(i, i + len).join(' ');
        const perDim = new Map();
        hit.forEach(({ dim, id }) => {
          if (!facets[dim]) facets[dim] = new Set();
          facets[dim].add(id);
          if (!perDim.has(dim)) perDim.set(dim, []);
          perDim.get(dim).push(id);
        });
        if (perDim.size > 1) alts.push(hit.map(({ dim, id }) => ({ dim, id })));
        perDim.forEach((ids, dim) => {
          if (ids.length < 2) return;                     // a specific ask
          if (!broad[dim]) broad[dim] = new Set();
          ids.forEach((id) => broad[dim].add(id));
          families.push({ dim, phrase, ids });
        });
        i += len;
      } else {
        const w = words[i];
        if (!STOPWORDS.has(w) && w.length > 1) free.push(w);
        i += 1;
      }
    }

    const isEmpty = !Object.keys(facets).length && !free.length && !years.length && !nearPlace && !wantPairs;
    return { raw: String(raw || ''), facets, broad, families, alts, free, years, nearMe, nearPlace, wantPairs, isEmpty };
  }

  /* ---- rarity -----------------------------------------------------------
     How rare is each facet value across the projects loaded? Without this,
     every hit is worth the same and the common noun swamps the specific one.
     Recomputed whenever the set changes, which is cheap at this size and
     stays correct as the contractor's book grows. */
  let RARITY = new Map();
  let rarityFor = () => 1;

  function indexRarity(projects) {
    const N = Math.max((projects || []).length, 1);
    const df = new Map();
    (projects || []).forEach((project) => {
      DIMENSIONS.forEach((d) => {
        const raw = d.key === 'trade' ? tradeSet(project) : project[d.key];
        const vals = new Set(Array.isArray(raw) ? raw : raw ? [raw] : []);
        vals.forEach((v) => {
          const k = `${d.key}:${v}`;
          df.set(k, (df.get(k) || 0) + 1);
        });
      });
    });
    RARITY = df;
    /* The normaliser has to have a floor. With one project in the book
       `Math.log(1)` is 0, the `|| 1` guard turned the divisor into 1, and
       the single project scored 0.03 on its own facets — a brand-new
       contractor's first job was effectively unsearchable. log(8) keeps
       small books on the same scale as large ones, and the result is
       clamped so a facet nothing has cannot out-rank one something does. */
    const lnN = Math.max(Math.log(N), Math.log(8));
    rarityFor = (dim, id) => {
      const seen = RARITY.get(`${dim}:${id}`) || 0;
      if (!seen) return 1;              // nothing has it; do not reward asking
      const r = 1 + 1.4 * (Math.log(N / (seen + 1)) / lnN);
      return Math.min(2.4, Math.max(1, r));
    };
  }

  /* ---- haystack ---------------------------------------------------------
     A project's searchable text: its own words plus everything written on
     its photos. A caption the contractor typed is as findable as a tag. */
  /* `isOwner` is not decoration. Putting `project.address` in here for
     every viewer turned the search box into an address oracle: the card
     correctly rendered "Poplar Ave" with the house number stripped, and
     then typing "1420" returned that one project and nothing else, which
     confirms the number the display had just withheld. Fifty guesses cover
     a block. The index has to be built from the address the viewer is
     allowed to see, the same string `Geo.visibleAddress` puts on screen. */
  function haystack(project, photos, isOwner = false) {
    const parts = [
      project.name, project.notes, project.city, project.state,
      project.neighborhood, Geo.visibleAddress(project, isOwner),
      // The customer's name is the contractor's own index, never a
      // stranger's. It is the one field where being searchable and being
      // private are in direct conflict.
      isOwner ? project.client : null,
      (project.tags || []).join(' ')
    ];
    (photos || []).forEach((ph) => {
      if (ph.caption) parts.push(ph.caption);
      if (ph.tags && ph.tags.length) parts.push(ph.tags.map((t) => (typeof t === 'string' ? t : t.label || t.id)).join(' '));
    });
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  /* Custom tags are free text the contractor typed, so they are matched as
     text rather than as taxonomy ids. */
  function customTagHit(project, word) {
    return (project.tags || []).some((t) => String(t).toLowerCase().includes(word));
  }

  /* ---- score ------------------------------------------------------------ */
  function score(project, parsed, ctx) {
    if (parsed.isEmpty) return { score: 1, matchedDims: [], missedDims: [], hit: true };

    let s = 0;
    const matchedDims = [];
    const missedDims = [];
    let asked = 0;
    let satisfied = 0;

    /* "before and after" is a whole query on its own. It is applied as a
       filter in run(), so by the time a project is scored here it already
       HAS pairs — but nothing recorded that as a match, so `hit` was false
       for every project, `keep` came out empty, and the app told the
       contractor "no exact match, closest work we have" over results that
       were exactly what he asked for. */
    if (parsed.wantPairs && (project.pairs || []).length) {
      asked += 1;
      satisfied += 1;
      s += 12;
      matchedDims.push({ dim: 'pairs', ids: ['before/after'] });
    }

    /* Which dimensions came from one ambiguous word. A dimension belongs to
       a group only if EVERY id the query wants in it came from that group;
       if another word also contributed to the dimension, it is a real ask
       of its own again. */
    const groupOf = new Map();
    (parsed.alts || []).forEach((g, i) => g.forEach(({ dim, id }) => groupOf.set(`${dim}:${id}`, i)));

    const evals = [];
    for (const dim of DIMENSIONS) {
      const want = parsed.facets[dim.key];
      if (!want || !want.size) continue;

      const haveRaw = dim.key === 'trade' ? tradeSet(project) : project[dim.key];
      const have = new Set(Array.isArray(haveRaw) ? haveRaw : haveRaw ? [haveRaw] : []);
      const overlap = [...want].filter((id) => have.has(id));

      const gs = [...want].map((id) => (groupOf.has(`${dim.key}:${id}`) ? groupOf.get(`${dim.key}:${id}`) : -1));
      const group = gs.length && gs.every((g) => g >= 0 && g === gs[0]) ? gs[0] : -1;

      // Diminishing return within one dimension: asking for two colours and
      // getting both beats getting one, but not by double.
      const gain = overlap.length
        ? dim.weight * Math.max(...overlap.map((id) => rarityFor(dim.key, id))) * (1 + (overlap.length - 1) * 0.35)
        : 0;

      evals.push({ dim, want, overlap, group, gain });
    }

    evals.filter((e) => e.group < 0).forEach((e) => {
      asked += 1;
      if (e.overlap.length) {
        satisfied += 1;
        s += e.gain;
        matchedDims.push({ dim: e.dim.key, ids: e.overlap });
      } else {
        // A miss is a demotion, not a veto.
        s -= e.dim.weight * 0.35;
        missedDims.push({ dim: e.dim.key, ids: [...e.want] });
      }
    });

    const groups = new Map();
    evals.forEach((e) => {
      if (e.group < 0) return;
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e);
    });

    groups.forEach((members) => {
      asked += 1;
      const hits = members.filter((m) => m.overlap.length);
      if (!hits.length) {
        s -= Math.max(...members.map((m) => m.dim.weight)) * 0.35;
        missedDims.push({ dim: members[0].dim.key, ids: [...members[0].want] });
        return;
      }
      satisfied += 1;
      const best = hits.reduce((a, b) => (b.gain > a.gain ? b : a));
      // Matching both senses of the word is worth a little, not double.
      s += best.gain * (1 + 0.15 * (hits.length - 1));
      hits.forEach((m) => matchedDims.push({ dim: m.dim.key, ids: m.overlap }));
    });

    if (asked > 0 && satisfied === asked) s += 9;
    if (asked > 1 && satisfied === asked) s += asked * 3;

    // Place anchor.
    if (parsed.nearPlace) {
      asked += 1;
      const name = parsed.nearPlace.name.toLowerCase();
      const inPlace = String(project.city || '').toLowerCase() === name ||
                      String(project.neighborhood || '').toLowerCase() === name;
      if (inPlace) { s += 14; satisfied += 1; matchedDims.push({ dim: 'place', ids: [parsed.nearPlace.name] }); }
      else if (parsed.nearPlace.lat != null && project.lat != null) {
        // Not in the town, but how far outside it? "Near Germantown" should
        // still surface the job one street over the line.
        const d = Geo.milesBetween({ lat: parsed.nearPlace.lat, lng: parsed.nearPlace.lng }, { lat: project.lat, lng: project.lng });
        if (d !== null && d < 8) s += 9 * (1 - d / 8);
        else s -= 4;
      } else {
        s -= 4;
      }
    }

    // Years.
    if (parsed.years.length) {
      asked += 1;
      const y = projectYears(project);
      const wantLo = Math.min(...parsed.years);
      const wantHi = Math.max(...parsed.years);
      const overlaps = y.some((yy) => yy >= wantLo && yy <= wantHi);
      if (overlaps) { s += 10; satisfied += 1; matchedDims.push({ dim: 'year', ids: parsed.years.map(String) }); }
      else if (y.length) {
        const nearest = Math.min(...y.map((yy) => Math.min(Math.abs(yy - wantLo), Math.abs(yy - wantHi))));
        s -= Math.min(6, nearest * 2);
      } else {
        s -= 2;
      }
    }

    // Free words against the project's own text.
    if (parsed.free.length) {
      const hay = ctx.hay;
      parsed.free.forEach((w) => {
        // Tags first. The haystack already contains them, so checking it
        // first meant the {dim:'tag'} branch could never be reached and a
        // deliberate tag scored the same as a chance word in the notes.
        if (customTagHit(project, w)) { s += 4; matchedDims.push({ dim: 'tag', ids: [w] }); }
        else if (hay.includes(w)) { s += 3.5; matchedDims.push({ dim: 'text', ids: [w] }); }
        else if (w.length >= 4 && hay.includes(w.slice(0, Math.max(4, w.length - 2)))) s += 1.2;
      });
    }

    return { score: s, matchedDims, missedDims, hit: matchedDims.length > 0 };
  }

  function projectYears(project) {
    const out = [];
    [project.startedAt, project.completedAt].forEach((iso) => {
      if (!iso) return;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) out.push(d.getFullYear());
    });
    return out;
  }

  /* ---- run --------------------------------------------------------------
     `photosByProject` is a Map(projectId → photos[]), passed in rather than
     fetched so ranking stays synchronous and testable.                      */
  /* `isOwner` is not cosmetic here. Distance is measured from the coordinate
     the current viewer is allowed to see, so a prospect gets the distance to
     the blurred pin he is looking at and the contractor gets the real one.
     Measuring from the true coordinate and then drawing a blurred pin hands
     a stranger an exact radius around a customer's house. */
  function run(projects, parsed, here, photosByProject = new Map(), { isOwner = false } = {}) {
    indexRarity(projects);

    const scored = (projects || []).map((project) => {
      const photos = photosByProject.get(project.id) || [];
      const ctx = { hay: haystack(project, photos, isOwner), photos };
      const r = score(project, parsed, ctx);
      const coord = Geo.visibleCoord(project, isOwner);
      const miles = here && coord ? Geo.milesBetween(here, coord) : null;
      const pairs = (project.pairs || []).length;
      return { project, photos, pairCount: pairs, miles, ...r };
    });

    // "before and afters" is a filter, not a ranking nudge: asking for them
    // and being shown projects that have none is just wrong.
    let pool = parsed.wantPairs ? scored.filter((r) => r.pairCount > 0) : scored;
    /* Asking for before/afters when there are none is an empty answer, not
       a near miss. Falling through to the "closest work we have" branch
       below printed that banner over zero results. */
    if (parsed.wantPairs && !pool.length) return { results: [], cut: false, spotlight: null };

    if (parsed.isEmpty) {
      pool.sort((a, b) => {
        if (a.miles != null && b.miles != null) return a.miles - b.miles;
        if (a.miles != null) return -1;
        if (b.miles != null) return 1;
        return Date.parse(b.project.updated || 0) - Date.parse(a.project.updated || 0);
      });
      return { results: pool, cut: false, spotlight: null };
    }

    /* Keep anything that satisfied at least one thing the person asked for.
       Filtering on a positive total instead threw away partial matches that
       were the best answer available. */
    let keep = pool.filter((r) => r.hit);
    let cut = false;
    if (!keep.length) {
      keep = pool.slice().sort((a, b) => b.score - a.score).slice(0, 6);
      cut = true;
    }

    /* Within a band of comparable relevance, nearer wins. That is the whole
       "show me the closest one like this" behaviour.

       The band has to be a tier each result is assigned once, not a
       pairwise "are these two close enough" test. The pairwise version is
       not an ordering: A ties B on score so distance decides, B ties C the
       same way, and yet A and C are far enough apart that score decides
       between them. Array.prototype.sort given an inconsistent comparator
       is free to return anything, and did — the list reshuffled between two
       renders of the same results. */
    const BAND = 6;
    const tier = (r) => Math.round(r.score / BAND);
    const sortFn = (a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return tb - ta;
      if (a.miles != null && b.miles != null && a.miles !== b.miles) return a.miles - b.miles;
      if (a.miles == null && b.miles != null) return 1;
      if (a.miles != null && b.miles == null) return -1;
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.project.updated || 0) - Date.parse(a.project.updated || 0);
    };
    keep.sort(sortFn);

    /* "Closest thing I've got."

       Ask for a "seamless slate patio" when the only seamless slate in the
       book is a pool deck, and plain ranking is right to put the patios
       first — that is what was asked for. But the specific job then sits at
       rank six, and in a real book of hundreds it sits on page three, which
       is the same as not existing. So if the person named a RARE facet and
       nothing near the top satisfies it, pull up the best project that does
       and label it. Promotion beats reranking: nothing relevant is demoted,
       and the customer is told plainly it is not an exact match. */
    const RARE = 1.7;
    let spotlight = null;
    const head = new Set(keep.slice(0, 3).map((r) => r.project.id));
    for (const dim of ['pattern', 'color', 'feature', 'finish', 'material']) {
      const want = parsed.facets[dim];
      if (!want || !want.size) continue;
      const loose = (parsed.broad && parsed.broad[dim]) || null;
      const rareIds = [...want].filter((id) => rarityFor(dim, id) >= RARE && !(loose && loose.has(id)));
      if (!rareIds.length) continue;
      const satisfiedUpTop = keep.slice(0, 3).some((r) =>
        r.matchedDims.some((m) => m.dim === dim && m.ids.some((id) => rareIds.includes(id))));
      if (satisfiedUpTop) continue;
      const best = keep.find((r) => !head.has(r.project.id) &&
        r.matchedDims.some((m) => m.dim === dim && m.ids.some((id) => rareIds.includes(id))));
      if (best) {
        const ids = rareIds.filter((id) => best.matchedDims.some((m) => m.dim === dim && m.ids.includes(id)));
        spotlight = { entry: best, dim, ids };
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

    return { results: keep, cut, spotlight };
  }

  return { parse, run, normalise, buildPlaceIndex, haystack, indexRarity, projectYears, get rarityFor() { return rarityFor; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Search;
