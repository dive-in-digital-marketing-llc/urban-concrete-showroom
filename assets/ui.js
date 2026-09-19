/* ==========================================================================
   Urban Showroom — shared UI
   Built by Dive In Digital Marketing

   DOM helpers, the modal and toast, and the pieces both the customer-facing
   showroom and the contractor-facing tools render: project cards, facet
   chips, photo tiles.

   One rule runs through this file: nothing here builds HTML from a string
   that contains data. Every node is created and every value is set through
   textContent, so a project called `<img onerror=…>` is a project with a
   silly name rather than a script. The contractor types captions, filenames
   and tags, and those come off a phone; treating them as markup is how a
   photo caption becomes an exploit.
   ========================================================================== */
'use strict';

const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* Build an element. `html` is accepted for inline SVG icons the app itself
     authors, never for anything a user typed — use `text` for that. */
  function el(tag, attrs = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      // A non-function under an `on*` key used to fall through to
      // setAttribute and become a live inline handler. Nothing does that
      // today; nothing should be able to tomorrow either.
      else if (k.startsWith('on')) { if (typeof v === 'function') n.addEventListener(k.slice(2), v); }
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  const icon = (paths, size = 16, width = 2) => el('span', {
    class: 'ico',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  });

  const ICONS = {
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>',
    camera: '<path d="M3 8h3l2-2.5h8L18 8h3v12H3z"/><circle cx="12" cy="13.5" r="3.6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    swap: '<path d="M7 4L3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 0 8h-1"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'
  };

  /* ---- toast ------------------------------------------------------------ */
  let toastTimer = null;
  function toast(msg, ms = 2800) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  /* ---- modal ------------------------------------------------------------
     One modal element reused by every contractor flow. `onClose` fires on
     every route out — backdrop, button, Escape, and being replaced by the
     next dialog — so a flow can release the object URLs it created without
     leaking them.

     The element has always carried `aria-modal="true"`. That was a claim,
     not a behaviour: focus stayed on whatever opened the dialog, Tab walked
     straight out into the page behind the overlay, and nothing was
     restored on close. A dialog that says it is modal and is not is worse
     than one that says nothing.                                            */
  let modalOnClose = null;
  let modalReturn = null;
  /* A dialog may refuse a casual close. Escape and a backdrop tap are easy
     to hit by accident and used to throw away a filled-in project form or
     a sixty-photo import review without a word. `confirmClose` returns
     false to hold the dialog open; the explicit Cancel button still goes
     straight through `closeModal`. */
  let modalGuard = null;

  function requestClose() {
    if (modalGuard) {
      let allow = true;
      try { allow = modalGuard() !== false; } catch (e) { allow = true; }
      if (!allow) return false;
    }
    closeModal();
    return true;
  }

  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const focusablesIn = (root) =>
    $$(FOCUSABLE, root).filter((n) => n.offsetParent !== null || n === document.activeElement);

  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const panel = $('.modal-panel');
    if (!panel) return;
    const items = focusablesIn(panel);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const here = document.activeElement;
    if (e.shiftKey && (here === first || !panel.contains(here))) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && (here === last || !panel.contains(here))) {
      first.focus(); e.preventDefault();
    }
  }

  function runOnClose() {
    const fn = modalOnClose;
    modalOnClose = null;
    // A flow that replaces the dialog without closing it still has to get
    // its cleanup: `releaseImportSession` is exactly this case, and losing
    // it orphaned every object URL from the previous batch.
    if (fn) { try { fn(); } catch (e) { /* a cleanup must not block the close */ } }
  }

  function showModal(title, body, footButtons, opts = {}) {
    const alreadyOpen = $('#modal').classList.contains('open');
    runOnClose();
    if (!alreadyOpen) modalReturn = document.activeElement;
    $('#modalTitle').textContent = title;
    const b = $('#modalBody');
    b.innerHTML = '';
    b.appendChild(body);
    const f = $('#modalFoot');
    f.innerHTML = '';
    (footButtons || []).forEach((x) => f.appendChild(x));
    f.hidden = !(footButtons || []).length;
    modalOnClose = opts.onClose || null;
    modalGuard = opts.confirmClose || null;
    const m = $('#modal');
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    b.scrollTop = 0;
    if (!alreadyOpen) document.addEventListener('keydown', trapTab, true);

    // Focus the first thing inside, so a keyboard or screen-reader user
    // starts in the dialog rather than behind it.
    setTimeout(() => {
      const panel = $('.modal-panel');
      const items = panel ? focusablesIn(panel) : [];
      const target = items.find((n) => n.classList.contains('input') || n.tagName === 'INPUT' || n.tagName === 'TEXTAREA')
        || items[0];
      if (target) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }, 40);
  }

  function closeModal() {
    const m = $('#modal');
    if (!m.classList.contains('open')) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', trapTab, true);
    modalGuard = null;
    runOnClose();
    const back = modalReturn;
    modalReturn = null;
    if (back && back.focus && document.contains(back)) {
      try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    }
  }

  const modalIsOpen = () => $('#modal').classList.contains('open');

  /* ---- photo sources ----------------------------------------------------
     A photo is either a Blob the contractor imported or a path that shipped
     with the sample book. Both resolve to something an <img> can take, and
     Blob URLs go through the registry so they can be revoked.              */
  function photoSrc(photo, { thumb = false } = {}) {
    if (!photo) return null;
    if (thumb && photo.thumbBlob) return Imaging.objectUrl(photo.thumbBlob, photo.id + ':t');
    if (photo.blob) return Imaging.objectUrl(photo.blob, photo.id);
    if (photo.thumbBlob) return Imaging.objectUrl(photo.thumbBlob, photo.id + ':t');
    return photo.url || null;
  }

  function photoImg(photo, { thumb = false, alt = '', eager = false } = {}) {
    const src = photoSrc(photo, { thumb });
    if (!src) {
      return el('div', { class: 'nophoto', text: 'No photo' });
    }
    /* An image that will not decode — an HEIC out of a restored backup, a
       corrupted blob, an evicted seed file while offline — used to render
       as the browser's broken-image glyph with the alt text spilling over
       the chrome. Swap it for the same placeholder a missing photo gets. */
    const img = el('img', {
      src,
      alt: alt || photo.caption || 'Project photograph',
      loading: eager ? 'eager' : 'lazy',
      decoding: 'async'
    });
    img.addEventListener('error', () => {
      const ph = el('div', { class: 'nophoto', text: 'This photo will not open' });
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    }, { once: true });
    return img;
  }

  /* ---- formatting ------------------------------------------------------- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(iso, { long = false } = {}) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return long
      ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
      : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function fmtRange(project) {
    const a = fmtDate(project.startedAt);
    const b = fmtDate(project.completedAt);
    if (a && b && a !== b) return `${a} – ${b}`;
    return b || a || '';
  }

  function fmtBytes(n) {
    if (!n || !isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  /* ---- chips and tags --------------------------------------------------- */
  function swatchDot(colorId) {
    return el('span', { class: 'sw', style: `background:${swatchFor(colorId)}`, title: labelFor('color', colorId) });
  }

  function facetTag(dim, id, { small = false } = {}) {
    const t = el('span', { class: `tagv${small ? ' sm' : ''}` });
    if (dim === 'color') t.appendChild(swatchDot(id));
    t.appendChild(document.createTextNode(labelFor(dim, id)));
    return t;
  }

  function customTag(text) {
    return el('span', { class: 'tagv custom', text: String(text) });
  }

  /* ---- project card -----------------------------------------------------
     The row in the result sheet. Shows the cover photo, what it is, how far
     away, and whether it has a before/after set — which is the thing a
     customer reacts to fastest.                                            */
  function projectCard(entry, { isOwner, onOpen, first = false } = {}) {
    const p = entry.project;
    const cover = entry.cover || null;
    const dist = Geo.fmtMiles(entry.miles);
    const n = (entry.photos || []).length;

    const thumb = el('div', { class: 'card-thumb' }, [
      cover ? photoImg(cover, { thumb: true, alt: p.name }) : el('div', { class: 'nophoto', text: 'No photo yet' }),
      n > 1 ? el('span', { class: 'n', text: `${n}` }) : null
    ]);

    const eyebrow = el('div', { class: 'card-eyebrow' }, [
      first && dist ? el('span', { class: 'badge', text: 'Nearest match' }) : null,
      entry.spotlight ? el('span', { class: 'badge ghost', text: entry.spotlight }) : null,
      entry.pairCount ? el('span', { class: 'badge pair' }, [icon(ICONS.swap, 11, 2.4), document.createTextNode('Before / after')]) : null,
      document.createTextNode(labelFor('type', p.type) || labelFor('trade', primaryTrade(p)))
    ]);

    const meta = el('div', { class: 'card-meta' }, [
      dist ? el('span', { class: 'card-dist' }, [icon(ICONS.pin, 11, 2.4), document.createTextNode(`${dist} away`)]) : null,
      el('span', { text: Geo.visibleAddress(p, isOwner) }),
      fmtDate(p.completedAt) ? el('span', { text: fmtDate(p.completedAt) }) : null,
      (p.color || []).length ? el('span', { class: 'card-swatches' }, (p.color || []).slice(0, 4).map(swatchDot)) : null,
      p.demo ? el('span', { class: 'badge demo', text: 'Sample' }) : null,
      isOwner && p.visibility !== 'public' ? el('span', { class: 'badge ghost', text: Geo.VISIBILITY_LABEL[p.visibility] || p.visibility }) : null
    ]);

    return el('button', {
      class: `card${first ? ' is-first' : ''}`,
      type: 'button',
      onclick: () => onOpen && onOpen(p.id)
    }, [thumb, el('div', { class: 'card-main' }, [eyebrow, el('div', { class: 'card-title', text: p.name }), meta])]);
  }

  /* ---- gallery tile -----------------------------------------------------
     The brief asks for a "gallery view optimized for quickly showing work to
     a prospective customer", so this is photo first and text second.       */
  function galleryTile(entry, { isOwner, onOpen } = {}) {
    const p = entry.project;
    const cover = entry.cover;
    const dist = Geo.fmtMiles(entry.miles);
    return el('button', { class: 'tile', type: 'button', onclick: () => onOpen && onOpen(p.id) }, [
      el('div', { class: 'tile-img' }, [
        cover ? photoImg(cover, { thumb: true, alt: p.name }) : el('div', { class: 'nophoto', text: 'No photo yet' }),
        entry.pairCount ? el('span', { class: 'tile-flag' }, [icon(ICONS.swap, 11, 2.4), document.createTextNode('B/A')]) : null,
        (entry.photos || []).length > 1 ? el('span', { class: 'tile-n', text: String(entry.photos.length) }) : null
      ]),
      el('div', { class: 'tile-cap' }, [
        el('span', { class: 'tile-title', text: p.name }),
        el('span', { class: 'tile-meta', text: [dist ? `${dist} away` : '', p.city].filter(Boolean).join(' · ') })
      ])
    ]);
  }

  /* ---- empty states -----------------------------------------------------
     An empty screen should say what to do next, not just that there is
     nothing here.                                                          */
  function emptyState({ title, body, actions = [] }) {
    return el('div', { class: 'empty' }, [
      el('h3', { text: title }),
      body ? el('p', { text: body }) : null,
      actions.length ? el('div', { class: 'btn-row center' }, actions) : null
    ]);
  }

  function button(label, { kind = 'ghost', onClick, icon: ic, small = false, wide = false, disabled = false } = {}) {
    const b = el('button', {
      class: `btn btn-${kind}${small ? ' btn-sm' : ''}${wide ? ' btn-wide' : ''}`,
      type: 'button',
      disabled: disabled || null
    });
    if (ic) b.appendChild(icon(ic, small ? 14 : 16, 2.2));
    b.appendChild(document.createTextNode(label));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  /* ---- form controls ----------------------------------------------------
     Every control gets a stable id so the platform can carry its value and
     focus across a republish.                                              */
  function field(labelText, control, { hint, required = false, id } = {}) {
    const lbl = el('label', { class: 'field-label', for: id || control.id || null });
    lbl.appendChild(document.createTextNode(labelText));
    if (required) lbl.appendChild(el('span', { class: 'req', text: ' *' }));
    return el('div', { class: 'field' }, [lbl, control, hint ? el('p', { class: 'hint', text: hint }) : null]);
  }

  function input(id, { type = 'text', value = '', placeholder = '', maxlength, inputmode, min, max } = {}) {
    return el('input', {
      class: 'input', id, type, value, placeholder,
      maxlength: maxlength || null, inputmode: inputmode || null,
      min: min || null, max: max || null, autocomplete: 'off'
    });
  }

  function textarea(id, { value = '', placeholder = '', maxlength = 800 } = {}) {
    const t = el('textarea', { class: 'input', id, placeholder, maxlength });
    t.value = value;
    return t;
  }

  function select(id, options, selected) {
    return el('select', { class: 'input', id },
      options.map((o) => el('option', { value: o.value, selected: o.value === selected || null }, [document.createTextNode(o.label)])));
  }

  /* A multi-select rendered as tappable pills. Returns the element; read the
     chosen values from the Set the caller passed in. */
  function pillGroup(list, chosen, { withSwatch = false, onChange } = {}) {
    const wrap = el('div', { class: 'pills' });
    list.forEach((item) => {
      const b = el('button', {
        class: `pill${chosen.has(item.id) ? ' on' : ''}`,
        type: 'button',
        'aria-pressed': chosen.has(item.id) ? 'true' : 'false'
      });
      if (withSwatch && item.swatch) b.appendChild(el('span', { class: 'sw', style: `background:${item.swatch}` }));
      b.appendChild(document.createTextNode(item.label));
      b.addEventListener('click', () => {
        if (chosen.has(item.id)) chosen.delete(item.id); else chosen.add(item.id);
        b.classList.toggle('on');
        b.setAttribute('aria-pressed', chosen.has(item.id) ? 'true' : 'false');
        if (onChange) onChange(chosen);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function toggle(id, labelText, sub, checked) {
    const cb = el('input', { type: 'checkbox', id });
    cb.checked = !!checked;
    return el('label', { class: 'switch', for: id }, [
      cb, el('span', { class: 'track' }),
      el('span', { class: 'tx' }, [
        el('b', { text: labelText }),
        sub ? el('span', { text: sub }) : null
      ])
    ]);
  }

  /* A confirm that arms on the first tap, so a destructive button can never
     fire from a mis-tap on a phone in a truck. */
  function armedButton(label, armedLabel, onConfirm, { kind = 'danger' } = {}) {
    const b = button(label, { kind });
    let armed = false;
    let timer = null;
    b.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        b.textContent = armedLabel;
        b.classList.add('armed');
        timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('armed'); }, 4000);
        return;
      }
      clearTimeout(timer);
      onConfirm();
    });
    return b;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  return {
    $, $$, el, icon, ICONS, toast,
    showModal, closeModal, requestClose, modalIsOpen,
    photoSrc, photoImg,
    fmtDate, fmtRange, fmtBytes,
    swatchDot, facetTag, customTag,
    projectCard, galleryTile, emptyState,
    button, field, input, textarea, select, pillGroup, toggle, armedButton,
    debounce
  };
})();
