/* ==========================================================================
   Urban Showroom — photo intelligence
   Built by Dive In Digital Marketing

   This is the file the brief is really about. "Photo integration should be
   treated as a core product capability, not an accessory. The value
   proposition depends heavily on reducing the manual work required to
   organize years of project photography."

   WHAT IS REAL HERE, AND WHAT IS NOT

   Be precise about this, because the brief says "AI analysis" and an honest
   engineer has to say which half of that exists today:

     REAL, running on the device, no model and no network:
       · where and when each photo was taken            (EXIF, exif.js)
       · which project a photo probably belongs to      (distance + date)
       · which photos show the same view                (perceptual hashing)
       · which are before, during and after             (capture-day ordering)
       · which before pairs with which after            (layout + time + structure)
       · a first-draft caption and tag set              (from the above + the
                                                         project's own facts)

     NOT REAL YET, and deliberately not faked:
       · recognising objects in a photograph — "that is a pergola" — which
         needs a vision model, which needs a server, which needs a key. A key
         in a public repo is not a shortcut, it is a leak.

   So the seam is explicit. `Vision` below is an interface with one
   implementation, `HeuristicVision`, built from what the device can actually
   compute. Swapping in a server-backed one later means writing a second
   object with the same three methods and assigning it to `Intel.vision`.
   Nothing else in the app changes.

   THE CONTRACTOR IS ALWAYS THE AUTHORITY

   Every function here returns a PROPOSAL carrying its confidence and the
   reasons behind it, never a decision. The brief says it twice — "suggested
   photos are presented for approval rather than automatically added" and
   "retain the contractor as the final authority" — and the reasons strings
   exist so he can tell a good guess from a bad one at a glance.
   ========================================================================== */
'use strict';

