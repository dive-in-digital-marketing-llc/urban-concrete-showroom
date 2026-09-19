/* ==========================================================================
   Urban Showroom — storage
   Built by Dive In Digital Marketing

   IndexedDB, three stores, one migration.

     projects     the address-centred master record the brief asks for
     photos       many per project, holding Blobs and their descriptors
     collections  a curated set built for one prospect
     meta         PIN, company profile, flags

   WHY BLOBS AND NOT data: URLs

   v1 stored every photo as a data URL. That is a JavaScript string the
   engine must hold whole, costs a third more bytes than the binary, and puts
   a real photo book past quota inside a few dozen jobs. IndexedDB stores
   Blobs natively and hands them back without ever materialising a string.

   WHY THE MIGRATION MATTERS

   Somebody may already have real jobs in v1 on their phone. The upgrade runs
   inside the versionchange transaction, reads the old `jobs` store, and
   rewrites each record as a project plus its photos. A migration that
   silently drops a contractor's work is the worst bug this app could have,
   so it is written to be lossy in only one direction: unknown fields are
   carried across untouched rather than discarded.

   EVERYTHING HERE FAILS SOFT

   Private-mode Safari can hang opening a database rather than refuse it, and
   a device with no quota throws on write. Every call resolves; nothing here
   rejects into a UI that has no handler.
   ========================================================================== */
'use strict';

