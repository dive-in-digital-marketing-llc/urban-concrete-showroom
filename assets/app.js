/* ==========================================================================
   Urban Showroom — application controller
   Built by Dive In Digital Marketing

   This file owns the customer-facing half of the app: loading the book of
   projects out of IndexedDB, running a typed description through the search
   engine, and putting the answer on screen three ways — as pins on a map, as
   a gallery, and as a wall of before/after sets.

   Two rules hold everywhere in here.

   1. `visibleProjects()` is the only place that decides what a viewer may
      see. Every render path draws from it. A privacy model with two gates
      has a hole in it within a month, so there is one gate.

   2. Every boot step survives its own failure. A contractor opens this in
      front of a paying customer on a job site with one bar of signal: a
      blocked tile server, a browser that refuses IndexedDB, a denied
      location prompt. None of those may leave a logo on a grey screen, so
      the splash comes down in a `finally` and each subsystem degrades on
      its own.
   ========================================================================== */
'use strict';

const App = (() => {
  const { $, $$, el, icon, ICONS } = UI;

  /* Example searches. These are the first thing a customer's thumb reaches
     for, so they are phrased the way a customer talks, not the way the
     taxonomy is keyed. */
  const EXAMPLES = [
    'stamped & colored driveway',
    'patio with black granite colored',
    'pool deck near me',
    'before and after',
    'outdoor kitchen',
    'acid stain garage floor',
    'broom finish walkway'
  ];

  const DEFAULT_PROFILE = {
    name: 'Urban Showroom',
    tagline: 'Baltz & Sons · Est. 1945',
    logo: 'img/logo.webp'
  };

  const state = {
    allProjects: [],          // everything in the store, unfiltered
    photosBy: new Map(),      // projectId -> photos[], sorted by order
    photoById: new Map(),
    collections: [],
    activeCollection: null,
    places: new Map(),
    query: '',
    parsed: null,
    results: [],
    cut: false,
    spotlight: null,
    anchor: null,             // what distances are measured from
    anchorLabel: '',
    here: null,               // the device's own position
    watchId: null,
    view: 'map',
    /* Which of the brief's four levels the person holding the phone is.
       Two of the four used to be dead settings: the app only ever asked
       'owner' or 'public', so a contractor who carefully marked a job
       "shareable with a client" had marked it invisible to everybody. The
       hand-over mode in the tools decides which of these a locked app
       shows, and it is the whole reason the middle two levels exist. */
    viewer: 'client',        // 'public' | 'client' | 'team' | 'owner'
    showAs: 'client',        // what locking the tools drops back to
    isOwner: false,
    activeId: null,
    picks: new Set(),         // projects hand-picked for a curated set
    profile: { ...DEFAULT_PROFILE },
    gallery: { photos: [], index: 0 },
    compare: null             // { projectId, pairs, i, split }
  };

  /* ======================================================================
     data
     ====================================================================== */

  /* The single visibility gate. `canView` orders the four levels; a viewer
     who is not the contractor sees only what has been published outward. */
  /* Everything this viewer is allowed to see. The visibility gate, and
     nothing else — a curated set narrows what is on SCREEN, it does not
     change what the viewer is permitted to see, and the contractor tools
     need the full permitted book while a set is open. */
  function permittedProjects() {
    return state.allProjects.filter((p) => Geo.canView(p, state.viewer));
  }

  /* What the current screen draws from: permitted, then narrowed to the
     curated set if one is open. */
  function visibleProjects() {
    const list = permittedProjects();
    const c = state.activeCollection;
    if (!c) return list;
    const want = new Set(c.projectIds || []);
    return list.filter((p) => want.has(p.id));
  }

  const photosOf = (projectId) => state.photosBy.get(projectId) || [];

  /* The cover is the photo a customer sees first, so it should be the
     finished work — an "after" beats a muddy "before" every time, whatever
     order the files happened to import in. */
  function coverOf(project) {
    const photos = photosOf(project.id);
    if (!photos.length) return null;
    if (project.coverPhotoId) {
      const named = photos.find((p) => p.id === project.coverPhotoId);
      if (named) return named;
    }
    return photos.find((p) => p.stage === 'after') || photos[0];
  }

  /* A pair whose photo has since been deleted is not a pair. Resolving
     through the photo map on read means a delete never has to walk every
     project's pair list to stay consistent. */
  function pairsOf(project) {
    return (project.pairs || [])
      .map((pr) => ({
        ...pr,
        before: state.photoById.get(pr.beforeId) || null,
        after: state.photoById.get(pr.afterId) || null
      }))
      .filter((pr) => pr.before && pr.after);
  }

  async function load() {
    const [projects, photos, collections] = await Promise.all([
      Store.allProjects(), Store.allPhotos(), Store.allCollections()
    ]);

    state.allProjects = projects;
    state.photosBy = new Map();
    state.photoById = new Map();

    photos.forEach((ph) => {
      state.photoById.set(ph.id, ph);
      if (!ph.projectId) return;
      if (!state.photosBy.has(ph.projectId)) state.photosBy.set(ph.projectId, []);
      state.photosBy.get(ph.projectId).push(ph);
    });
    state.photosBy.forEach((list) => list.sort((a, b) => (a.order || 0) - (b.order || 0)));

    /* Every rendered photo pins a blob URL in the imaging registry, keyed
       by photo id. Nothing released them, so deleting a project — or
       restoring a backup — left a decoded 1600px image alive for the life
       of the tab, and a reused id would serve the OLD bytes. Reconcile the
       registry against what actually exists on every load. */
    const live = new Set();
    state.photoById.forEach((_, id) => { live.add(id); live.add(`${id}:t`); });
    Imaging.releaseExcept(live, (k) => !String(k).startsWith('imp:'));

    state.collections = collections.sort((a, b) =>
      String(b.updated || '').localeCompare(String(a.updated || '')));

    // A collection whose projects have been deleted should not strand the app
    // on an empty screen with no way back.
    if (state.activeCollection) {
      const fresh = state.collections.find((c) => c.id === state.activeCollection.id);
      state.activeCollection = fresh || null;
    }
  }

  /* Called by the contractor tools after any write. */
  async function reload({ keepQuery = true } = {}) {
    await load();
    if (!keepQuery) setQuery('');
    runSearch();
    renderView();
    updateBanners();
  }

  /* ======================================================================
     search
     ====================================================================== */

  function setQuery(q) {
    state.query = String(q || '');
    const box = $('#q');
    if (box && box.value !== state.query) box.value = state.query;
    $('#searchClear').hidden = !state.query;
  }

  /* Distances are measured from one anchor, and the anchor is explained on
     screen. "2.1 mi" is a lie if the customer thinks it means from here and
     it actually means from Germantown. */
  function resolveAnchor(parsed) {
    if (parsed && parsed.nearPlace && !parsed.nearMe &&
        parsed.nearPlace.lat != null && parsed.nearPlace.lng != null) {
      return {
        anchor: { lat: parsed.nearPlace.lat, lng: parsed.nearPlace.lng },
        label: `from ${parsed.nearPlace.name}`
      };
    }
    if (state.here) return { anchor: state.here, label: 'from where you are' };
    return { anchor: null, label: '' };
  }

  function runSearch() {
    const pool = visibleProjects();
    state.places = Search.buildPlaceIndex(pool);

    const parsed = Search.parse(state.query, { places: state.places });
    const { anchor, label } = resolveAnchor(parsed);
    state.parsed = parsed;
    state.anchor = anchor;
    state.anchorLabel = label;

    const out = Search.run(pool, parsed, anchor, state.photosBy, { isOwner: state.isOwner });
    state.results = out.results.map((r) => ({ ...r, cover: coverOf(r.project) }));
    state.cut = out.cut;
    state.spotlight = out.spotlight;

    if (parsed.nearMe && !state.here) requestLocation({ quiet: true });
  }

  /* What the app understood, said back in plain words. A search box that
     silently drops half of what you typed feels broken; showing the parse
     turns a miss into something the customer can correct. */
  function renderParsed() {
    const box = $('#parsed');
    box.innerHTML = '';
    const p = state.parsed;
    if (!p || p.isEmpty) { box.hidden = true; return; }
    box.hidden = false;

    /* Say it back in the customer's words. "colored" expands internally to
       four different ways of putting colour in a slab; echoing "Integral
       color · Color hardener · Acid stain" at someone who typed "colored"
       reads like the app misheard them. The family gets one chip, spelled
       the way they spelled it. */
    const covered = {};
    (p.families || []).forEach(({ dim, ids }) => {
      if (!covered[dim]) covered[dim] = new Set();
      ids.forEach((id) => covered[dim].add(id));
    });

    const chips = [];
    (p.families || []).forEach(({ phrase }) => chips.push(UI.customTag(titleCase(phrase))));
    ['type', 'trade', 'pattern', 'material', 'finish', 'color', 'feature'].forEach((dim) => {
      const set = p.facets[dim];
      if (!set) return;
      [...set].forEach((id) => {
        if (covered[dim] && covered[dim].has(id)) return;
        chips.push(UI.facetTag(dim, id, { small: true }));
      });
    });
    p.years.forEach((y) => chips.push(UI.customTag(String(y))));
    if (p.nearPlace) chips.push(UI.customTag(p.nearPlace.name));
    if (p.nearMe) chips.push(UI.customTag('near me'));
    if (p.wantPairs) chips.push(UI.customTag('before / after'));
    p.free.forEach((w) => chips.push(el('span', { class: 'tagv free', text: w })));

    if (!chips.length) { box.hidden = true; return; }
    box.appendChild(el('span', { class: 'parsed-lbl', text: 'Looking for' }));
    chips.forEach((c) => box.appendChild(c));
  }

  /* ======================================================================
     views
     ====================================================================== */

  function setView(view) {
    if (view === 'map' && !ShowroomMap.available) view = 'grid';
    state.view = view;
    $('#gridPane').hidden = view !== 'grid';
    $('#pairsPane').hidden = view !== 'pairs';
    document.body.classList.toggle('view-map', view === 'map');
    document.body.classList.toggle('view-grid', view === 'grid');
    document.body.classList.toggle('view-pairs', view === 'pairs');

    [['#vsMap', 'map'], ['#vsGrid', 'grid'], ['#vsPairs', 'pairs']].forEach(([sel, v]) => {
      const b = $(sel);
      if (!b) return;
      b.classList.toggle('on', v === view);
      b.setAttribute('aria-selected', v === view ? 'true' : 'false');
    });

    if (view === 'map') ShowroomMap.invalidate();
    renderView();
  }

  function renderView() {
    renderParsed();
    renderCollectionBar();
    measureHead();
    refreshOpenSurfaces();
    renderSheet();
    if (state.view === 'grid') renderGrid();
    if (state.view === 'pairs') renderPairWall();
    if (state.view === 'map') {
      ShowroomMap.draw(state.results, {
        isOwner: state.isOwner,
        activeId: state.activeId,
        here: state.here,
        dimUnmatched: !(state.parsed && state.parsed.isEmpty)
      });
    }
  }

  /* Whatever is open on top has to follow the data too. Only `setOwner`
     ever re-opened the detail, so renaming a job from the pencil left the
     old name on screen, adding a photo left the gallery reading "1 / 1",
     and deleting the project the detail was showing left its ghost up with
     `activeId` pointing at a record that no longer existed. */
  let refreshing = false;
  function refreshOpenSurfaces() {
    if (refreshing) return;                    // openDetail calls renderView
    const id = state.activeId;
    if (id && detailIsOpen()) {
      const still = state.allProjects.find((p) => p.id === id);
      if (!still || !Geo.canView(still, state.viewer)) {
        closeDetail();
      } else {
        refreshing = true;
        try { openDetail(id); } finally { refreshing = false; }
      }
    }
    if (compareIsOpen() && state.compare) {
      const project = state.allProjects.find((p) => p.id === state.compare.projectId);
      const pairs = project && Geo.canView(project, state.viewer) ? pairsOf(project) : [];
      if (!pairs.length) { closeCompare(); return; }
      // The pair list was a snapshot taken when the slider opened.
      state.compare.pairs = pairs;
      state.compare.i = Math.min(state.compare.i, pairs.length - 1);
      paintCompare();
    }
  }

  function countLabel(n) {
    if (!n) return 'Nothing yet';
    return `${n} ${n === 1 ? 'project' : 'projects'}`;
  }

  function renderSheet() {
    const body = $('#sheetBody');
    body.innerHTML = '';

    $('#sheetCount').textContent = countLabel(state.results.length);
    const bits = [];
    if (state.cut) bits.push('no exact match — closest work we have');
    else if (state.anchorLabel) bits.push(`nearest first ${state.anchorLabel}`);
    if (state.picks.size) bits.push(`${state.picks.size} picked`);
    $('#sheetSub').textContent = bits.join(' · ');
    $('#btnSaveCollection').hidden = !state.results.length;

    if (!state.results.length) {
      body.appendChild(emptyForNoResults());
      return;
    }

    const frag = document.createDocumentFragment();
    state.results.forEach((entry, i) => {
      frag.appendChild(UI.projectCard(entry, {
        isOwner: state.isOwner,
        onOpen: openDetail,
        first: i === 0 && entry.miles != null
      }));
    });
    body.appendChild(frag);
  }

  function emptyForNoResults() {
    const total = visibleProjects().length;
    if (!total && state.activeCollection) {
      return UI.emptyState({
        title: 'This set is empty',
        body: 'Every project in it has been removed or hidden.',
        actions: [UI.button('Show everything', { kind: 'solid', onClick: clearCollection })]
      });
    }
    if (!total) {
      return UI.emptyState({
        title: state.isOwner ? 'No projects yet' : 'Nothing published yet',
        body: state.isOwner
          ? 'Add your first job, or drop in a batch of photos and let the app sort them into projects.'
          : 'The showroom is being set up.',
        actions: state.isOwner
          ? [UI.button('Add photos', { kind: 'solid', icon: ICONS.camera, onClick: () => Owner.importPhotos() }),
             UI.button('New project', { icon: ICONS.plus, onClick: () => Owner.editProject(null) })]
          : []
      });
    }
    return UI.emptyState({
      title: 'Nothing matched that',
      body: 'Try fewer words — "stamped driveway" finds more than "stamped charcoal ashlar driveway with a border".',
      actions: [UI.button('Show everything', { onClick: () => { setQuery(''); runSearch(); renderView(); } })]
    });
  }

  /* The sheet is the map view's header, and it is hidden in the other two.
     Without this the count and "Save set" vanish exactly when a contractor
     is flicking through the gallery in front of a customer — which is the
     moment he wants to save the set. */
  function paneHead(host) {
    const bits = [];
    if (state.cut) bits.push('closest work we have');
    else if (state.anchorLabel) bits.push(`nearest first ${state.anchorLabel}`);
    if (state.picks.size) bits.push(`${state.picks.size} picked`);

    const head = el('div', { class: 'panehead' }, [
      el('span', { class: 'sheet-count', text: countLabel(state.results.length) }),
      el('span', { class: 'sheet-sub', text: bits.join(' \u00b7 ') }),
      state.results.length
        ? el('button', { class: 'sheet-act', type: 'button', text: 'Save set', onclick: saveCurrentAsCollection })
        : null
    ]);
    host.appendChild(head);
  }

  function renderGrid() {
    const pane = $('#gridPane');
    // Remove the WRAPPER, not the head inside it. Removing the inner node
    // and inserting a fresh wrapper left an empty 12px-margin div behind on
    // every render — and renderView() runs on every GPS tick, so a
    // contractor driving with location on walked the gallery down the
    // screen one gap at a time.
    const stale = pane.querySelector('.panehead-wrap');
    if (stale) stale.remove();
    const grid = $('#grid');
    grid.innerHTML = '';
    if (!state.results.length) { grid.appendChild(emptyForNoResults()); return; }
    pane.insertBefore(el('div', { class: 'panehead-wrap' }, []), grid);
    paneHead(pane.querySelector('.panehead-wrap'));
    const frag = document.createDocumentFragment();
    state.results.forEach((entry) => {
      frag.appendChild(UI.galleryTile(entry, { isOwner: state.isOwner, onOpen: openDetail }));
    });
    grid.appendChild(frag);
  }

  /* The before/after wall. This is the view a contractor swipes to when a
     customer says "what did it look like before?" — every pair in the
     current result set, largest first, one tap to full screen. */
  function renderPairWall() {
    const pane = $('#pairsPane');
    const stale = pane.querySelector('.panehead-wrap');
    if (stale) stale.remove();
    const wall = $('#pairWall');
    wall.innerHTML = '';

    const rows = [];
    state.results.forEach((entry) => {
      pairsOf(entry.project).forEach((pair) => rows.push({ entry, pair }));
    });

    if (!rows.length) {
      wall.appendChild(UI.emptyState({
        title: 'No before/after sets in these results',
        body: state.isOwner
          ? 'Import the before photos alongside the finished ones and the app proposes the pairs for you to confirm.'
          : 'Try another search, or ask us — we have them for most jobs.',
        actions: state.isOwner
          ? [UI.button('Review pair suggestions', { kind: 'solid', icon: ICONS.swap, onClick: () => Owner.reviewPairs() })]
          : [UI.button('Show everything', { onClick: () => { setQuery(''); runSearch(); renderView(); } })]
      }));
      return;
    }

    pane.insertBefore(el('div', { class: 'panehead-wrap' }, []), wall);
    paneHead(pane.querySelector('.panehead-wrap'));

    const frag = document.createDocumentFragment();
    rows.forEach(({ entry, pair }) => {
      frag.appendChild(el('button', {
        class: 'pairtile', type: 'button',
        onclick: () => openCompare(entry.project.id, pair.id)
      }, [
        el('div', { class: 'pt-imgs' }, [
          el('div', { class: 'pt-half' }, [
            UI.photoImg(pair.before, { thumb: true, alt: 'Before' }),
            el('span', { class: 'pt-lbl', text: 'Before' })
          ]),
          el('div', { class: 'pt-half' }, [
            UI.photoImg(pair.after, { thumb: true, alt: 'After' }),
            el('span', { class: 'pt-lbl', text: 'After' })
          ])
        ]),
        el('div', { class: 'pt-cap' }, [
          el('span', { class: 'pt-title', text: entry.project.name }),
          el('span', {
            class: 'pt-meta',
            text: [entry.project.city, UI.fmtRange(entry.project)].filter(Boolean).join(' · ')
          })
        ])
      ]));
    });
    wall.appendChild(frag);
  }

  /* ======================================================================
     project detail
     ====================================================================== */

  function openDetail(id) {
    const project = state.allProjects.find((p) => p.id === id);
    if (!project) return;
    if (!Geo.canView(project, state.viewer)) return;

    state.activeId = id;
    const entry = state.results.find((r) => r.project.id === id) || {
      project, photos: photosOf(id), miles: null
    };
    const photos = photosOf(id);

    $('#dEdit').hidden = !state.isOwner;
    $('#dEyebrow').textContent = [
      labelFor('type', project.type),
      labelFor('trade', primaryTrade(project))
    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    $('#dTitle').textContent = project.name;
    $('#dLede').textContent = project.notes || '';
    $('#dLede').hidden = !project.notes;

    renderGallery(photos, project);
    renderDistanceRow(project, entry);
    renderPairStrip(project);
    renderSpec(project);
    renderDetailActions(project);
    renderStages(photos, project);

    const d = $('#detail');
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    $('#detailScroll').scrollTop = 0;
    if (state.view === 'map') ShowroomMap.focus(project, { isOwner: state.isOwner });
    renderView();
  }

  function closeDetail() {
    const d = $('#detail');
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
    state.activeId = null;
    renderView();
  }

  const detailIsOpen = () => $('#detail').classList.contains('open');

  function renderGallery(photos, project) {
    const track = $('#galTrack');
    const dots = $('#galDots');
    track.innerHTML = '';
    dots.innerHTML = '';
    state.gallery = { photos, index: 0 };

    if (!photos.length) {
      track.appendChild(el('div', { class: 'gal-slide' }, [
        el('div', { class: 'nophoto tall', text: 'No photos on this project yet' })
      ]));
      $('#galCount').textContent = '';
      return;
    }

    photos.forEach((ph, i) => {
      track.appendChild(el('div', { class: 'gal-slide' }, [
        UI.photoImg(ph, { alt: ph.caption || project.name, eager: i === 0 }),
        ph.stage ? el('span', { class: `gal-stage st-${ph.stage}`, text: labelFor('stage', ph.stage) }) : null,
        ph.caption ? el('span', { class: 'gal-cap', text: ph.caption }) : null
      ]));
      dots.appendChild(el('button', {
        class: `dot${i === 0 ? ' on' : ''}`, type: 'button',
        'aria-label': `Photo ${i + 1}`,
        onclick: () => scrollGalleryTo(i)
      }));
    });
    $('#galCount').textContent = `1 / ${photos.length}`;
    track.scrollLeft = 0;
  }

  function scrollGalleryTo(i) {
    const track = $('#galTrack');
    const slide = track.children[i];
    if (slide) track.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });
  }

  function onGalleryScroll() {
    const track = $('#galTrack');
    const n = state.gallery.photos.length;
    if (!n || !track.clientWidth) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / track.clientWidth)));
    if (i === state.gallery.index) return;
    state.gallery.index = i;
    $$('#galDots .dot').forEach((d, j) => d.classList.toggle('on', j === i));
    $('#galCount').textContent = `${i + 1} / ${n}`;
  }

  function renderDistanceRow(project, entry) {
    const row = $('#dDist');
    row.innerHTML = '';
    const dist = Geo.fmtMiles(entry.miles);
    const coord = Geo.visibleCoord(project, state.isOwner);

    row.appendChild(el('div', { class: 'dist-main' }, [
      dist
        ? el('span', { class: 'dist-n' }, [icon(ICONS.pin, 13, 2.4), document.createTextNode(`${dist} ${state.anchorLabel || 'away'}`)])
        : el('span', { class: 'dist-n muted', text: 'Turn on location to see how far away this is' }),
      el('span', { class: 'dist-addr', text: Geo.visibleAddress(project, state.isOwner) })
    ]));

    if (!state.isOwner && coord && !coord.exact) {
      row.appendChild(el('p', {
        class: 'dist-note',
        text: 'This is a private home, so the pin shows the block rather than the house. Please look from the street.'
      }));
    }
  }

  function renderPairStrip(project) {
    const host = $('#dPairs');
    host.innerHTML = '';
    const pairs = pairsOf(project);
    if (!pairs.length) return;

    host.appendChild(el('h3', { class: 'sec-h', text: pairs.length === 1 ? 'Before and after' : `${pairs.length} before/after sets` }));
    const strip = el('div', { class: 'pairstrip' });
    pairs.forEach((pair) => {
      strip.appendChild(el('button', {
        class: 'ps-item', type: 'button',
        onclick: () => openCompare(project.id, pair.id)
      }, [
        el('span', { class: 'ps-imgs' }, [
          UI.photoImg(pair.before, { thumb: true, alt: 'Before' }),
          UI.photoImg(pair.after, { thumb: true, alt: 'After' })
        ]),
        el('span', { class: 'ps-go' }, [icon(ICONS.swap, 13, 2.4), document.createTextNode('Slide to compare')])
      ]));
    });
    host.appendChild(strip);
  }

  function renderSpec(project) {
    const spec = $('#dSpec');
    spec.innerHTML = '';

    const rows = [];
    const when = UI.fmtRange(project);
    if (when) rows.push(['Built', el('span', { class: 'spec-v', text: when })]);

    [['type', 'Type'], ['trade', 'Trade'], ['material', 'Material'],
      ['pattern', 'Pattern'], ['finish', 'Finish'], ['color', 'Color'], ['feature', 'Features']
    ].forEach(([dim, label]) => {
      const raw = dim === 'trade' ? [...tradeSet(project)] : project[dim];
      const vals = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!vals.length) return;
      rows.push([label, el('span', { class: 'spec-v' }, vals.map((v) => UI.facetTag(dim, v)))]);
    });

    if ((project.tags || []).length) {
      rows.push(['Tags', el('span', { class: 'spec-v' }, project.tags.map((t) => UI.customTag(t)))]);
    }

    const area = [project.neighborhood, project.city, project.state].filter(Boolean).join(', ');
    if (area) rows.push(['Area', el('span', { class: 'spec-v', text: area })]);

    if (state.isOwner) {
      rows.push(['Visibility', el('span', { class: 'spec-v' }, [
        el('span', {
          class: `vis vis-${project.visibility || 'private'}`,
          text: Geo.VISIBILITY_LABEL[project.visibility] || 'Private'
        })
      ])]);
    }

    rows.forEach(([label, node]) => {
      spec.appendChild(el('div', { class: 'spec-row' }, [
        el('span', { class: 'spec-k', text: label }), node
      ]));
    });
  }

  function renderDetailActions(project) {
    const bar = $('#dActions');
    bar.innerHTML = '';
    const coord = Geo.visibleCoord(project, state.isOwner);
    const pairs = pairsOf(project);

    if (pairs.length) {
      bar.appendChild(UI.button('Before / after', {
        kind: 'solid', icon: ICONS.swap, onClick: () => openCompare(project.id, pairs[0].id)
      }));
    }

    if (coord) {
      /* Four decimals, not five. The href is the one place a coarsened
         coordinate appears as copyable text, and there is no reason to
         hand out more precision than the pin itself carries. The label is
         honest too: for a customer this navigates to the block, and a
         button that says "Directions" and stops 200 yards short of the
         address is quietly wrong. */
      const exact = state.isOwner && project.address;
      const dest = exact
        ? encodeURIComponent(project.address)
        : `${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`;
      bar.appendChild(el('a', {
        class: 'btn btn-ghost',
        href: `https://www.google.com/maps/dir/?api=1&destination=${dest}`,
        target: '_blank', rel: 'noopener noreferrer'
      }, [icon(ICONS.compass, 16, 2.2), document.createTextNode(exact ? 'Directions' : 'Drive to the block')]));
    }

    const picked = state.picks.has(project.id);
    bar.appendChild(UI.button(picked ? 'In this set' : 'Add to a set', {
      kind: picked ? 'on' : 'ghost',
      icon: picked ? ICONS.check : ICONS.plus,
      onClick: () => togglePick(project.id)
    }));

    if (state.isOwner) {
      bar.appendChild(UI.button('Photos', {
        icon: ICONS.camera, onClick: () => Owner.importPhotos({ projectId: project.id })
      }));
    }
  }

  /* Photos grouped by stage. A customer reading top to bottom sees the job
     the way it happened. */
  function renderStages(photos, project) {
    const host = $('#dStages');
    host.innerHTML = '';
    if (photos.length < 2) return;

    const groups = [
      ['before', 'Before'],
      ['during', 'During the build'],
      ['after', 'Finished'],
      [null, 'More photos']
    ];

    groups.forEach(([stage, label]) => {
      const list = photos.filter((p) => (stage ? p.stage === stage : !p.stage));
      if (!list.length) return;
      host.appendChild(el('h3', { class: 'sec-h', text: label }));
      host.appendChild(el('div', { class: 'stagerow' }, list.map((ph, i) => el('button', {
        class: 'stg-item', type: 'button',
        onclick: () => scrollGalleryTo(photos.indexOf(ph)),
        'aria-label': ph.caption || `${label} photo ${i + 1}`
      }, [
        UI.photoImg(ph, { thumb: true, alt: ph.caption || project.name })
      ]))));
    });
  }

  /* ======================================================================
     before / after presentation mode
     ====================================================================== */

  function openCompare(projectId, pairId) {
    const project = state.allProjects.find((p) => p.id === projectId);
    // Safe today only because every caller passes an id that already came
    // through the gate. "Safe because of who calls it" is how a gate ends
    // up with a hole in it, so it checks for itself.
    if (!project || !Geo.canView(project, state.viewer)) return;
    const pairs = pairsOf(project);
    if (!pairs.length) return;
    const i = Math.max(0, pairs.findIndex((p) => p.id === pairId));

    state.compare = { projectId, pairs, i, split: 50 };
    paintCompare();

    const c = $('#compare');
    compareReturn = document.activeElement;
    c.classList.add('open');
    c.setAttribute('aria-hidden', 'false');
    // The detail underneath is covered; hide it from assistive tech too, or
    // a Tab out of the slider walks into a screen nobody can see.
    $('#detail').setAttribute('aria-hidden', 'true');
    document.body.classList.add('presenting');
    setTimeout(() => { try { $('#cHandle').focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
  }

  let compareReturn = null;

  function paintCompare() {
    const c = state.compare;
    if (!c) return;
    const pair = c.pairs[c.i];
    const project = state.allProjects.find((p) => p.id === c.projectId);

    $('#cBefore').src = UI.photoSrc(pair.before) || '';
    $('#cAfter').src = UI.photoSrc(pair.after) || '';
    $('#cTitle').textContent = project ? project.name : '';

    const foot = $('#cFoot');
    foot.innerHTML = '';
    const when = [UI.fmtDate(pair.before.exif && pair.before.exif.takenAt, { long: true }),
      UI.fmtDate(pair.after.exif && pair.after.exif.takenAt, { long: true })].filter(Boolean);
    foot.appendChild(el('span', {
      class: 'cf-when',
      text: when.length === 2 ? `${when[0]} → ${when[1]}` : (project ? UI.fmtRange(project) : '')
    }));
    if (c.pairs.length > 1) {
      foot.appendChild(el('span', { class: 'cf-n', text: `${c.i + 1} / ${c.pairs.length}` }));
      foot.appendChild(UI.button('Next set', {
        small: true,
        onClick: () => { state.compare.i = (state.compare.i + 1) % state.compare.pairs.length; paintCompare(); }
      }));
    }
    setSplit(c.split);
  }

  function closeCompare() {
    const c = $('#compare');
    c.classList.remove('open');
    c.setAttribute('aria-hidden', 'true');
    if (detailIsOpen()) $('#detail').setAttribute('aria-hidden', 'false');
    document.body.classList.remove('presenting');
    state.compare = null;
    const back = compareReturn;
    compareReturn = null;
    if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }

  const compareIsOpen = () => $('#compare').classList.contains('open');

  /* The clip is a clip-path, not a width. Both images stay full size and
     perfectly registered, so the seam is exactly where the handle is even
     when the two photos have different aspect ratios. */
  function setSplit(pct) {
    const v = Math.max(0, Math.min(100, pct));
    if (state.compare) state.compare.split = v;
    $('#cClip').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
    const h = $('#cHandle');
    h.style.left = `${v}%`;
    const shown = Math.round(v);
    h.setAttribute('aria-valuenow', String(shown));
    // "27" on its own tells a screen-reader user nothing about what it is.
    h.setAttribute('aria-valuetext', `${shown}% before, ${100 - shown}% after`);
  }

  /* This is the full-screen view a contractor turns toward a paying
     customer, so it gets the careful version.

     Three things were wrong with the first cut. The drag started anywhere
     on the stage, so a customer tapping the photograph wiped the image.
     `stop` was bound only to the stage, so on any browser that refuses
     pointer capture — the `catch` swallowed the failure — releasing
     outside left `dragging` true and the seam then followed the bare
     cursor for ever. And `preventDefault` on pointerdown suppressed the
     focus it would otherwise have given the handle, so the keyboard path
     was reachable only by tabbing to it. */
  function wireCompareDrag() {
    const stage = $('#cStage');
    const handle = $('#cHandle');
    let dragging = false;
    let pointer = null;

    const at = (clientX) => {
      const r = stage.getBoundingClientRect();
      if (!r.width) return;
      setSplit(((clientX - r.left) / r.width) * 100);
    };

    const stop = () => {
      if (!dragging) return;
      dragging = false;
      if (pointer !== null) {
        try { handle.releasePointerCapture(pointer); } catch (err) { /* already gone */ }
        pointer = null;
      }
    };

    // A drag begins on the handle and nowhere else.
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      pointer = e.pointerId;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
      handle.focus({ preventScroll: true });
      at(e.clientX);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => { if (dragging) at(e.clientX); });
    handle.addEventListener('lostpointercapture', stop);

    // Belt and braces for the browsers that never granted the capture: a
    // release anywhere in the window ends the drag.
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);

    // A deliberate tap elsewhere on the stage still jumps the seam. `click`
    // never fires at the end of a drag, so the two cannot be confused.
    stage.addEventListener('click', (e) => {
      if (dragging || e.target === handle || handle.contains(e.target)) return;
      at(e.clientX);
    });

    // Keyboard, because this is the one control a customer is handed and it
    // has to work for someone who cannot drag.
    handle.addEventListener('keydown', (e) => {
      const cur = state.compare ? state.compare.split : 50;
      const step = e.shiftKey ? 10 : 2;
      const set = (v) => { setSplit(v); e.preventDefault(); };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(cur - step);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(cur + step);
      else if (e.key === 'Home') set(0);
      else if (e.key === 'End') set(100);
      else if (e.key === 'PageDown') set(cur - 10);
      else if (e.key === 'PageUp') set(cur + 10);
    });
  }

  /* ======================================================================
     curated sets
     ====================================================================== */

  function togglePick(id) {
    if (state.picks.has(id)) state.picks.delete(id); else state.picks.add(id);
    if (detailIsOpen() && state.activeId) {
      const p = state.allProjects.find((x) => x.id === state.activeId);
      if (p) renderDetailActions(p);
    }
    // renderSheet only writes #sheetSub, which is hidden in the gallery and
    // before/after views, so the count never appeared there.
    if (state.view === 'map') renderSheet(); else renderView();
    UI.toast(state.picks.size
      ? `${state.picks.size} picked — "Save set" in the list to name it`
      : 'Nothing picked');
  }

  function saveCurrentAsCollection() {
    let saving = false;
    const usingPicks = state.picks.size > 0;
    const ids = usingPicks ? [...state.picks] : state.results.map((r) => r.project.id);
    if (!ids.length) { UI.toast('Nothing to save yet.'); return; }

    const nameInput = UI.input('collName', {
      value: state.query ? titleCase(state.query) : '',
      placeholder: 'Outdoor kitchens for the Harts',
      maxlength: 60
    });
    const noteInput = UI.textarea('collNote', {
      placeholder: 'Anything to remember about this customer (optional)',
      maxlength: 300
    });

    UI.showModal('Save this set', el('div', {}, [
      el('p', { class: 'modal-lede', text: `${ids.length} ${ids.length === 1 ? 'project' : 'projects'}${usingPicks ? ' you picked' : ' from this search'}. Saved sets open in one tap, so you can walk into a meeting with the right work already lined up.` }),
      UI.field('Name this set', nameInput, { required: true }),
      UI.field('Note', noteInput)
    ]), [
      UI.button('Cancel', { onClick: UI.closeModal }),
      UI.button('Save set', {
        kind: 'solid',
        onClick: async () => {
          if (saving) return;                  // a second tap is not a second set
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); UI.toast('Give the set a name.'); return; }
          saving = true;
          const now = new Date().toISOString();
          await Store.putCollection({
            id: Store.uid('c'), name, note: noteInput.value.trim(),
            projectIds: ids, query: state.query, created: now, updated: now
          });
          state.picks.clear();
          UI.closeModal();
          await load();
          renderView();
          UI.toast(`Saved "${name}"`);
        }
      })
    ]);
    setTimeout(() => nameInput.focus(), 60);
  }

  function openSetsMenu() {
    const body = el('div', {});
    if (!state.collections.length) {
      body.appendChild(el('p', {
        class: 'modal-lede',
        text: 'No saved sets yet. Search for the work a customer cares about, then tap "Save set" in the results list.'
      }));
    } else {
      const list = el('div', { class: 'setlist' });
      state.collections.forEach((c) => {
        list.appendChild(el('div', { class: 'setrow' }, [
          el('button', {
            class: 'setrow-main', type: 'button',
            onclick: () => { UI.closeModal(); openCollection(c.id); }
          }, [
            el('span', { class: 'setrow-name', text: c.name }),
            el('span', {
              class: 'setrow-meta',
              text: [`${(c.projectIds || []).length} projects`, c.note].filter(Boolean).join(' · ')
            })
          ]),
          UI.armedButton('Delete', 'Sure?', async () => {
            await Store.deleteCollection(c.id);
            if (state.activeCollection && state.activeCollection.id === c.id) state.activeCollection = null;
            await load();
            UI.closeModal();
            runSearch();
            renderView();
            UI.toast('Set deleted');
          })
        ]));
      });
      body.appendChild(list);
    }
    UI.showModal('Saved sets', body, [UI.button('Close', { onClick: UI.closeModal })]);
  }

  function openCollection(id) {
    const c = state.collections.find((x) => x.id === id);
    if (!c) return;
    state.activeCollection = c;
    setQuery('');
    runSearch();
    renderView();
    fitToResults();
    UI.toast(`Showing "${c.name}"`);
  }

  function clearCollection() {
    state.activeCollection = null;
    runSearch();
    renderView();
    fitToResults();
  }

  function renderCollectionBar() {
    const bar = $('#collBar');
    if (!bar) return;
    const c = state.activeCollection;
    bar.hidden = !c;
    if (!c) return;
    $('#collBarName').textContent = c.name;
    $('#collCount').textContent = `${state.results.length} of ${(c.projectIds || []).length}`;
  }

  function titleCase(s) {
    return String(s).replace(/\s+/g, ' ').trim()
      .replace(/^\w/, (m) => m.toUpperCase());
  }

  /* ======================================================================
     location
     ====================================================================== */

  /* The button toggles. Everything else starts. Conflating the two meant
     `runSearch`'s "they asked for near me, so switch location on" call hit
     the toggle branch on every debounced keystroke: clearWatch, null out
     `state.here`, start again. Three watches for one query, and a slow
     first fix — the job-site case — could never land. */
  function toggleLocation() {
    if (state.watchId !== null) { stopLocation(); return; }
    requestLocation();
  }

  function requestLocation({ quiet = false } = {}) {
    if (state.watchId !== null) return;        // already watching
    if (!navigator.geolocation) {
      if (!quiet) UI.toast('This device will not share a location.');
      return;
    }
    const btn = $('#btnLocate');
    btn.classList.add('busy');

    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        btn.classList.remove('busy');
        btn.classList.add('on');
        btn.setAttribute('aria-pressed', 'true');
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const moved = !state.here || Geo.milesBetween(state.here, next) > 0.03;
        state.here = next;
        if (!moved) return;
        runSearch();
        renderView();
        if (!quiet) { fitToResults(); UI.toast('Sorted by how close it is to you.'); quiet = true; }
      },
      (err) => {
        btn.classList.remove('busy', 'on');
        btn.setAttribute('aria-pressed', 'false');
        state.watchId = null;
        if (quiet) return;
        UI.toast(err && err.code === 1
          ? 'Location is switched off for this app. Distances are hidden until you allow it.'
          : 'Could not get a location right now.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
    );
  }

  function stopLocation() {
    if (state.watchId !== null) {
      try { navigator.geolocation.clearWatch(state.watchId); } catch (e) { /* ignore */ }
      state.watchId = null;
    }
    state.here = null;
    const btn = $('#btnLocate');
    btn.classList.remove('on', 'busy');
    btn.setAttribute('aria-pressed', 'false');
    runSearch();
    renderView();
  }

  function fitToResults() {
    if (state.view !== 'map') return;
    ShowroomMap.fit(state.results, { isOwner: state.isOwner, here: state.here });
  }

  /* ======================================================================
     owner mode
     ====================================================================== */

  async function setOwner(on) {
    state.isOwner = !!on;
    state.viewer = state.isOwner ? 'owner' : (state.showAs || 'client');
    document.body.classList.toggle('owner', state.isOwner);
    $('#btnAdd').hidden = !state.isOwner;
    $('#btnOwner').setAttribute('aria-pressed', state.isOwner ? 'true' : 'false');
    $('#btnOwner').classList.toggle('on', state.isOwner);
    runSearch();
    renderView();
    updateBanners();
  }

  /* What a locked app shows when the phone is handed over. */
  async function setShowAs(level) {
    if (!Geo.VISIBILITY.includes(level) || level === 'private') return;
    state.showAs = level;
    try { await Store.meta('show-as', level); } catch (e) { /* advisory */ }
    if (!state.isOwner) {
      state.viewer = level;
      runSearch();
      renderView();
    }
  }

  /* ======================================================================
     first run
     ====================================================================== */

  /* Seed once, and record that we did. A contractor who deletes the samples
     must not find them back the next morning, which is exactly what a
     "seed when the store is empty" check would do. */
  async function seedIfEmpty() {
    try {
      const already = await Store.meta('seeded-v2');
      if (already) return;
      const existing = await Store.allProjects();
      if (existing.length) { await Store.meta('seeded-v2', new Date().toISOString()); return; }

      const res = await fetch('data/seed.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const book = await res.json();
      if (!book || !Array.isArray(book.projects)) return;

      for (const p of book.projects) await Store.putProject(p);
      await Store.putPhotos(book.photos || []);
      await Store.meta('seeded-v2', new Date().toISOString());
    } catch (e) {
      // No samples is a worse first impression than a broken app, but not by
      // much. Either way the app still opens.
    }
  }

  async function applyProfile() {
    let saved = null;
    try { saved = await Store.meta('profile'); } catch (e) { /* ignore */ }
    state.profile = { ...DEFAULT_PROFILE, ...(saved || {}) };
    try {
      const mode = await Store.meta('show-as');
      if (mode && Geo.VISIBILITY.includes(mode) && mode !== 'private') {
        state.showAs = mode;
        if (!state.isOwner) state.viewer = mode;
      }
    } catch (e) { /* the default is the safe one */ }
    $('#brandName').textContent = state.profile.name;
    $('#brandSub').textContent = state.profile.tagline;
    $('#splashSub').textContent = state.profile.tagline;
    document.title = `${state.profile.name} — ${state.profile.tagline}`;
    if (state.profile.logo) {
      $('#brandLogo').src = state.profile.logo;
    }
  }

  async function updateBanners() {
    const anyDemo = state.allProjects.some((p) => p.demo);
    const dismissed = sessionStorage.getItem('demo-dismissed') === '1';
    $('#demoBanner').hidden = !anyDemo || dismissed || !state.allProjects.length;

    let msg = '';
    if (Store.isDegraded) {
      msg = 'This browser will not store photos here — private mode, most likely. Anything you add now is lost when you close the tab.';
    } else {
      try {
        const u = await Store.usage();
        if (u.quota && u.used / u.quota > 0.85) {
          msg = `Storage is ${Math.round((u.used / u.quota) * 100)}% full (${UI.fmtBytes(u.used)}). Export a backup and clear out old jobs.`;
        }
      } catch (e) { /* estimate is advisory */ }
    }
    const bar = $('#storageBanner');
    if (msg && sessionStorage.getItem('storage-dismissed') !== '1') {
      $('#storageMsg').textContent = msg;
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
    measureHead();
  }

  function renderChips() {
    const row = $('#chips');
    row.innerHTML = '';
    EXAMPLES.forEach((t) => {
      row.appendChild(el('button', {
        class: 'chip', type: 'button', text: t,
        onclick: () => { setQuery(t); runSearch(); renderView(); fitToResults(); }
      }));
    });
  }

  /* ======================================================================
     wiring
     ====================================================================== */

  function wire() {
    const box = $('#q');
    const go = () => { runSearch(); renderView(); fitToResults(); };
    const debounced = UI.debounce(() => { runSearch(); renderView(); }, 180);

    box.addEventListener('input', () => { setQuery(box.value); debounced(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); box.blur(); go(); }
    });
    $('#searchGo').addEventListener('click', () => { box.blur(); go(); });
    $('#searchClear').addEventListener('click', () => { setQuery(''); go(); box.focus(); });

    $$('.viewswitch .vs').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    const sets = $('#btnSets');
    if (sets) sets.addEventListener('click', openSetsMenu);
    const collClear = $('#collClear');
    if (collClear) collClear.addEventListener('click', clearCollection);

    $('#btnLocate').addEventListener('click', () => toggleLocation());
    $('#btnSaveCollection').addEventListener('click', saveCurrentAsCollection);
    $('#brandBtn').addEventListener('click', showAbout);

    $('#btnOwner').addEventListener('click', () => Owner.toggle());
    $('#btnAdd').addEventListener('click', () => Owner.addMenu());
    $('#dEdit').addEventListener('click', () => {
      if (state.activeId) Owner.editProject(state.activeId);
    });

    $('#dClose').addEventListener('click', closeDetail);
    $('#cClose').addEventListener('click', closeCompare);
    $('#galTrack').addEventListener('scroll', onGalleryScroll, { passive: true });
    wireCompareDrag();

    $('#modalClose').addEventListener('click', UI.closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') UI.requestClose(); });

    $('#demoDismiss').addEventListener('click', () => {
      sessionStorage.setItem('demo-dismissed', '1');
      $('#demoBanner').hidden = true;
      measureHead();
    });
    $('#storageDismiss').addEventListener('click', () => {
      sessionStorage.setItem('storage-dismissed', '1');
      $('#storageBanner').hidden = true;
      measureHead();
    });

    wireSheet();

    /* One Escape handler, innermost surface first. Three competing handlers
       is how Escape ends up closing the whole detail view when the customer
       only meant to shut a dialog. */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (UI.modalIsOpen()) { UI.requestClose(); return; }
      if (compareIsOpen()) { closeCompare(); return; }
      if (detailIsOpen()) { closeDetail(); }
    });

    ShowroomMap.on('click', () => { if (detailIsOpen()) closeDetail(); });
    window.addEventListener('resize', UI.debounce(() => { ShowroomMap.invalidate(); measureHead(); }, 200));
    window.addEventListener('orientationchange', () => setTimeout(measureHead, 260));
  }

  /* The sheet has three heights: peeking, half and full. A drag feels native
     on a phone; the click and the keyboard path exist because the grab bar
     is also the only control some people can reach. */
  function wireSheet() {
    const sheet = $('#sheet');
    const grab = $('#sheetGrab');
    const steps = ['peek', 'half', 'full'];
    let at = 1;

    const apply = () => {
      steps.forEach((s) => sheet.classList.toggle(`sh-${s}`, s === steps[at]));
      grab.setAttribute('aria-expanded', at > 0 ? 'true' : 'false');
      ShowroomMap.invalidate();
    };
    apply();

    const move = (dir) => { at = Math.max(0, Math.min(steps.length - 1, at + dir)); apply(); };

    // A click always follows a pointerup, so a drag that moved the sheet
    // must suppress the tap that would otherwise move it again.
    grab.addEventListener('click', () => {
      if (dragged) { dragged = false; return; }
      at = at >= steps.length - 1 ? 0 : at + 1;
      apply();
    });
    grab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { move(1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { move(-1); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { at = at >= steps.length - 1 ? 0 : at + 1; apply(); e.preventDefault(); }
    });

    /* The drag needs pointer capture. Both listeners were on the 20px-tall
       grab bar with no capture and a 26px threshold, so exceeding the
       threshold meant leaving the element — which is where it stopped
       hearing about the gesture. It has never once fired; only the tap
       path worked. */
    let startY = null;
    let held = null;
    let dragged = false;
    grab.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      held = e.pointerId;
      try { grab.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
    });
    const release = (e) => {
      if (startY === null) return;
      const dy = startY - e.clientY;
      startY = null;
      if (held !== null) {
        try { grab.releasePointerCapture(held); } catch (err) { /* already gone */ }
        held = null;
      }
      if (Math.abs(dy) > 20) { dragged = true; move(dy > 0 ? 1 : -1); }
    };
    grab.addEventListener('pointerup', release);
    grab.addEventListener('pointercancel', () => { startY = null; held = null; });
    // Capture can be refused. Without a window-level release the gesture is
    // never completed on those browsers, which is the whole reason the
    // original version of this never fired at all.
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', () => { startY = null; held = null; });
  }

  function showAbout() {
    const p = state.profile;
    UI.showModal(p.name, el('div', {}, [
      el('p', { class: 'modal-lede', text: `Every job ${p.tagline.split('·')[0].trim()} has finished, on a map. Describe the work you are thinking about and the closest one we have built comes up first — drive past it, look at it in daylight, then decide.` }),
      el('p', { class: 'modal-lede small', text: 'These are private homes. Pins show the block, not the house, and we ask that you look from the street.' }),
      el('p', { class: 'modal-lede small', text: 'Built by Dive In Digital Marketing.' })
    ]), [UI.button('Close', { kind: 'solid', onClick: UI.closeModal })]);
  }

  /* The header stack is not a fixed height and never was: the search text
     wraps, a notice appears, a curated set opens a bar. Everything below it
     is absolutely positioned, so a hard-coded padding is a promise the
     header keeps breaking — the sample-data notice sat straight on top of
     the first row of the gallery. Measure it instead and let the CSS read
     the number. */
  let headObserver = null;
  function measureHead() {
    const stack = ['.topbar', '.searchwrap', '.railrow', '#collBar', '#demoBanner', '#storageBanner'];
    let bottom = 0;
    stack.forEach((sel) => {
      const n = $(sel);
      if (!n || n.hidden || !n.offsetParent) return;
      bottom = Math.max(bottom, n.getBoundingClientRect().bottom);
    });
    if (bottom > 0) document.documentElement.style.setProperty('--head-h', `${Math.round(bottom)}px`);
  }

  function watchHead() {
    measureHead();
    if (typeof ResizeObserver !== 'function' || headObserver) return;
    headObserver = new ResizeObserver(() => measureHead());
    ['.topbar', '.searchwrap', '.railrow', '#collBar', '#demoBanner', '#storageBanner']
      .forEach((sel) => { const n = $(sel); if (n) headObserver.observe(n); });
  }

  function dismissSplash() {
    const s = $('#splash');
    if (!s) return;
    s.classList.add('gone');
    setTimeout(() => { s.style.display = 'none'; }, 520);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline is a bonus, not a requirement */ });
  }

  /* ======================================================================
     boot
     ====================================================================== */

  async function boot() {
    try {
      wire();
      renderChips();

      try { await applyProfile(); } catch (e) { /* the default brand is fine */ }
      try { await seedIfEmpty(); } catch (e) { /* ditto */ }
      try { await load(); } catch (e) { state.allProjects = []; }

      try {
        ShowroomMap.init('map', { onSelect: openDetail });
      } catch (e) { /* the fallback notice is already drawn */ }

      if (!ShowroomMap.available) {
        const tab = $('#vsMap');
        if (tab) tab.hidden = true;
      }

      try { await Owner.init(); } catch (e) { /* contractor tools are optional to the customer */ }

      runSearch();
      setView(ShowroomMap.available ? 'map' : 'grid');
      fitToResults();
      await updateBanners();
      watchHead();
      registerSW();
      Store.requestPersistence();
    } catch (e) {
      UI.toast('Something went wrong starting up. Pull down to reload.');
      if (typeof console !== 'undefined') console.error(e);
    } finally {
      dismissSplash();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  /* The surface the contractor tools drive.

     `projects` returns what the CURRENT viewer may see, not everything in
     the store. It used to return the unfiltered list, which made
     `App.projects` a one-line read of every private job's exact address
     from any console. That is not a real defence — the records are in this
     device's IndexedDB and `Store` is reachable too — but the product's
     core motion is handing the phone to a customer, and there is no reason
     to leave the whole book sitting behind a short, obvious name. The
     honest part of the fix is in the copy: the tools no longer tell the
     contractor nobody else can see this. */
  const gate = (p) => p && Geo.canView(p, state.viewer);

  return {
    reload, load, runSearch, renderView, updateBanners, applyProfile,
    openDetail, closeDetail, setOwner, setShowAs, setQuery, setView, fitToResults,
    coverOf, visibleProjects, permittedProjects,
    photosOf: (id) => (gate(state.allProjects.find((p) => p.id === id)) ? photosOf(id) : []),
    pairsOf: (project) => (gate(project) ? pairsOf(project) : []),
    get state() { return state; },
    get isOwner() { return state.isOwner; },
    get showAs() { return state.showAs; },
    get here() { return state.here; },
    get projects() { return permittedProjects(); }
  };
})();