const Intel = (() => {
  const DAY = 86400000;
  const HOUR = 3600000;

  const ms = (iso) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return isNaN(t) ? null : t;
  };
  const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

  /* ======================================================================
     1. Which project does this photo belong to?
     ====================================================================== */

  /* Phone GPS lands within roughly 15–50 m outdoors, worse beside a house.
     Full credit inside 0.06 mi (about 320 ft, so a photo taken at the back
     of a deep lot still counts), fading to nothing by 0.4 mi. */
  function distanceScore(miles) {
    if (miles === null || miles === undefined || !isFinite(miles)) return null;
    if (miles <= 0.06) return 1;
    if (miles >= 0.4) return 0;
    return clamp01(1 - (miles - 0.06) / (0.4 - 0.06));
  }

  /* The window a project's photos plausibly fall in. Work happens before the
     completion date, so an end-dated project looks backwards further than it
     looks forwards. */
  function projectWindow(project) {
    const start = ms(project.startedAt);
    const end = ms(project.completedAt);
    if (start && end) return { from: start - 7 * DAY, to: end + 14 * DAY };
    if (end) return { from: end - 45 * DAY, to: end + 14 * DAY };
    if (start) return { from: start - 7 * DAY, to: start + 60 * DAY };
    return null;
  }

  function dateScore(takenMs, project) {
    if (!takenMs) return null;
    const w = projectWindow(project);
    if (!w) return null;
    if (takenMs >= w.from && takenMs <= w.to) return 1;
    const outBy = takenMs < w.from ? w.from - takenMs : takenMs - w.to;
    if (outBy >= 120 * DAY) return 0;
    return clamp01(1 - outBy / (120 * DAY));
  }

  /* Rank the projects a loose photo might belong to.

     The weighting is the interesting part. Location alone is strong but not
     conclusive: a contractor who repaved the same driveway twice in six
     years has two projects at one coordinate. Date alone is weak: he did
     four jobs that week. Together they are close to certain, so the combined
     score is allowed to reach 1 while either signal on its own is capped. */
  function suggestProjects(photo, projects, { limit = 4, floor = 0.25 } = {}) {
    const ex = (photo && photo.exif) || {};
    const takenMs = ms(ex.takenAt || photo.takenAt);
    const hasCoord = isFinite(ex.lat) && isFinite(ex.lng) && ex.lat !== null && ex.lng !== null;

    const out = [];
    (projects || []).forEach((project) => {
      if (!project || project.id === photo.projectId) return;

      const miles = hasCoord && project.lat != null && project.lng != null
        ? Geo.milesBetween({ lat: ex.lat, lng: ex.lng }, { lat: project.lat, lng: project.lng })
        : null;
      const ds = distanceScore(miles);
      const ts = dateScore(takenMs, project);

      let score = 0;
      const reasons = [];

      /* The reasons exist so the contractor can tell a good guess from a
         bad one, which means the evidence AGAINST a match has to appear
         too. A photo taken thirty miles away whose dates happen to overlap
         used to read "taken during this job" and nothing else, because the
         distance line was only printed when distance scored above zero. */
      const whereLine = () => {
        if (miles === null) return 'no location on the photo';
        if (miles < 0.02) return 'taken at this address';
        return `taken ${Geo.fmtMiles(miles)} from the address`;
      };
      const whenLine = () => {
        if (ts === null) return 'no date on the photo';
        if (ts === 1) return 'taken during this job';
        if (ts > 0.4) return 'taken near this job’s dates';
        return 'taken well outside this job’s dates';
      };

      if (ds !== null && ts !== null) {
        score = 0.62 * ds + 0.38 * ts;
        reasons.push(whereLine());
        reasons.push(whenLine());
      } else if (ds !== null) {
        score = Math.min(0.75, ds * 0.75);
        reasons.push(whereLine());
        reasons.push('no date on the photo');
      } else if (ts !== null) {
        score = Math.min(0.45, ts * 0.45);
        reasons.push(whenLine());
        // The photo may well have a fix; it is the JOB that has no pin.
        reasons.push(hasCoord ? 'this job has no pin to compare it with' : 'no location on the photo');
      } else {
        return;                              // nothing to go on
      }

      if (score >= floor) out.push({ projectId: project.id, project, score, miles, reasons });
    });

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  /* The label the UI puts on a confidence number. Deliberately three coarse
     buckets: a percentage would imply a precision this does not have. */
  function confidenceLabel(score) {
    if (score >= 0.78) return 'very likely';
    if (score >= 0.5) return 'likely';
    return 'possible';
  }

  /* ======================================================================
     2. Which photos show the same thing?
     ====================================================================== */

  /* Two photos are "the same view" when structure AND layout both agree.
     Either alone produces false groups: dHash alone matches any two photos
     of flat grey concrete, layout alone matches any two photos of a lawn. */
  function sameView(a, b, { hashMax = 12, layoutMax = 20 } = {}) {
    if (!a.hash || !b.hash || !a.layout || !b.layout) return false;
    // hamming() returns null when a hash is malformed, and `null <= 12` is
    // true, so an unreadable hash would otherwise read as a perfect match.
    const h = Imaging.hamming(a.hash, b.hash);
    if (h === null) return false;
    return h <= hashMax && Imaging.layoutDistance(a.layout, b.layout) <= layoutMax;
  }

  /* Single-linkage clustering over sameView. O(n²) on the comparison, which
     is fine: this runs over one project's photos, not the whole library, and
     n is tens. Union-find keeps the merge itself near-linear. */
  function clusterByView(photos, opts) {
    const list = (photos || []).filter((p) => p.hash && p.layout);
    const parent = new Map(list.map((p) => [p.id, p.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent.set(a, b); };

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (sameView(list[i], list[j], opts)) union(list[i].id, list[j].id);
      }
    }

    const groups = new Map();
    list.forEach((p) => {
      const root = find(p.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(p);
    });
    // Photos with no descriptors are each their own group, so nothing is lost.
    (photos || []).filter((p) => !p.hash || !p.layout).forEach((p) => groups.set(p.id, [p]));
    return [...groups.values()];
  }

  /* Exact-ish duplicates, which a camera roll is full of: three shots of the
     same thing two seconds apart. Offered for removal, never auto-deleted. */
  function findDuplicates(photos, { hashMax = 4, layoutMax = 8 } = {}) {
    const list = (photos || []).filter((p) => p.hash && p.layout);
    const dupes = [];
    const taken = new Set();
    for (let i = 0; i < list.length; i++) {
      if (taken.has(list[i].id)) continue;
      const group = [list[i]];
      for (let j = i + 1; j < list.length; j++) {
        if (taken.has(list[j].id)) continue;
        const h = Imaging.hamming(list[i].hash, list[j].hash);
        if (h !== null && h <= hashMax &&
            Imaging.layoutDistance(list[i].layout, list[j].layout) <= layoutMax) {
          group.push(list[j]);
          taken.add(list[j].id);
        }
      }
      if (group.length > 1) dupes.push(group);
    }
    return dupes;
  }

  /* ======================================================================
     3. Before, during, after
     ====================================================================== */

  /* Capture DAY, not a percentage of the elapsed span. A contractor shoots
     the existing driveway the day he quotes it, the pour on the day of the
     pour, and the finished slab a week later. Days are the natural unit of
     that story, and a percentage split puts a same-day pair in the wrong
     bucket the moment one job runs three months and another runs three days. */
  function inferStages(photos) {
    const dated = (photos || [])
      .map((p) => ({ p, t: ms((p.exif && p.exif.takenAt) || p.takenAt) }))
      .filter((r) => r.t !== null)
      .sort((a, b) => a.t - b.t);

    const out = new Map();
    if (!dated.length) return out;

    // Group into calendar days, using the local date so a 9pm pour does not
    // land on tomorrow.
    const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    const days = [];
    dated.forEach((r) => {
      const k = dayKey(r.t);
      const last = days[days.length - 1];
      if (last && last.key === k) last.rows.push(r);
      else days.push({ key: k, rows: [r] });
    });

    if (days.length === 1) {
      // One visit. Almost always a finished job being photographed, so call
      // it after — but weakly, and say why.
      days[0].rows.forEach((r) => out.set(r.p.id, { stage: 'after', confidence: 0.45, reason: 'all photos from one day' }));
      return out;
    }

    const first = days[0];
    const last = days[days.length - 1];
    const spanDays = Math.round((last.rows[0].t - first.rows[0].t) / DAY);

    first.rows.forEach((r) => out.set(r.p.id, {
      stage: 'before', confidence: spanDays >= 1 ? 0.7 : 0.5, reason: 'earliest day on this project'
    }));
    last.rows.forEach((r) => out.set(r.p.id, {
      stage: 'after', confidence: spanDays >= 1 ? 0.75 : 0.5, reason: 'latest day on this project'
    }));
    days.slice(1, -1).forEach((d) => d.rows.forEach((r) => out.set(r.p.id, {
      stage: 'during', confidence: 0.6, reason: 'mid-job day'
    })));

    return out;
  }

  /* ======================================================================
     4. Before / after pairs
     ====================================================================== */

  /* The hard one, and the reason there are two descriptors.

     A before and an after of the same driveway are deliberately NOT similar:
     the whole subject changed. What survives is the FRAME — the house in the
     corner, the tree line, the fence. That is layout.

     Meanwhile structural similarity has to sit in a middle band. Near zero
     means the two photos are the same moment, which is a duplicate and not a
     transformation. Near sixty means unrelated scenes. Somewhere between is
     "same place, different state", which is exactly what we are looking for. */
  function structureBandScore(h) {
    if (typeof h !== 'number' || !isFinite(h)) return 0;
    if (h <= 3) return 0;                       // same photograph twice
    if (h < 8) return (h - 3) / 5;              // ramp in
    if (h <= 30) return 1;                      // the band we want
    if (h < 46) return 1 - (h - 30) / 16;       // ramp out
    return 0;                                   // different scene
  }

  function pairScore(a, b) {
    if (!a.hash || !b.hash || !a.layout || !b.layout) return null;

    const ta = ms((a.exif && a.exif.takenAt) || a.takenAt);
    const tb = ms((b.exif && b.exif.takenAt) || b.takenAt);
    // Different stages means different moments. Without dates we cannot tell
    // a transformation from two angles of the same finished slab.
    if (ta === null || tb === null) return null;
    const gap = Math.abs(tb - ta);
    if (gap < 6 * HOUR) return null;

    const layout = Imaging.layoutDistance(a.layout, b.layout);
    const layoutScore = clamp01(1 - layout / 46);
    const h = Imaging.hamming(a.hash, b.hash);
    if (h === null) return null;                 // cannot compare, so do not guess
    const structure = structureBandScore(h);
    if (structure === 0 || layoutScore === 0) return null;

    // Same camera held the same way. Cheap, and a real signal that the
    // contractor stood in the same spot on purpose.
    const ra = a.width && a.height ? a.width / a.height : null;
    const rb = b.width && b.height ? b.width / b.height : null;
    const orientation = ra && rb ? clamp01(1 - Math.abs(ra - rb) / 0.6) : 0.5;

    // A longer gap is mild evidence of a real transformation rather than two
    // passes on the same afternoon.
    const gapBonus = gap >= DAY ? 1 : 0.6;

    const score = (0.52 * layoutScore + 0.30 * structure + 0.10 * orientation + 0.08 * gapBonus);
    return { score, layout, gap, layoutScore, structure };
  }

  /* Greedy one-to-one matching, best pairs first. Greedy rather than optimal
     because the contractor is confirming each one anyway, and a globally
     optimal assignment that shuffles a pair he already recognised is worse
     than a slightly suboptimal one that is stable. */
  function proposePairs(photos, { threshold = 0.5, existingPairs = [] } = {}) {
    const stages = inferStages(photos);
    const stageOf = (p) => p.stage || (stages.get(p.id) || {}).stage || null;

    const paired = new Set();
    existingPairs.forEach((pr) => { paired.add(pr.beforeId); paired.add(pr.afterId); });

    const befores = photos.filter((p) => ['before', 'during'].includes(stageOf(p)) && !paired.has(p.id));
    const afters = photos.filter((p) => stageOf(p) === 'after' && !paired.has(p.id));

    const candidates = [];
    befores.forEach((b) => {
      afters.forEach((a) => {
        const r = pairScore(b, a);
        if (r && r.score >= threshold) {
          candidates.push({ beforeId: b.id, afterId: a.id, before: b, after: a, ...r });
        }
      });
    });
    candidates.sort((x, y) => y.score - x.score);

    const used = new Set();
    const out = [];
    candidates.forEach((c) => {
      if (used.has(c.beforeId) || used.has(c.afterId)) return;
      used.add(c.beforeId); used.add(c.afterId);
      out.push({
        id: 'pair-' + c.beforeId + '-' + c.afterId,
        beforeId: c.beforeId,
        afterId: c.afterId,
        score: c.score,
        confidence: confidenceLabel(c.score),
        reason: describePair(c)
      });
    });
    return out;
  }

  function describePair(c) {
    const days = Math.round(c.gap / DAY);
    const when = days >= 1 ? `${days} day${days === 1 ? '' : 's'} apart` : 'hours apart';
    const framing = c.layout < 16 ? 'same framing' : c.layout < 30 ? 'similar framing' : 'roughly the same view';
    return `${framing}, ${when}`;
  }

  /* ======================================================================
     5. Captions and tags — the Vision seam
     ====================================================================== */

  /* Nearest colour in the project palette, by "redmean": a cheap weighted
     RGB distance that tracks human perception far better than plain
     Euclidean and costs nothing. */
  function nearestPaletteColor(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return null;
    const [r1, g1, b1] = rgb;
    let best = null, bestD = Infinity;
    COLORS.forEach((c) => {
      const hex = c.swatch.replace('#', '');
      const r2 = parseInt(hex.slice(0, 2), 16);
      const g2 = parseInt(hex.slice(2, 4), 16);
      const b2 = parseInt(hex.slice(4, 6), 16);
      const rm = (r1 + r2) / 2;
      const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
      const d = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best ? { id: best.id, label: best.label, distance: bestD } : null;
  }

  /* Contractors name files. "IMG_4821" says nothing, but "wilson patio
     stamped after.jpg" says plenty, and it costs one pass over the taxonomy
     to read it. */
  function tokensFromFilename(name) {
    const clean = String(name || '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_\-.]+/g, ' ')
      // "final" is NOT noise — it is one of the words that says a photo is
      // the finished shot, and stripping it here meant "driveway final.jpg"
      // came out with no stage at all.
      .replace(/\b(img|image|photo|pic|dsc|dscn|screenshot|copy|edit)\b/gi, ' ')
      .replace(/\b\d{3,}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!clean) return { facets: {}, stage: null, words: [] };

    const words = clean.split(' ').filter(Boolean);
    const facets = {};
    let stage = null;

    // Longest-phrase-first against the same index search uses, so filenames
    // and typed queries read the vocabulary identically.
    /* Stage words are checked BEFORE the facet index and across phrases,
       not after it and one word at a time. Both of those were wrong:
       "demo" and "tear out" were swallowed by the taxonomy as
       `feature:repair` so the stage branch never saw them, and every
       multi-word stage term ("in progress", "mid job", "tear out") was
       unreachable because only single words were tested. */
    const stageAt = (start) => {
      for (let n = Math.min(3, words.length - start); n >= 1; n--) {
        const phrase = words.slice(start, start + n).join(' ');
        const st = STAGES.find((x) => x.terms.includes(phrase));
        if (st) return { id: st.id, len: n };
      }
      return null;
    };

    let i = 0;
    while (i < words.length) {
      const st = stageAt(i);
      if (st) { stage = st.id; i += st.len; continue; }

      let hit = null, len = 0;
      const span = Math.min(TERM_INDEX.maxWords, words.length - i);
      for (let n = span; n >= 1; n--) {
        const phrase = words.slice(i, i + n).join(' ');
        const found = TERM_INDEX.idx.get(phrase);
        if (found) { hit = found; len = n; break; }
      }
      if (hit) {
        hit.forEach(({ dim, id }) => {
          if (!facets[dim]) facets[dim] = new Set();
          facets[dim].add(id);
        });
        i += len;
      } else {
        i += 1;
      }
    }
    return { facets, stage, words };
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---- the interface ----------------------------------------------------
     Three methods. Implement them against a server-side vision model and
     assign to `Intel.vision`; nothing else in the app has to change.       */
  const HeuristicVision = {
    name: 'on-device heuristics',

    /* A first-draft caption assembled only from things we actually know:
       the stage, the project's own facets, the dominant colour, and when it
       was taken. Never invents an object it cannot see. */
    caption(photo, project, opts = {}) {
      const bits = [];
      const stage = photo.stage || opts.stage;
      if (stage) bits.push(labelFor('stage', stage));

      const subject = [];
      if (project) {
        if (project.pattern) subject.push(labelFor('pattern', project.pattern).toLowerCase());
        if (project.type) subject.push(labelFor('type', project.type).toLowerCase());
      }
      if (subject.length) bits.push(subject.join(' '));

      const colors = (project && project.color) || [];
      if (colors.length) {
        const names = colors.slice(0, 2).map((c) => labelFor('color', c).toLowerCase());
        bits.push(names.join(' and '));
      } else if (photo.avgColor) {
        const near = nearestPaletteColor(photo.avgColor);
        if (near && near.distance < 120) bits.push(`${near.label.toLowerCase()} tones`);
      }

      const finishes = (project && project.finish) || [];
      if (finishes.length) bits.push(labelFor('finish', finishes[0]).toLowerCase());

      const where = project && (project.neighborhood || project.city);
      const takenAt = (photo.exif && photo.exif.takenAt) || photo.takenAt;
      const when = takenAt ? (() => {
        const d = new Date(takenAt);
        return isNaN(d.getTime()) ? null : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      })() : null;

      const head = bits.filter(Boolean).join(' — ');
      const tail = [where, when].filter(Boolean).join(', ');
      const text = [head, tail].filter(Boolean).join('. ');
      return text ? text.charAt(0).toUpperCase() + text.slice(1) + '.' : '';
    },

    /* Tags worth searching for later, drawn from the project's facets, the
       filename, and the dominant colour. Deduplicated, each carrying where
       it came from so the UI can show the weaker ones differently. */
    tags(photo, project, opts = {}) {
      const out = new Map();
      const add = (dim, id, source) => {
        if (!id) return;
        const key = dim + ':' + id;
        if (!out.has(key)) out.set(key, { dim, id, label: labelFor(dim, id), source });
      };

      if (project) {
        if (project.type) add('type', project.type, 'project');
        (Array.isArray(project.trade) ? project.trade : [project.trade]).forEach((t) => add('trade', t, 'project'));
        if (project.pattern) add('pattern', project.pattern, 'project');
        (project.material || []).forEach((m) => add('material', m, 'project'));
        (project.finish || []).forEach((f) => add('finish', f, 'project'));
        (project.color || []).forEach((c) => add('color', c, 'project'));
        (project.feature || []).forEach((f) => add('feature', f, 'project'));
      }

      const fromName = tokensFromFilename(opts.filename || photo.filename || '');
      Object.entries(fromName.facets).forEach(([dim, ids]) => ids.forEach((id) => add(dim, id, 'filename')));

      if (photo.avgColor) {
        const near = nearestPaletteColor(photo.avgColor);
        if (near && near.distance < 90) add('color', near.id, 'image');
      }

      return [...out.values()];
    },

    /* Stage, with its reason. Filename wins over timing, because a
       contractor who typed "after" in the name meant it. */
    stage(photo, contextPhotos, opts = {}) {
      const fromName = tokensFromFilename(opts.filename || photo.filename || '');
      if (fromName.stage) return { stage: fromName.stage, confidence: 0.85, reason: 'the filename says so' };
      const inferred = inferStages(contextPhotos || []);
      return inferred.get(photo.id) || { stage: null, confidence: 0, reason: 'no date to place it' };
    }
  };

  /* Swap this for a server-backed implementation when there is a server. */
  let vision = HeuristicVision;

  /* ======================================================================
     6. One call the import flow makes
     ====================================================================== */

  /* Given freshly imported photos and the existing projects, work out
     everything proposable in one pass so the review screen renders once. */
  /* Match first, THEN infer stages inside each job.

     This used to hand `inferStages` the entire import batch as context, so
     a sixty-photo drop covering eight jobs was read as one job: the
     earliest calendar day in the whole batch became "before", the latest
     became "after", and everything in between — most of it — came out
     "during". Measured on a synthetic eight-job batch it got 20 of 48
     right, labelled genuine finished shots "During", and found zero
     before/after pairs because almost nothing was left marked "after".
     Stage is a statement about one job's timeline. It has to be computed
     inside one job's photos. */
  function analyseImport(photos, projects) {
    const matched = (photos || []).map((photo) => {
      const suggestions = suggestProjects(photo, projects);
      return { photo, suggestions, best: suggestions[0] || null };
    });

    const groups = new Map();
    matched.forEach((m) => {
      const key = m.best ? m.best.projectId : '\u0000unfiled';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m.photo);
    });

    const context = new Map();
    groups.forEach((list) => list.forEach((ph) => context.set(ph.id, list)));

    return matched.map(({ photo, suggestions, best }) => {
      const project = best ? best.project : null;
      const stage = vision.stage(photo, context.get(photo.id) || [photo], { filename: photo.filename });
      const withStage = { ...photo, stage: stage.stage };
      return {
        photo,
        suggestions,
        bestProjectId: best ? best.projectId : null,
        bestScore: best ? best.score : 0,
        bestReasons: best ? best.reasons : [],
        confidence: best ? confidenceLabel(best.score) : null,
        stage: stage.stage,
        stageReason: stage.reason,
        caption: vision.caption(withStage, project, { stage: stage.stage }),
        tags: vision.tags(withStage, project, { filename: photo.filename })
      };
    });
  }

  return {
    // matching
    suggestProjects, distanceScore, dateScore, projectWindow, confidenceLabel,
    // grouping
    sameView, clusterByView, findDuplicates,
    // stages and pairs
    inferStages, proposePairs, pairScore, structureBandScore,
    // captions and tags
    nearestPaletteColor, tokensFromFilename, HeuristicVision,
    get vision() { return vision; },
    set vision(v) { vision = v || HeuristicVision; },
    // the import entry point
    analyseImport
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Intel;