const Store = (() => {
  const DB_NAME = 'ucs-baltz';          // unchanged from v1 so data migrates
  const DB_VERSION = 2;
  const S_PROJECTS = 'projects';
  const S_PHOTOS = 'photos';
  const S_COLLECTIONS = 'collections';
  const S_META = 'meta';
  const S_JOBS_V1 = 'jobs';

  let db = null;
  let opening = null;
  let degraded = false;                  // true once we fall back to memory
  let lateDb = null;                     // a database that arrived after we gave up

  /* A last-resort in-memory store. Keeps the app usable for the length of a
     session on a device that refuses IndexedDB, and the UI warns that
     nothing will survive a reload. */
  const memory = { projects: new Map(), photos: new Map(), collections: new Map(), meta: new Map() };

  const uid = (p) => (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---- schema ----------------------------------------------------------- */
  function createSchema(idb) {
    if (!idb.objectStoreNames.contains(S_PROJECTS)) {
      idb.createObjectStore(S_PROJECTS, { keyPath: 'id' });
    }
    if (!idb.objectStoreNames.contains(S_PHOTOS)) {
      const s = idb.createObjectStore(S_PHOTOS, { keyPath: 'id' });
      s.createIndex('byProject', 'projectId', { unique: false });
    }
    if (!idb.objectStoreNames.contains(S_COLLECTIONS)) {
      idb.createObjectStore(S_COLLECTIONS, { keyPath: 'id' });
    }
    if (!idb.objectStoreNames.contains(S_META)) {
      idb.createObjectStore(S_META, { keyPath: 'k' });
    }
  }

  /* ---- v1 → v2 ----------------------------------------------------------
     v1 records were "jobs": one row carrying its own photos inline as data
     URLs, a single `service` string and a boolean `privacy`.                */
  const V1_SERVICE_TO_TRADE = {
    'stamped-concrete': ['decorative-concrete', 'concrete'],
    'stained-concrete': ['decorative-concrete', 'concrete'],
    'concrete-patios': ['concrete'],
    'concrete-driveways': ['concrete'],
    'pool-decks': ['pools', 'concrete'],
    'outdoor-living': ['outdoor-living'],
    'concrete-paving': ['concrete'],
    masonry: ['masonry'],
    'epoxy-flake-floors': ['flooring'],
    'polished-concrete-floors': ['flooring', 'decorative-concrete'],
    'commercial-concrete': ['commercial', 'concrete'],
    'concrete-countertops': ['concrete']
  };
  const V1_SURFACE_TO_TYPE = {
    driveway: 'driveway', patio: 'patio', 'pool-deck': 'pool-deck', walkway: 'walkway',
    steps: 'steps', porch: 'porch', 'garage-floor': 'garage-floor',
    'interior-floor': 'interior-floor', countertop: 'countertop',
    'outdoor-kitchen': 'outdoor-kitchen', wall: 'retaining-wall',
    firepit: 'firepit', 'parking-lot': 'parking-lot', slab: 'slab'
  };

  function migrateJob(job) {
    const services = Array.isArray(job.service) ? job.service : job.service ? [job.service] : [];
    const trade = [];
    services.forEach((s) => (V1_SERVICE_TO_TRADE[s] || []).forEach((t) => { if (!trade.includes(t)) trade.push(t); }));

    const project = {
      // Carry unknown v1 fields across rather than dropping them.
      ...job,
      id: job.id,
      name: job.title || 'Untitled project',
      address: job.address || '',
      lat: job.lat == null ? null : job.lat,
      lng: job.lng == null ? null : job.lng,
      city: job.city || '',
      state: job.state || '',
      neighborhood: job.neighborhood || '',
      type: V1_SURFACE_TO_TYPE[job.surface] || job.surface || '',
      trade,
      material: [],
      pattern: job.pattern || '',
      finish: Array.isArray(job.finish) ? job.finish : [],
      color: Array.isArray(job.color) ? job.color : [],
      feature: Array.isArray(job.feature) ? job.feature : [],
      tags: [],
      notes: job.description || '',
      completedAt: job.year ? `${job.year}-12-31T12:00:00.000Z` : null,
      startedAt: null,
      // v1's boolean meant "protect the address". Everything in v1 was shown
      // in the showroom, so the visibility that preserves behaviour is public
      // with the address still protected.
      visibility: 'public',
      /* Always false, whatever the v1 `privacy` flag said. v1's flag was
         "hide this pin"; v2's is "publish this house number", and carrying
         one across as the other pushed a real street address into the
         public showroom on upgrade. The safe direction is the only
         defensible default for a field nobody has been asked about. */
      exactAddress: false,
      coverPhotoId: null,
      pairs: [],
      demo: !!job.demo,
      schema: 2,
      created: job.created || new Date().toISOString(),
      updated: new Date().toISOString()
    };
    delete project.title;
    delete project.service;
    delete project.surface;
    delete project.description;
    delete project.year;
    delete project.privacy;
    delete project.photos;

    const photos = (Array.isArray(job.photos) ? job.photos : []).map((p, i) => {
      const src = typeof p === 'string' ? p : (p && p.src) || '';
      return {
        id: uid('p'),
        projectId: job.id,
        url: src,                 // v1 photos were paths or data URLs, not Blobs
        blob: null,
        thumbBlob: null,
        width: (p && p.w) || null,
        height: (p && p.h) || null,
        bytes: null,
        hash: null,
        layout: null,
        avgColor: null,
        exif: { lat: null, lng: null, takenAt: null, make: '', model: '' },
        dateSource: null,
        stage: null,
        stageSource: null,
        caption: '',
        captionSource: null,
        tags: [],
        order: i,
        demo: !!job.demo,
        created: new Date().toISOString()
      };
    });
    if (photos.length) project.coverPhotoId = photos[0].id;
    return { project, photos };
  }

  /* ---- open -------------------------------------------------------------
     Resolves to the database, or null once we have decided to run on the
     in-memory fallback.                                                     */
  /* Once we have fallen back to memory, a database that turns up late must
     not simply take over. It used to: the 3s timeout resolved `open()` with
     null, writes went to the `memory` Maps and reported success, then
     `req.onsuccess` set `db`, and the very next call returned the real
     database — with none of those writes in it. The contractor got "Saved
     12 photos", reloaded, and had nothing. Worse, the now-empty store let
     `seedIfEmpty` put the 32 demo projects back on top.

     So a late database is adopted only after everything written while we
     were degraded has been flushed into it. Until that flush finishes,
     `open()` keeps returning null and reads and writes stay on the same
     copy of the data. */
  let flushing = null;

  function adoptLate(idb) {
    if (flushing) return flushing;
    const rows = [
      [S_PROJECTS, [...memory.projects.values()]],
      [S_PHOTOS, [...memory.photos.values()]],
      [S_COLLECTIONS, [...memory.collections.values()]],
      [S_META, [...memory.meta.values()]]
    ].filter(([, list]) => list.length);

    flushing = new Promise((res) => {
      if (!rows.length) { db = idb; degraded = false; return res(idb); }
      try {
        const tx = idb.transaction(rows.map(([n]) => n), 'readwrite');
        rows.forEach(([name, list]) => {
          const os = tx.objectStore(name);
          list.forEach((v) => { const rq = os.put(v); rq.onerror = (e) => { e.preventDefault(); }; });
        });
        const finish = (ok) => {
          if (!ok) return res(null);           // stay in memory; nothing is lost
          memory.projects.clear(); memory.photos.clear();
          memory.collections.clear(); memory.meta.clear();
          db = idb;
          degraded = false;
          res(idb);
        };
        tx.oncomplete = () => finish(true);
        tx.onerror = () => finish(false);
        tx.onabort = () => finish(false);
      } catch (e) { res(null); }
    });
    return flushing;
  }

  function open() {
    if (db) return Promise.resolve(db);
    if (lateDb && degraded) return adoptLate(lateDb);
    if (opening) return opening;

    opening = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { degraded = true; return resolve(null); }

      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { degraded = true; return resolve(null); }

      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };

      req.onupgradeneeded = (ev) => {
        const idb = req.result;
        const tx = req.transaction;
        const hadV1 = idb.objectStoreNames.contains(S_JOBS_V1);

        createSchema(idb);

        if (hadV1 && ev.oldVersion < 2) {
          try {
            const jobs = tx.objectStore(S_JOBS_V1);
            const projects = tx.objectStore(S_PROJECTS);
            const photos = tx.objectStore(S_PHOTOS);
            /* Every put gets its own error handler that calls
               preventDefault(). Without it an asynchronous failure on one
               row — quota is the realistic one, and this migration has to
               hold two copies of the photo book at once — aborts the whole
               versionchange transaction. The version then rolls back, so
               the same doomed upgrade runs again on every launch and the
               contractor sees an empty app forever with his data still on
               disk. The old try/catch only ever caught synchronous throws,
               which is not how IndexedDB reports a full disk. */
            const soft = (rq) => { if (rq) rq.onerror = (e) => { e.preventDefault(); }; return rq; };
            const all = jobs.getAll();
            all.onerror = (e) => { e.preventDefault(); };
            all.onsuccess = () => {
              (all.result || []).forEach((job) => {
                if (!job || !job.id) return;
                try {
                  const { project, photos: ps } = migrateJob(job);
                  soft(projects.put(project));
                  ps.forEach((pp) => soft(photos.put(pp)));
                } catch (e) { /* skip one bad row rather than fail the upgrade */ }
              });
              // The old store is left in place on purpose. If anything about
              // the migration turns out wrong, the original rows are still
              // there to re-read; dropping them would make it unrecoverable.
            };
          } catch (e) { /* no v1 data to carry */ }
        }
      };

      req.onsuccess = () => {
        const idb = req.result;
        idb.onversionchange = () => { try { idb.close(); } catch (e) {} db = null; lateDb = null; };
        if (settled) {
          // We already gave up and handed callers the memory fallback.
          // Park it; the next open() flushes into it before adopting it.
          lateDb = idb;
          return;
        }
        db = idb;
        done(db);
      };
      req.onerror = () => { degraded = true; done(null); };
      req.onblocked = () => { degraded = true; done(null); };

      // Private-mode Safari has historically hung here rather than erroring.
      setTimeout(() => { if (!settled) { degraded = true; done(null); } }, 3000);
    });

    return opening;
  }

  /* ---- generic helpers -------------------------------------------------- */
  function memStore(name) {
    return name === S_PROJECTS ? memory.projects
      : name === S_PHOTOS ? memory.photos
        : name === S_COLLECTIONS ? memory.collections
          : memory.meta;
  }

  async function getAll(name) {
    const idb = await open();
    if (!idb) return [...memStore(name).values()];
    return new Promise((res) => {
      try {
        const rq = idb.transaction(name, 'readonly').objectStore(name).getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => res([]);
      } catch (e) { res([]); }
    });
  }

  async function get(name, key) {
    const idb = await open();
    if (!idb) return memStore(name).get(key) || null;
    return new Promise((res) => {
      try {
        const rq = idb.transaction(name, 'readonly').objectStore(name).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }

  async function put(name, value) {
    const idb = await open();
    if (!idb) { memStore(name).set(value.id || value.k, value); return { ok: true, degraded: true }; }
    return new Promise((res) => {
      try {
        const tx = idb.transaction(name, 'readwrite');
        tx.objectStore(name).put(value);
        tx.oncomplete = () => res({ ok: true });
        tx.onerror = () => res({ ok: false, error: tx.error && tx.error.name });
        tx.onabort = () => res({ ok: false, error: (tx.error && tx.error.name) || 'AbortError' });
      } catch (e) { res({ ok: false, error: e.name }); }
    });
  }

  /* One transaction for a batch. Importing forty photos as forty separate
     transactions is both slow and only atomic per row. */
  async function putMany(name, values) {
    if (!values || !values.length) return { ok: true, count: 0 };
    const idb = await open();
    if (!idb) { values.forEach((v) => memStore(name).set(v.id || v.k, v)); return { ok: true, count: values.length, degraded: true }; }
    return new Promise((res) => {
      try {
        const tx = idb.transaction(name, 'readwrite');
        const os = tx.objectStore(name);
        values.forEach((v) => os.put(v));
        tx.oncomplete = () => res({ ok: true, count: values.length });
        tx.onerror = () => res({ ok: false, error: tx.error && tx.error.name });
        tx.onabort = () => res({ ok: false, error: (tx.error && tx.error.name) || 'AbortError' });
      } catch (e) { res({ ok: false, error: e.name }); }
    });
  }

  async function del(name, key) {
    const idb = await open();
    if (!idb) { memStore(name).delete(key); return { ok: true }; }
    return new Promise((res) => {
      try {
        const tx = idb.transaction(name, 'readwrite');
        tx.objectStore(name).delete(key);
        tx.oncomplete = () => res({ ok: true });
        tx.onerror = () => res({ ok: false, error: tx.error && tx.error.name });
        // Without onabort an explicit abort settles nothing and every
        // `await Store.deletePhoto(...)` hangs the flow that called it.
        tx.onabort = () => res({ ok: false, error: (tx.error && tx.error.name) || 'AbortError' });
      } catch (e) { res({ ok: false, error: e.name }); }
    });
  }

  /* ---- projects --------------------------------------------------------- */
  const allProjects = () => getAll(S_PROJECTS);
  const getProject = (id) => get(S_PROJECTS, id);

  async function putProject(project) {
    project.updated = new Date().toISOString();
    if (!project.created) project.created = project.updated;
    project.schema = 2;
    return put(S_PROJECTS, project);
  }

  /* Deleting a project takes its photos with it, in one transaction, so a
     failure cannot leave orphan photos holding megabytes of quota. */
  async function deleteProject(id) {
    const idb = await open();
    if (!idb) {
      memory.projects.delete(id);
      [...memory.photos.values()].filter((p) => p.projectId === id).forEach((p) => memory.photos.delete(p.id));
      await pruneCollections(id);
      return { ok: true };
    }
    return new Promise((res) => {
      try {
        const tx = idb.transaction([S_PROJECTS, S_PHOTOS], 'readwrite');
        tx.objectStore(S_PROJECTS).delete(id);
        const idxReq = tx.objectStore(S_PHOTOS).index('byProject').getAllKeys(IDBKeyRange.only(id));
        idxReq.onsuccess = () => {
          const os = tx.objectStore(S_PHOTOS);
          (idxReq.result || []).forEach((k) => os.delete(k));
        };
        tx.oncomplete = () => { pruneCollections(id).then(() => res({ ok: true }), () => res({ ok: true })); };
        tx.onerror = () => res({ ok: false });
        tx.onabort = () => res({ ok: false });
      } catch (e) { res({ ok: false }); }
    });
  }

  /* ---- photos ----------------------------------------------------------- */
  const allPhotos = () => getAll(S_PHOTOS);
  const getPhoto = (id) => get(S_PHOTOS, id);
  const putPhoto = (photo) => put(S_PHOTOS, photo);
  const putPhotos = (photos) => putMany(S_PHOTOS, photos);
  const deletePhoto = (id) => del(S_PHOTOS, id);

  async function photosFor(projectId) {
    const idb = await open();
    if (!idb) {
      return [...memory.photos.values()]
        .filter((p) => p.projectId === projectId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return new Promise((res) => {
      try {
        const rq = idb.transaction(S_PHOTOS, 'readonly')
          .objectStore(S_PHOTOS).index('byProject').getAll(IDBKeyRange.only(projectId));
        rq.onsuccess = () => res((rq.result || []).sort((a, b) => (a.order || 0) - (b.order || 0)));
        rq.onerror = () => res([]);
      } catch (e) { res([]); }
    });
  }

  /* Photos not yet assigned to a project — the inbox the brief's photo
     discovery flow works from. */
  async function unassignedPhotos() {
    const all = await allPhotos();
    return all.filter((p) => !p.projectId);
  }

  /* A deleted project must also leave the saved sets that referenced it.
     Without this a set keeps a dead id for ever and the bar reads "3 of 5"
     against projects that no longer exist. */
  async function pruneCollections(projectId) {
    const all = await getAll(S_COLLECTIONS);
    const touched = all.filter((c) => (c.projectIds || []).includes(projectId));
    if (!touched.length) return;
    touched.forEach((c) => {
      c.projectIds = c.projectIds.filter((id) => id !== projectId);
      c.updated = new Date().toISOString();
    });
    await putMany(S_COLLECTIONS, touched);
  }

  /* ---- collections ------------------------------------------------------ */
  const allCollections = () => getAll(S_COLLECTIONS);
  const putCollection = (c) => put(S_COLLECTIONS, c);
  const deleteCollection = (id) => del(S_COLLECTIONS, id);

  /* ---- meta ------------------------------------------------------------- */
  async function meta(k, v) {
    if (v === undefined) {
      const row = await get(S_META, k);
      return row ? row.v : null;
    }
    return put(S_META, { k, v });
  }

  /* ---- quota ------------------------------------------------------------
     Shown in owner tools so a contractor finds out he is near the ceiling
     before a save fails, not after. */
  async function usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return { used: e.usage || 0, quota: e.quota || 0 };
      }
    } catch (e) { /* not supported */ }
    return { used: 0, quota: 0 };
  }

  /* Ask the browser to stop evicting this origin under pressure. Best
     effort; Safari ignores it and Chrome grants it on engagement. */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) { /* ignore */ }
    return false;
  }

  async function clearAll() {
    const idb = await open();
    if (!idb) { memory.projects.clear(); memory.photos.clear(); memory.collections.clear(); return { ok: true }; }
    return new Promise((res) => {
      try {
        const tx = idb.transaction([S_PROJECTS, S_PHOTOS, S_COLLECTIONS], 'readwrite');
        tx.objectStore(S_PROJECTS).clear();
        tx.objectStore(S_PHOTOS).clear();
        tx.objectStore(S_COLLECTIONS).clear();
        tx.oncomplete = () => res({ ok: true });
        tx.onerror = () => res({ ok: false });
        tx.onabort = () => res({ ok: false });
      } catch (e) { res({ ok: false }); }
    });
  }

  return {
    open, uid,
    allProjects, getProject, putProject, deleteProject,
    allPhotos, getPhoto, putPhoto, putPhotos, deletePhoto, photosFor, unassignedPhotos,
    allCollections, putCollection, deleteCollection,
    meta, usage, requestPersistence, clearAll,
    migrateJob,                                  // exported for the tests
    get isDegraded() { return degraded; },
    STORES: { S_PROJECTS, S_PHOTOS, S_COLLECTIONS, S_META }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Store;
