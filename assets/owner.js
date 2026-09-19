/* ==========================================================================
   Urban Showroom — contractor tools
   Built by Dive In Digital Marketing

   Everything the contractor touches and the customer never sees: the lock,
   the photo import, the project editor, the before/after pair review, the
   company profile and the backup.

   The brief's central claim is that photo intelligence should do the filing
   and the contractor should do the deciding. That shape is load-bearing
   here. Nothing this file writes was inferred and saved silently: every
   suggested project, stage, caption and tag arrives on screen pre-filled,
   attributed, and editable, and none of it is committed until the
   contractor taps Save. An app that quietly mis-files a photo of one
   customer's back yard onto another customer's address is worse than an app
   that files nothing.

   On the lock, plainly: this is a client-side app on a public URL, so the
   PIN keeps a customer holding the phone out of the editing tools. It is
   not a security boundary and the UI says so. Anything that genuinely must
   not be seen belongs at `private` visibility, or not in the app.
   ========================================================================== */
'use strict';

const Owner = (() => {
  const { $, $$, el, icon, ICONS } = UI;

  let pinRecord = null;     // { salt, hash } — never the PIN itself
  let importSession = null; // live object URLs to revoke when the sheet closes

  async function init() {
    try { pinRecord = await Store.meta('owner-pin'); } catch (e) { pinRecord = null; }
  }

  /* Intel speaks in phrases a contractor can read ("very likely"). A phrase
     with a space in it is not a class name, so slug it before it goes
     anywhere near one. */
  const CONF_SLUG = { 'very likely': 'high', likely: 'mid', possible: 'low' };
  const confSlug = (c) => CONF_SLUG[c] || 'low';

  /* ======================================================================
     the lock
     ====================================================================== */

  const randomSalt = () => {
    const a = new Uint8Array(16);
    (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  /* SHA-256 where the platform offers it. The fallback is a salted
     non-cryptographic digest — enough to keep the PIN out of the database
     in plain text, and no more than that. Neither is protecting anything
     from someone with the developer tools open, which is why the dialog
     says what this lock is for. */
  async function digest(pin, salt) {
    const text = `${salt}:${pin}`;
    try {
      if (self.crypto && crypto.subtle && crypto.subtle.digest) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* insecure context, or a browser without subtle crypto */ }
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + text.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
    }
    return `f${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  }

  function toggle() {
    if (App.isOwner) {
      App.setOwner(false);
      UI.toast('Contractor tools locked.');
      return;
    }
    if (!pinRecord) { firstRunPin(); return; }
    askPin();
  }

  function firstRunPin() {
    const a = UI.input('pin1', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: '4 to 8 digits' });
    const b = UI.input('pin2', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: 'Again' });

    UI.showModal('Set up your tools', el('div', {}, [
      el('p', { class: 'modal-lede', text: 'Pick a PIN. It keeps a customer holding your phone out of the editing screens.' }),
      el('p', { class: 'modal-lede small', text: 'Be straight with yourself about what this is: the whole app runs on the phone, so the PIN is a lid, not a lock. Anything that must not be seen at all should stay at Private, or stay out of the app.' }),
      UI.field('PIN', a, { required: true }),
      UI.field('Confirm', b, { required: true })
    ]), [
      UI.button('Not now', { onClick: UI.closeModal }),
      UI.button('Set PIN', {
        kind: 'solid',
        onClick: async () => {
          const v = a.value.trim();
          if (!/^\d{4,8}$/.test(v)) { UI.toast('Four to eight digits.'); a.focus(); return; }
          if (v !== b.value.trim()) { UI.toast('The two do not match.'); b.focus(); return; }
          const salt = randomSalt();
          pinRecord = { salt, hash: await digest(v, salt) };
          await Store.meta('owner-pin', pinRecord);
          UI.closeModal();
          await App.setOwner(true);
          UI.toast('Tools unlocked.');
        }
      })
    ]);
    setTimeout(() => a.focus(), 60);
  }

  function askPin() {
    const a = UI.input('pinIn', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: 'PIN' });
    const submit = async () => {
      const v = a.value.trim();
      if (!v) return;
      const h = await digest(v, pinRecord.salt);
      if (h !== pinRecord.hash) { UI.toast('Wrong PIN.'); a.value = ''; a.focus(); return; }
      UI.closeModal();
      await App.setOwner(true);
      UI.toast('Tools unlocked.');
    };
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    UI.showModal('Contractor tools', el('div', {}, [UI.field('PIN', a)]), [
      UI.button('Cancel', { onClick: UI.closeModal }),
      UI.button('Unlock', { kind: 'solid', onClick: submit })
    ]);
    setTimeout(() => a.focus(), 60);
  }

  /* ======================================================================
     the + menu
     ====================================================================== */

  function addMenu() {
    const row = (title, sub, ic, fn) => el('button', {
      class: 'menurow', type: 'button', onclick: () => { UI.closeModal(); fn(); }
    }, [
      icon(ic, 19, 2),
      el('span', {}, [el('b', { text: title }), el('span', { text: sub })]),
      icon(ICONS.chevron, 15, 2.4)
    ]);

    UI.showModal('Add to the showroom', el('div', { class: 'menu' }, [
      row('Import photos', 'Pick a batch and let the app file them', ICONS.camera, () => importPhotos()),
      row('New project', 'Start from an address', ICONS.plus, () => editProject(null)),
      row('Review before/after sets', 'Confirm the pairs the app found', ICONS.swap, () => reviewPairs()),
      row('Saved sets, profile & backup', 'Everything else', ICONS.layers, () => settings())
    ]), []);
  }

  /* ======================================================================
     photo import
     ======================================================================
     The order of operations matters and is the one thing here that is easy
     to get wrong: EXIF comes off the ORIGINAL File before any canvas work,
     because re-encoding through a canvas throws the metadata away. Lose it
     and every downstream inference — which project, which day, which stage
     — is gone with it.                                                     */

  function importPhotos({ projectId = null } = {}) {
    const input = $('#photoInput');
    input.value = '';
    input.onchange = async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      await ingest(files, { projectId });
    };
    input.click();
  }

  const MAX_BATCH = 60;

  async function ingest(files, { projectId }) {
    const batch = files.slice(0, MAX_BATCH);
    if (files.length > batch.length) {
      UI.toast(`Taking the first ${MAX_BATCH}. Import the rest in a second batch.`);
    }

    const progress = el('div', { class: 'prog' }, [
      el('div', { class: 'prog-bar' }, [el('i', { id: 'progFill' })]),
      el('p', { class: 'prog-txt', id: 'progTxt', text: 'Reading photos…' })
    ]);
    UI.showModal('Importing', progress, []);

    const prepared = [];
    for (let i = 0; i < batch.length; i++) {
      const file = batch[i];
      $('#progTxt').textContent = `Reading ${i + 1} of ${batch.length} — ${file.name}`;
      $('#progFill').style.width = `${Math.round(((i + 0.2) / batch.length) * 100)}%`;
      try {
        const rec = await prepareOne(file);
        if (rec) prepared.push(rec);
      } catch (e) {
        // One unreadable file (an HEIC this browser cannot decode, a
        // truncated download) must not sink the other fifty-nine.
        prepared.push(null);
      }
      await new Promise((r) => setTimeout(r, 0)); // let the bar actually paint
    }

    const good = prepared.filter(Boolean);
    const failed = batch.length - good.length;
    if (!good.length) {
      UI.closeModal();
      UI.toast('None of those could be read on this device.');
      return;
    }

    // The full permitted book, not the curated set that happens to be open:
    // importing while a set is showing must still suggest every job.
    const projects = App.permittedProjects();
    const analysed = Intel.analyseImport(good, projects);
    if (projectId) analysed.forEach((a) => { a.bestProjectId = projectId; a.forced = true; });

    UI.closeModal();
    reviewImport(analysed, { failed, lockedProjectId: projectId });
  }

  async function prepareOne(file) {
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return null;

    const exif = await EXIF.fromFile(file);                  // original bytes, first
    const img = await Imaging.process(file, exif.orientation); // then the canvas work

    return {
      id: Store.uid('p'),
      filename: file.name,
      projectId: null,
      url: null,
      blob: img.blob,
      thumbBlob: img.thumbBlob,
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      hash: img.hash,
      layout: img.layout,
      avgColor: img.avgColor,
      exif: {
        lat: exif.lat, lng: exif.lng, takenAt: exif.takenAt,
        make: exif.make || '', model: exif.model || ''
      },
      dateSource: exif.takenAt ? 'exif' : (EXIF.fallbackDate(file) ? 'file' : null),
      takenAt: exif.takenAt || EXIF.fallbackDate(file) || null,
      stage: null,
      stageSource: null,
      caption: '',
      captionSource: null,
      tags: [],
      order: 0,
      demo: false,
      created: new Date().toISOString()
    };
  }

  /* The confirmation screen. Everything is a suggestion with its reason
     printed next to it, and everything is editable before it is saved. */
  function reviewImport(analysed, { failed = 0, lockedProjectId = null } = {}) {
    importSession = { keys: [] };
    const projects = App.permittedProjects();
    /* findDuplicates returns groups of near-identical photos. Keep the
       first of each group ticked and untick the rest, rather than dropping
       them: three shots of the same corner is often deliberate, and it is
       not the app's call. */
    const dupeIds = new Set();
    Intel.findDuplicates(analysed.map((a) => a.photo))
      .forEach((group) => group.slice(1).forEach((ph) => dupeIds.add(ph.id)));

    /* Same-view grouping is a looser thing than duplicate detection: four
       angles of one driveway are not duplicates, but they are one subject,
       and saying so is what lets the contractor file them in one go rather
       than reading each thumbnail cold. */
    const viewGroup = new Map();
    const viewSize = new Map();
    let gn = 0;
    Intel.clusterByView(analysed.map((a) => a.photo)).forEach((group) => {
      if (group.length < 2) return;
      gn += 1;
      group.forEach((ph) => { viewGroup.set(ph.id, gn); viewSize.set(ph.id, group.length); });
    });

    const projectOptions = () => [
      { value: '', label: '— Leave unfiled —' },
      { value: '__new__', label: '+ Start a new project' },
      ...projects.map((p) => ({
        value: p.id,
        label: `${p.name}${p.city ? ` — ${p.city}` : ''}`
      }))
    ];

    // The working copy. Nothing touches the store until Save.
    const rows = analysed.map((a) => ({
      photo: a.photo,
      projectId: a.bestProjectId || lockedProjectId || '',
      stage: a.stage || '',
      caption: a.caption || '',
      tags: (a.tags || []).map((t) => t.label),
      reasons: a.bestReasons || [],
      confidence: a.confidence,
      stageReason: a.stageReason,
      keep: !dupeIds.has(a.photo.id)
    }));

    const body = el('div', { class: 'review' });

    const head = el('div', { class: 'review-head' }, [
      el('p', {
        class: 'modal-lede',
        text: `${rows.length} ${rows.length === 1 ? 'photo' : 'photos'} read. Where the app could work out which job a photo belongs to, it has filled it in and said why. Change anything that is wrong — nothing is saved until you tap Save.`
      }),
      failed ? el('p', { class: 'modal-lede warn', text: `${failed} could not be read on this device (an iPhone HEIC on a browser without the decoder, usually). Re-share them as JPEG.` }) : null,
      dupeIds.size ? el('p', { class: 'modal-lede small', text: `${dupeIds.size} look like duplicates of another photo in this batch and are unticked.` }) : null
    ]);
    body.appendChild(head);

    rows.forEach((row, i) => {
      const ph = row.photo;
      const src = Imaging.objectUrl(ph.thumbBlob || ph.blob, `imp:${ph.id}`);
      importSession.keys.push(`imp:${ph.id}`);

      const keepBox = el('input', { type: 'checkbox', id: `keep${i}`, class: 'keepbox' });
      keepBox.checked = row.keep;
      keepBox.addEventListener('change', () => { row.keep = keepBox.checked; card.classList.toggle('dropped', !row.keep); });

      const projSel = UI.select(`proj${i}`, projectOptions(), row.projectId);
      projSel.addEventListener('change', () => {
        if (projSel.value === '__new__') { row.projectId = '__new__'; } else { row.projectId = projSel.value; }
      });

      const stageWrap = el('div', { class: 'pills tight' });
      [{ id: '', label: 'Not set' }, ...STAGES].forEach((s) => {
        const b = el('button', {
          class: `pill${row.stage === s.id ? ' on' : ''}`, type: 'button', text: s.label
        });
        b.addEventListener('click', () => {
          row.stage = s.id;
          row.stageTouched = true;
          $$('.pill', stageWrap).forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
        });
        stageWrap.appendChild(b);
      });

      const capInput = UI.textarea(`cap${i}`, { value: row.caption, placeholder: 'Caption', maxlength: 240 });
      capInput.addEventListener('input', () => { row.caption = capInput.value; row.captionTouched = true; });

      const tagsInput = UI.input(`tags${i}`, {
        value: row.tags.join(', '),
        placeholder: 'stamped, charcoal, border'
      });
      tagsInput.addEventListener('input', () => {
        row.tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
        row.tagsTouched = true;
      });

      const why = [];
      if (row.confidence && row.reasons.length) {
        why.push(el('span', { class: `why why-${confSlug(row.confidence)}`, text: `${row.confidence} match · ${row.reasons.join('; ')}` }));
      } else if (!row.projectId) {
        why.push(el('span', { class: 'why why-none', text: 'No job matched — no location or date to go on. Pick one.' }));
      }
      if (row.stageReason) why.push(el('span', { class: 'why', text: `Stage: ${row.stageReason}` }));
      if (viewGroup.has(ph.id)) {
        const n = viewSize.get(ph.id) - 1;
        why.push(el('span', {
          class: 'why why-mid',
          text: `Same view as ${n} other ${n === 1 ? 'photo' : 'photos'} in this batch (set ${viewGroup.get(ph.id)})`
        }));
      }
      const ex = ph.exif || {};
      const facts = [
        ex.lat != null ? 'has GPS' : 'no GPS',
        ph.takenAt ? UI.fmtDate(ph.takenAt, { long: true }) : 'no date',
        UI.fmtBytes(ph.bytes)
      ].filter(Boolean).join(' · ');
      why.push(el('span', { class: 'why muted', text: facts }));

      const card = el('div', { class: `revcard${row.keep ? '' : ' dropped'}` }, [
        el('div', { class: 'rev-img' }, [
          src ? el('img', { src, alt: ph.filename, loading: 'lazy' }) : el('div', { class: 'nophoto', text: '?' }),
          el('label', { class: 'keepwrap', for: `keep${i}` }, [keepBox, el('span', { text: 'Use' })])
        ]),
        el('div', { class: 'rev-main' }, [
          el('p', { class: 'rev-file', text: ph.filename }),
          el('div', { class: 'why-stack' }, why),
          UI.field('Job', projSel),
          UI.field('Stage', stageWrap),
          UI.field('Caption', capInput, { hint: 'Drafted from what the app knows — the stage, the job’s own details, the dominant colour, the date. It cannot see the photograph. Edit freely.' }),
          UI.field('Tags', tagsInput)
        ])
      ]);
      body.appendChild(card);
    });

    /* Anything that throws below leaves the modal open with a disabled
       "Saving…" button, no toast and no way out but Discard — which throws
       away the whole analysed batch. Catch it, say so, give the button
       back. */
    const saveBtn = UI.button('Save photos', {
      kind: 'solid',
      onClick: async () => {
        try {
          await commitImport(rows, saveBtn);
        } catch (e) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save photos';
          UI.toast('The save failed and nothing was written. Your photos are still on this screen.', 5000);
        }
      }
    });

    UI.showModal('Confirm the filing', body, [
      UI.armedButton('Discard', 'Throw the batch away?', UI.closeModal),
      saveBtn
    ], { onClose: releaseImportSession });
  }

  function releaseImportSession() {
    if (!importSession) return;
    importSession.keys.forEach((k) => Imaging.release(k));
    importSession = null;
  }

  async function commitImport(rows, btn) {
    const keep = rows.filter((r) => r.keep);
    if (!keep.length) { UI.toast('Nothing ticked.'); return; }

    const needsNew = keep.filter((r) => r.projectId === '__new__');
    if (needsNew.length) {
      // A new project needs an address, and an address is a form, not a
      // checkbox. Hand it over rather than inventing one.
      UI.closeModal();
      editProject(null, {
        seedFrom: needsNew.map((r) => r.photo),
        afterSave: async (newId) => {
          keep.forEach((r) => { if (r.projectId === '__new__') r.projectId = newId; });
          await writePhotos(keep);
        }
      });
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await writePhotos(keep);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save photos';
    }
  }

  async function writePhotos(rows) {
    const touched = new Set();
    const byProject = new Map();

    rows.forEach((r) => {
      const ph = r.photo;
      ph.projectId = r.projectId || null;
      /* Provenance survives the save. Stamping everything 'confirmed'
         because the contractor tapped Save destroyed the one distinction
         the brief cares about: a caption the machine wrote and he let
         stand is not a caption he wrote. 'auto' means the app's draft went
         in untouched, 'edited' means he changed it. */
      ph.stage = r.stage || null;
      ph.stageSource = r.stage ? (r.stageTouched ? 'edited' : 'auto') : null;
      ph.caption = r.caption || '';
      ph.captionSource = r.caption ? (r.captionTouched ? 'edited' : 'auto') : null;
      ph.tags = r.tags || [];
      ph.tagsSource = (r.tags || []).length ? (r.tagsTouched ? 'edited' : 'auto') : null;
      if (ph.projectId) {
        touched.add(ph.projectId);
        if (!byProject.has(ph.projectId)) byProject.set(ph.projectId, []);
        byProject.get(ph.projectId).push(ph);
      }
    });

    // Append after whatever the project already has, so an import never
    // reshuffles a running order the contractor set by hand.
    for (const [pid, list] of byProject) {
      const existing = await Store.photosFor(pid);
      let n = existing.length;
      list.forEach((ph) => { ph.order = n++; });
    }

    /* The store has always returned {ok:false, error:'QuotaExceededError'}
       and {ok:true, degraded:true}; nothing ever read them, so a full disk
       and a private-mode browser both produced "Saved 12 photos." That is
       the difference between a recoverable problem and silent data loss. */
    const wrote = await Store.putPhotos(rows.map((r) => r.photo));
    if (!wrote || wrote.ok === false) {
      UI.closeModal();
      await App.reload();
      UI.toast(wrote && wrote.error === 'QuotaExceededError'
        ? 'Out of room on this device \u2014 nothing was saved. Remove some old jobs or export and start a clean book.'
        : 'The save failed and nothing was written. Try again.');
      return;
    }

    // Pair proposals are computed now and stored as proposals, not as
    // pairs. They show up in the review screen for a yes or a no.
    let proposed = 0;
    for (const pid of touched) {
      const project = await Store.getProject(pid);
      if (!project) continue;
      const photos = await Store.photosFor(pid);
      const fresh = Intel.proposePairs(photos, { existingPairs: project.pairs || [] });
      if (fresh.length) {
        project.proposedPairs = [...(project.proposedPairs || []), ...fresh]
          .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
        project.updated = new Date().toISOString();
        await Store.putProject(project);
        proposed += fresh.length;
      }
    }

    UI.closeModal();
    await App.reload();
    if (wrote.degraded) {
      UI.toast('Saved for now, but this browser will not keep it. Export a backup before you close the tab.', 6000);
    } else {
      UI.toast(proposed
        ? `Saved. ${proposed} before/after ${proposed === 1 ? 'set' : 'sets'} to confirm.`
        : `Saved ${rows.length} ${rows.length === 1 ? 'photo' : 'photos'}.`);
    }
    if (proposed) setTimeout(reviewPairs, 700);
  }

  /* ======================================================================
     project editor
     ====================================================================== */

  function blankProject() {
    const now = new Date().toISOString();
    return {
      id: Store.uid('j'), name: '', client: '', address: '', lat: null, lng: null,
      city: '', state: '', neighborhood: '',
      type: '', trade: [], material: [], pattern: '', finish: [], color: [], feature: [],
      tags: [], notes: '', startedAt: null, completedAt: null,
      /* Not 'public'. Defaulting to the widest of the four levels put every
         new job in the external showroom the moment it was saved, which is
         the opposite of the brief's "contractor explicitly controls which
         projects may be used externally". 'client' shows the job when he
         hands the phone to somebody; promoting it to the always-on public
         showroom stays a deliberate act. */
      visibility: 'client', exactAddress: false, coverPhotoId: null,
      pairs: [], proposedPairs: [], demo: false, schema: 2, created: now, updated: now
    };
  }

  const isoToDateInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  };
  const dateInputToIso = (v) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

  function editProject(id, { seedFrom = null, afterSave = null } = {}) {
    let confirmedExact = false;     // both read by the Save handler below
    let confirmedNoWhere = false;
    const existing = id ? App.projects.find((p) => p.id === id) : null;
    const p = existing ? { ...existing } : blankProject();

    /* A new project started from a batch of photos inherits everything the
       photos already told us: where they were taken and when. */
    if (!existing && seedFrom && seedFrom.length) {
      const withGps = seedFrom.filter((x) => x.exif && x.exif.lat != null && x.exif.lng != null);
      if (withGps.length) {
        p.lat = withGps.reduce((s, x) => s + x.exif.lat, 0) / withGps.length;
        p.lng = withGps.reduce((s, x) => s + x.exif.lng, 0) / withGps.length;
      }
      const dates = seedFrom.map((x) => x.takenAt).filter(Boolean).map((d) => Date.parse(d)).filter((n) => !isNaN(n));
      if (dates.length) {
        p.startedAt = new Date(Math.min(...dates)).toISOString();
        p.completedAt = new Date(Math.max(...dates)).toISOString();
      }
    }

    const chosen = {
      trade: new Set(p.trade || []),
      material: new Set(p.material || []),
      finish: new Set(p.finish || []),
      color: new Set(p.color || []),
      feature: new Set(p.feature || [])
    };

    const nameIn = UI.input('pName', { value: p.name, placeholder: 'Ashlar slate driveway, Bray Station', maxlength: 90 });
    const clientIn = UI.input('pClient', { value: p.client || '', placeholder: 'The Harts', maxlength: 80 });
    const addrIn = UI.input('pAddr', { value: p.address, placeholder: '1420 Poplar Ave, Collierville, TN', maxlength: 160 });
    const cityIn = UI.input('pCity', { value: p.city, placeholder: 'Collierville', maxlength: 60 });
    const stateIn = UI.input('pState', { value: p.state, placeholder: 'TN', maxlength: 2 });
    const hoodIn = UI.input('pHood', { value: p.neighborhood, placeholder: 'Bray Station', maxlength: 60 });
    const notesIn = UI.textarea('pNotes', { value: p.notes, placeholder: 'What you did, what the customer wanted, anything worth remembering.' });
    const tagsIn = UI.input('pTags', { value: (p.tags || []).join(', '), placeholder: 'wet look, driveway replacement' });
    const startIn = UI.input('pStart', { type: 'date', value: isoToDateInput(p.startedAt) });
    const doneIn = UI.input('pDone', { type: 'date', value: isoToDateInput(p.completedAt) });

    const coordNote = el('p', { class: 'hint coord', text: coordText(p) });
    const setCoord = (lat, lng) => { p.lat = lat; p.lng = lng; coordNote.textContent = coordText(p); };

    const hereBtn = UI.button('I am here now', {
      icon: ICONS.pin, small: true,
      onClick: () => {
        if (!navigator.geolocation) { UI.toast('This device will not share a location.'); return; }
        UI.toast('Getting a fix…');
        navigator.geolocation.getCurrentPosition(
          (pos) => { setCoord(pos.coords.latitude, pos.coords.longitude); UI.toast('Pinned where you are standing.'); },
          () => UI.toast('Could not get a location.'),
          { enableHighAccuracy: true, timeout: 12000 }
        );
      }
    });

    const lookupBtn = UI.button('Find on the map', {
      icon: ICONS.compass, small: true,
      onClick: async () => {
        const q = [addrIn.value, cityIn.value, stateIn.value].filter(Boolean).join(', ').trim();
        if (!q) { UI.toast('Type an address first.'); return; }
        UI.toast('Looking it up…');
        const hit = await Geo.geocode(q);
        if (hit === undefined) { UI.toast('No signal for the lookup. Use "I am here now" on site.'); return; }
        if (hit === null) { UI.toast('Could not find that address. Pin it on site instead.'); return; }
        setCoord(hit.lat, hit.lng);
        if (!cityIn.value && hit.city) cityIn.value = hit.city;
        if (!stateIn.value && hit.state) stateIn.value = hit.state;
        if (!hoodIn.value && hit.neighborhood) hoodIn.value = hit.neighborhood;
        UI.toast('Found it.');
      }
    });

    const typeSel = UI.select('pType', [{ value: '', label: '—' }, ...TYPES.map((t) => ({ value: t.id, label: t.label }))], p.type);
    const patSel = UI.select('pPat', [{ value: '', label: '— none —' }, ...PATTERNS.map((t) => ({ value: t.id, label: t.label }))], p.pattern);

    const visSel = UI.select('pVis', Geo.VISIBILITY.map((v) => ({ value: v, label: Geo.VISIBILITY_LABEL[v] })), p.visibility || 'private');
    const exactTog = UI.toggle('pExact', 'Show the exact address',
      'Off by default. Leave it off for a private home — the pin then lands on the block, not the driveway.', p.exactAddress === true);

    const photos = id ? App.photosOf(id) : [];
    const coverWrap = el('div', { class: 'coverpick' });
    if (photos.length) {
      photos.forEach((ph) => {
        const b = el('button', {
          class: `cov${(p.coverPhotoId || (App.coverOf(p) || {}).id) === ph.id ? ' on' : ''}`,
          type: 'button', 'aria-label': 'Use as the cover photo'
        }, [UI.photoImg(ph, { thumb: true, alt: '' })]);
        b.addEventListener('click', () => {
          p.coverPhotoId = ph.id;
          $$('.cov', coverWrap).forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
        });
        coverWrap.appendChild(b);
      });
    }

    const body = el('div', { class: 'editor' }, [
      UI.field('What to call it', nameIn, { required: true, hint: 'How you would describe it to the next customer.' }),
      UI.field('Customer', clientIn, { hint: 'For your own searching. Never shown to anybody else and never in a customer’s search results.' }),

      el('h4', { class: 'ed-h', text: 'Where' }),
      UI.field('Address', addrIn),
      el('div', { class: 'two' }, [UI.field('Town', cityIn), UI.field('State', stateIn)]),
      UI.field('Neighborhood or area', hoodIn, { hint: 'What people round here call it. Customers search by it.' }),
      el('div', { class: 'btn-row' }, [hereBtn, lookupBtn]),
      coordNote,

      el('h4', { class: 'ed-h', text: 'What it is' }),
      UI.field('Type', typeSel),
      UI.field('Trade', UI.pillGroup(TRADES.map((t) => ({ id: t.id, label: t.label })), chosen.trade), { hint: 'More than one is normal.' }),
      UI.field('Material', UI.pillGroup(MATERIALS.map((t) => ({ id: t.id, label: t.label })), chosen.material)),
      UI.field('Pattern', patSel),
      UI.field('Finish', UI.pillGroup(FINISHES.map((t) => ({ id: t.id, label: t.label })), chosen.finish)),
      UI.field('Color', UI.pillGroup(COLORS.map((t) => ({ id: t.id, label: t.label, swatch: t.swatch })), chosen.color, { withSwatch: true })),
      UI.field('Features', UI.pillGroup(FEATURES.map((t) => ({ id: t.id, label: t.label })), chosen.feature)),
      UI.field('Your own tags', tagsIn, { hint: 'Comma separated. Anything a customer might say that the list above does not cover.' }),

      el('h4', { class: 'ed-h', text: 'When' }),
      el('div', { class: 'two' }, [UI.field('Started', startIn), UI.field('Finished', doneIn)]),

      el('h4', { class: 'ed-h', text: 'Notes' }),
      UI.field('', notesIn),

      photos.length ? el('h4', { class: 'ed-h', text: 'Cover photo' }) : null,
      photos.length ? coverWrap : null,

      el('h4', { class: 'ed-h', text: 'Who can see it' }),
      UI.field('', visSel),
      exactTog,
      el('p', { class: 'hint', text: 'Private is only you. My team is for people you share this device or a backup with. Shareable with a client covers a set you hand to one customer. Public showroom is anyone who opens the app.' })
    ]);

    const foot = [UI.button('Cancel', { onClick: UI.closeModal })];
    if (existing) {
      foot.push(UI.armedButton('Delete', 'Delete for good?', async () => {
        await Store.deleteProject(existing.id);
        UI.closeModal();
        App.closeDetail();
        await App.reload();
        UI.toast('Project deleted.');
      }));
    }
    foot.push(UI.button('Save', {
      kind: 'solid',
      onClick: async () => {
        const name = nameIn.value.trim();
        if (!name) { UI.toast('Give it a name.'); nameIn.focus(); return; }

        Object.assign(p, {
          name,
          client: clientIn.value.trim(),
          address: addrIn.value.trim(),
          city: cityIn.value.trim(),
          state: stateIn.value.trim().toUpperCase().slice(0, 2),
          neighborhood: hoodIn.value.trim(),
          type: typeSel.value,
          pattern: patSel.value,
          trade: [...chosen.trade],
          material: [...chosen.material],
          finish: [...chosen.finish],
          color: [...chosen.color],
          feature: [...chosen.feature],
          tags: tagsIn.value.split(',').map((t) => t.trim()).filter(Boolean),
          notes: notesIn.value.trim(),
          startedAt: dateInputToIso(startIn.value),
          completedAt: dateInputToIso(doneIn.value),
          visibility: visSel.value,
          exactAddress: $('#pExact').checked,
          demo: false,
          updated: new Date().toISOString()
        });

        /* The brief calls these address-centred records. One with neither
           an address nor a pin is a photo album entry: it cannot be found
           on the map, cannot be given a distance, and cannot be matched to
           an imported photo. Not blocked — a contractor may genuinely be
           filing an old job he cannot place — but not silent either. */
        if (!p.address && (p.lat == null || p.lng == null) && !confirmedNoWhere) {
          confirmedNoWhere = true;
          UI.toast('No address and no pin — this job will not show on the map or in distances. Tap Save again to keep it anyway.');
          return;
        }

        if (p.visibility === 'public' && p.exactAddress && !confirmedExact) {
          // Publishing a private customer's street number to anyone who
          // opens the app is a decision, not a default.
          confirmedExact = true;
          UI.toast('That publishes the exact address. Tap Save again to confirm.');
          return;
        }

        const res = await Store.putProject(p);
        if (!res || res.ok === false) {
          UI.toast(res && res.error === 'QuotaExceededError'
            ? 'Out of room on this device. Nothing was saved.'
            : 'The save failed. Nothing was written.');
          return;
        }
        UI.closeModal();
        await App.reload();
        if (afterSave) await afterSave(p.id);
        UI.toast(res.degraded
          ? 'Saved for now, but this browser will not keep it. Export a backup.'
          : (existing ? 'Saved.' : 'Project added.'));
        if (!existing && !afterSave) App.openDetail(p.id);
      }
    }));

    /* Typed work is not thrown away by a mis-tap. The Cancel button still
       closes outright; Escape and the backdrop ask once. */
    const snapshot = () => [nameIn, clientIn, addrIn, cityIn, stateIn, hoodIn, notesIn, tagsIn]
      .map((n) => n.value).join('\u0000');
    const startedWith = snapshot();
    let warned = false;
    UI.showModal(existing ? 'Edit project' : 'New project', body, foot, {
      confirmClose: () => {
        if (snapshot() === startedWith) return true;
        if (warned) return true;
        warned = true;
        UI.toast('You have unsaved changes. Tap Cancel to throw them away, or Escape again.');
        return false;
      }
    });
    setTimeout(() => nameIn.focus(), 60);
  }

  function coordText(p) {
    if (p.lat == null || p.lng == null) return 'No pin yet — it will not show on the map until it has one.';
    return `Pinned at ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  }

  /* ======================================================================
     before / after pair review
     ====================================================================== */

  function reviewPairs() {
    const withProposals = App.projects.filter((p) => (p.proposedPairs || []).length);
    if (!withProposals.length) {
      UI.showModal('Before / after sets', el('div', {}, [
        el('p', { class: 'modal-lede', text: 'Nothing to confirm right now.' }),
        el('p', { class: 'modal-lede small', text: 'Pairs get proposed when a job has photos from two different days that frame the same view. Import the before shots alongside the finished ones and they show up here.' })
      ]), [UI.button('Close', { onClick: UI.closeModal })]);
      return;
    }

    const body = el('div', { class: 'review' });
    body.appendChild(el('p', {
      class: 'modal-lede',
      text: 'The app matched these on how alike the framing is and how many days apart they were taken. It has never been scored against a set of real jobs, so treat every one as a suggestion and look before you save.'
    }));

    const decisions = [];
    withProposals.forEach((project) => {
      (project.proposedPairs || []).forEach((pr) => {
        const before = App.state.photoById.get(pr.beforeId);
        const after = App.state.photoById.get(pr.afterId);
        if (!before || !after) return;
        // Pre-tick only the confident ones. A "possible" pair pre-ticked is
        // the app filing by itself, which is the thing the brief forbids.
        const d = { projectId: project.id, pair: pr, accept: pr.confidence === 'very likely' };

        const box = el('input', { type: 'checkbox', id: `pr-${pr.id}` });
        box.checked = d.accept;
        box.addEventListener('change', () => { d.accept = box.checked; card.classList.toggle('dropped', !box.checked); });

        const swapBtn = UI.button('Wrong way round', {
          small: true,
          onClick: () => {
            const t = d.pair.beforeId; d.pair = { ...d.pair, beforeId: d.pair.afterId, afterId: t };
            const imgs = $$('.rev-pair img', card);
            const s = imgs[0].src; imgs[0].src = imgs[1].src; imgs[1].src = s;
            UI.toast('Swapped.');
          }
        });

        const card = el('div', { class: `revcard pairrev${d.accept ? '' : ' dropped'}` }, [
          el('div', { class: 'rev-pair' }, [
            UI.photoImg(before, { thumb: true, alt: 'Before' }),
            UI.photoImg(after, { thumb: true, alt: 'After' })
          ]),
          el('div', { class: 'rev-main' }, [
            el('p', { class: 'rev-file', text: project.name }),
            el('span', { class: `why why-${confSlug(pr.confidence)}`, text: `${pr.confidence} · ${pr.reason}` }),
            el('div', { class: 'btn-row' }, [
              el('label', { class: 'keepwrap wide', for: `pr-${pr.id}` }, [box, el('span', { text: 'This is a before/after set' })]),
              swapBtn
            ])
          ])
        ]);
        body.appendChild(card);
        decisions.push(d);
      });
    });

    UI.showModal('Confirm before / after', body, [
      UI.button('Later', { onClick: UI.closeModal }),
      UI.button('Save', {
        kind: 'solid',
        onClick: async () => {
          const byProject = new Map();
          decisions.forEach((d) => {
            if (!byProject.has(d.projectId)) byProject.set(d.projectId, []);
            byProject.get(d.projectId).push(d);
          });

          let kept = 0;
          for (const [pid, list] of byProject) {
            const project = await Store.getProject(pid);
            if (!project) continue;
            const accepted = list.filter((d) => d.accept).map((d) => ({ ...d.pair, confirmed: true }));
            project.pairs = [...(project.pairs || []), ...accepted]
              .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i);
            // A rejected proposal is gone for good. Re-offering it every
            // import is how a good feature becomes a nuisance.
            project.proposedPairs = [];
            project.updated = new Date().toISOString();
            await Store.putProject(project);
            kept += accepted.length;
          }
          UI.closeModal();
          await App.reload();
          UI.toast(kept ? `${kept} before/after ${kept === 1 ? 'set' : 'sets'} saved.` : 'All cleared.');
        }
      })
    ]);
  }

  /* ======================================================================
     settings, profile and backup
     ====================================================================== */

  /* What a locked app shows once the phone leaves the contractor's hand.
     This is what makes the brief's middle two privacy levels mean
     something: without it "my team" and "shareable with a client" were
     settings that simply hid a job from everybody. */
  const HANDOVER_LABEL = {
    public: 'Public showroom \u2014 only jobs you have published',
    client: 'With a customer \u2014 published jobs plus client-shareable ones',
    team: 'My crew \u2014 everything except private jobs'
  };

  function handoverMode() {
    const body = el('div', {});
    body.appendChild(el('p', {
      class: 'modal-lede',
      text: 'When you lock the tools and hand the phone over, this is what the person holding it can see. Private jobs are never in any of them.'
    }));
    const wrap = el('div', { class: 'menu' });
    ['public', 'client', 'team'].forEach((level) => {
      const on = App.showAs === level;
      wrap.appendChild(el('button', {
        class: `menurow${on ? ' on' : ''}`, type: 'button',
        onclick: async () => {
          await App.setShowAs(level);
          UI.closeModal();
          UI.toast(`Hand-over mode: ${Geo.VISIBILITY_LABEL[level]}`);
        }
      }, [
        icon(on ? ICONS.check : ICONS.eye, 19, 2),
        el('span', {}, [
          el('b', { text: Geo.VISIBILITY_LABEL[level] }),
          el('span', { text: HANDOVER_LABEL[level] })
        ])
      ]));
    });
    body.appendChild(wrap);
    body.appendChild(el('p', {
      class: 'modal-lede small',
      text: 'A lock is not a wall. Somebody who knows their way around a browser can read what is on this device whatever mode it is in \u2014 this decides what the app shows, not what the device holds.'
    }));
    UI.showModal('Hand-over mode', body, [UI.button('Close', { onClick: UI.closeModal })]);
  }

  /* Photos saved without a job used to disappear: the import screen offered
     "leave unfiled" and nothing in the app ever listed them again. */
  function fileUnfiled(photos) {
    const projects = App.permittedProjects();
    const rows = photos.map((ph) => ({ photo: ph, projectId: '', drop: false }));
    const body = el('div', { class: 'review' });
    body.appendChild(el('p', {
      class: 'modal-lede',
      text: `${photos.length} ${photos.length === 1 ? 'photo is' : 'photos are'} saved but not on a job, so nothing shows them. Put each one on a job, or delete it.`
    }));

    rows.forEach((row, i) => {
      const sel = UI.select(`uf${i}`, [
        { value: '', label: '\u2014 Leave for now \u2014' },
        ...projects.map((pr) => ({ value: pr.id, label: `${pr.name}${pr.city ? ` \u2014 ${pr.city}` : ''}` }))
      ], '');
      sel.addEventListener('change', () => { row.projectId = sel.value; });

      const card = el('div', { class: 'revcard' }, [
        el('div', { class: 'rev-img' }, [UI.photoImg(row.photo, { thumb: true, alt: '' })]),
        el('div', { class: 'rev-main' }, [
          el('p', { class: 'rev-file', text: row.photo.filename || 'Photo' }),
          el('span', { class: 'why muted', text: [UI.fmtDate(row.photo.takenAt, { long: true }), UI.fmtBytes(row.photo.bytes)].filter(Boolean).join(' \u00b7 ') }),
          UI.field('Job', sel),
          UI.armedButton('Delete this photo', 'Delete it?', async () => {
            await Store.deletePhoto(row.photo.id);
            card.remove();
            await App.reload();
            UI.toast('Deleted.');
          })
        ])
      ]);
      body.appendChild(card);
    });

    UI.showModal('Photos not on a job', body, [
      UI.button('Close', { onClick: UI.closeModal }),
      UI.button('File them', {
        kind: 'solid',
        onClick: async () => {
          const move = rows.filter((r) => r.projectId);
          if (!move.length) { UI.toast('Nothing chosen.'); return; }
          for (const r of move) {
            const existing = await Store.photosFor(r.projectId);
            r.photo.projectId = r.projectId;
            r.photo.order = existing.length;
          }
          const res = await Store.putPhotos(move.map((r) => r.photo));
          UI.closeModal();
          await App.reload();
          UI.toast(res && res.ok !== false ? `Filed ${move.length}.` : 'The save failed.');
        }
      })
    ]);
  }

  async function settings() {
    const u = await Store.usage();
    const projects = App.projects;
    const demoCount = projects.filter((p) => p.demo).length;
    const photoCount = App.state.photoById.size;
    let unfiled = [];
    try { unfiled = await Store.unassignedPhotos(); } catch (e) { /* advisory */ }

    const row = (title, sub, ic, fn) => el('button', {
      class: 'menurow', type: 'button', onclick: () => { UI.closeModal(); fn(); }
    }, [icon(ic, 19, 2), el('span', {}, [el('b', { text: title }), el('span', { text: sub })]), icon(ICONS.chevron, 15, 2.4)]);

    const stats = el('div', { class: 'stats' }, [
      el('span', {}, [el('b', { text: String(projects.length) }), el('i', { text: 'projects' })]),
      el('span', {}, [el('b', { text: String(photoCount) }), el('i', { text: 'photos' })]),
      el('span', {}, [el('b', { text: u.quota ? UI.fmtBytes(u.used) : '—' }), el('i', { text: u.quota ? `of ${UI.fmtBytes(u.quota)}` : 'on this device' })])
    ]);

    const items = [
      row('Hand-over mode', HANDOVER_LABEL[App.showAs] || 'What a customer sees when you lock it', ICONS.eye, handoverMode),
      row('Company profile', 'Name, tagline and logo', ICONS.lock, editProfile)
    ];
    if (unfiled.length) {
      items.push(row('Photos not on a job', `${unfiled.length} waiting to be filed`, ICONS.camera, () => fileUnfiled(unfiled)));
    }
    items.push(
      row('Export a backup', 'One file with every job and photo', ICONS.download, exportBackup),
      row('Restore from a backup', 'Bring a file back in', ICONS.layers, importBackup)
    );
    if (demoCount) {
      items.push(row('Remove the sample projects', `${demoCount} demo ${demoCount === 1 ? 'job' : 'jobs'} shipped with the app`, ICONS.trash, removeSamples));
    }
    items.push(row('Change PIN', 'Set a new one', ICONS.lock, () => { pinRecord = null; firstRunPin(); }));

    UI.showModal('Tools', el('div', {}, [
      stats,
      Store.isDegraded ? el('p', { class: 'modal-lede warn', text: 'This browser is refusing to store anything. Export before you close the tab or the work is lost.' }) : null,
      el('div', { class: 'menu' }, items),
      el('p', { class: 'modal-lede small', text: 'Nothing here is on a server — it all lives on this device. That cuts both ways: a backup is the only copy that survives a lost phone, and anyone holding this phone unlocked is inside your book. Export a backup now and again, and set the hand-over mode before you pass it to a customer.' })
    ]), [UI.button('Close', { onClick: UI.closeModal })]);
  }

  function editProfile() {
    const prof = App.state.profile;
    const nameIn = UI.input('prName', { value: prof.name, maxlength: 40 });
    const tagIn = UI.input('prTag', { value: prof.tagline, maxlength: 60 });
    let logo = prof.logo || '';

    /* The menu row has always said "name, tagline and logo" and there was
       no logo control, which also made the claim that this is a
       trade-agnostic app one rename away from true into something less
       than true: the mark at the top of the screen is the brand. */
    const preview = el('img', { class: 'logoprev', src: logo || 'img/logo.webp', alt: '' });
    const pick = () => {
      const input = el('input', { type: 'file', accept: 'image/*', class: 'sr' });
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = (input.files || [])[0];
        input.remove();
        if (!file) return;
        try {
          UI.toast('Reading it\u2026');
          const img = await Imaging.process(file, 1);
          // The thumbnail, as a data URL: small enough to live in the
          // profile record and survive an export, big enough for retina.
          logo = await blobToDataUrl(img.thumbBlob || img.blob);
          preview.src = logo;
          UI.toast('Logo set. Save to keep it.');
        } catch (e) {
          UI.toast('That image could not be read on this device.');
        }
      }, { once: true });
      input.click();
    };

    UI.showModal('Company profile', el('div', {}, [
      el('p', { class: 'modal-lede', text: 'What a customer sees at the top of the screen.' }),
      UI.field('Name', nameIn, { required: true }),
      UI.field('Tagline', tagIn),
      UI.field('Logo', el('div', { class: 'logorow' }, [
        preview,
        UI.button('Choose an image', { small: true, icon: ICONS.camera, onClick: pick }),
        logo ? UI.button('Reset', { small: true, onClick: () => { logo = ''; preview.src = 'img/logo.webp'; } }) : null
      ]), { hint: 'Kept on this device and in your backup. A wide mark reads better than a square one.' })
    ]), [
      UI.button('Cancel', { onClick: UI.closeModal }),
      UI.button('Save', {
        kind: 'solid',
        onClick: async () => {
          const name = nameIn.value.trim();
          if (!name) { UI.toast('A name is needed.'); return; }
          const next = { ...prof, name, tagline: tagIn.value.trim() };
          if (logo) next.logo = logo; else delete next.logo;
          const res = await Store.meta('profile', next);
          if (res && res.ok === false) { UI.toast('That did not save \u2014 the logo may be too large.'); return; }
          UI.closeModal();
          await App.applyProfile();
          UI.toast('Profile saved.');
        }
      })
    ]);
  }

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  /* Photos are Blobs, and a backup that drops them is not a backup. They go
     out as base64 inside the JSON, which roughly doubles the size and is
     the price of one file the contractor can email to himself. */
  function exportBackup() {
    /* The file is everything: private and client-only jobs alongside public
       ones, exact addresses, exact coordinates, and the raw GPS fix each
       photo was taken at — which survives even though the image bytes
       themselves lost their EXIF in the canvas re-encode. That is right for
       a backup and wrong for anything handed to somebody else, so the
       dialog says so before the file exists rather than after. */
    UI.showModal('Export a backup', el('div', {}, [
      el('p', { class: 'modal-lede', text: 'One file holding every job and every photo, so you can put it all back on a new phone.' }),
      el('p', { class: 'modal-lede warn', text: 'It is not a client-safe file. It holds every job at every privacy level, the exact addresses, and the GPS point each photo was taken at. Keep it to yourself.' })
    ]), [
      UI.button('Cancel', { onClick: UI.closeModal }),
      UI.button('Export', { kind: 'solid', onClick: runExport })
    ]);
  }

  async function runExport() {
    UI.showModal('Exporting', el('p', { class: 'modal-lede', id: 'expTxt', text: 'Packing everything up…' }), []);
    try {
      const [projects, photos, collections] = await Promise.all([
        Store.allProjects(), Store.allPhotos(), Store.allCollections()
      ]);
      const out = { app: 'urban-showroom', schema: 2, exported: new Date().toISOString(), projects, collections, photos: [] };

      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        $('#expTxt').textContent = `Packing photo ${i + 1} of ${photos.length}…`;
        const copy = { ...ph, blob: null, thumbBlob: null };
        if (ph.blob) copy.blobB64 = await blobToBase64(ph.blob);
        if (ph.thumbBlob) copy.thumbB64 = await blobToBase64(ph.thumbBlob);
        if (ph.blob) copy.blobType = ph.blob.type;
        if (ph.thumbBlob) copy.thumbType = ph.thumbBlob.type;
        out.photos.push(copy);
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `urban-showroom-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      UI.closeModal();
      UI.toast(`Backed up ${projects.length} projects and ${photos.length} photos.`);
    } catch (e) {
      UI.closeModal();
      UI.toast('The backup failed. If the book is large, try again on a laptop.');
    }
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'image/webp' });
  }

  function importBackup() {
    const input = $('#importInput');
    input.value = '';
    input.onchange = async () => {
      const file = (input.files || [])[0];
      if (!file) return;
      let data = null;
      try {
        data = JSON.parse(await file.text());
      } catch (e) {
        UI.toast('That file is not a showroom backup.');
        return;
      }
      if (!data || data.app !== 'urban-showroom' || !Array.isArray(data.projects)) {
        UI.toast('That file is not a showroom backup.');
        return;
      }

      UI.showModal('Restore', el('div', {}, [
        el('p', { class: 'modal-lede', text: `This file holds ${data.projects.length} projects and ${(data.photos || []).length} photos, exported ${UI.fmtDate(data.exported, { long: true }) || 'at an unknown date'}.` }),
        el('p', { class: 'modal-lede small', text: 'Merging keeps what is here and adds what is missing. Replacing wipes this device first. Anything on here and not in the file is gone for good if you replace.' })
      ]), [
        UI.button('Cancel', { onClick: UI.closeModal }),
        UI.button('Merge', { onClick: () => restore(data, false) }),
        UI.armedButton('Replace everything', 'Wipe and restore?', () => restore(data, true))
      ]);
    };
    input.click();
  }

  async function restore(data, wipe) {
    UI.showModal('Restoring', el('p', { class: 'modal-lede', id: 'resTxt', text: 'Working…' }), []);
    try {
      if (wipe) await Store.clearAll();
      for (const p of data.projects) await Store.putProject(p);
      for (const c of (data.collections || [])) await Store.putCollection(c);

      const photos = data.photos || [];
      const batch = [];
      for (let i = 0; i < photos.length; i++) {
        const ph = { ...photos[i] };
        $('#resTxt').textContent = `Restoring photo ${i + 1} of ${photos.length}…`;
        if (ph.blobB64) ph.blob = base64ToBlob(ph.blobB64, ph.blobType);
        if (ph.thumbB64) ph.thumbBlob = base64ToBlob(ph.thumbB64, ph.thumbType);
        delete ph.blobB64; delete ph.thumbB64; delete ph.blobType; delete ph.thumbType;
        batch.push(ph);
        if (batch.length >= 20) { await Store.putPhotos(batch.splice(0)); await new Promise((r) => setTimeout(r, 0)); }
      }
      if (batch.length) await Store.putPhotos(batch);

      await Store.meta('seeded-v2', new Date().toISOString());
      UI.closeModal();
      await App.reload({ keepQuery: false });
      UI.toast('Restored.');
    } catch (e) {
      UI.closeModal();
      UI.toast('The restore stopped part way. Nothing that was already here was lost.');
    }
  }

  async function removeSamples() {
    const demos = App.projects.filter((p) => p.demo);
    UI.showModal('Remove the samples', el('div', {}, [
      el('p', { class: 'modal-lede', text: `${demos.length} sample ${demos.length === 1 ? 'project' : 'projects'} shipped with the app so it had something to show. Removing them leaves only your own work.` }),
      el('p', { class: 'modal-lede small', text: 'They do not come back.' })
    ]), [
      UI.button('Keep them', { onClick: UI.closeModal }),
      UI.armedButton('Remove them', 'Remove for good?', async () => {
        for (const p of demos) await Store.deleteProject(p.id);
        UI.closeModal();
        await App.reload();
        UI.toast('Samples removed.');
      })
    ]);
  }

  return {
    init, toggle, addMenu, importPhotos, editProject, reviewPairs, settings,
    editProfile, exportBackup, importBackup
  };
})();
