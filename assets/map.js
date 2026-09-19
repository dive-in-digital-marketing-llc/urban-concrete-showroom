/* ==========================================================================
   Urban Showroom — map
   Built by Dive In Digital Marketing

   The brief asks for "map-based browsing of completed projects where privacy
   settings permit", and that last clause is the whole design. This module
   never reads project.lat directly. It asks Geo.visibleCoord() what the
   current viewer is allowed to see, so a prospect looking at the same screen
   as the contractor sees a pin on the block rather than on the front door.

   Leaflet is vendored rather than pulled from a CDN, and every entry point
   here tolerates it being absent: a contractor on a job site with one bar
   still gets the list, the search and the photos, and the map comes back
   when he has signal.
   ========================================================================== */
'use strict';

const ShowroomMap = (() => {
  /* One glyph per trade, so a customer can read the map before reading a
     single label. Kept deliberately simple: these render at 17px. */
  const GLYPH = {
    concrete: '<path d="M3 7h18v12H3z"/><path d="M3 13h18"/><path d="M9 7v12M15 7v12"/>',
    'decorative-concrete': '<path d="M3 3h18v18H3z"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    masonry: '<path d="M3 5h18v5H3zM3 14h18v5H3z"/><path d="M9 5v5M15 14v5"/>',
    pools: '<path d="M3 17c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M3 12c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M7 9V5a2 2 0 0 1 4 0M13 9V5a2 2 0 0 1 4 0"/>',
    'outdoor-living': '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    landscaping: '<path d="M12 21V11"/><path d="M12 11c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 14c0-3-2.5-5-5.5-5 0 3 2.5 5 5.5 5z"/>',
    carpentry: '<path d="M4 20l6-6"/><path d="M13 3l8 8-4 4-8-8z"/><path d="M9 7l3-3"/>',
    fencing: '<path d="M4 20V8l3-3 3 3v12M14 20V8l3-3 3 3v12"/><path d="M2 12h20M2 16h20"/>',
    flooring: '<path d="M3 5h18v14H3z"/><path d="M3 12h18M9 5v14M15 5v14"/>',
    cabinetry: '<path d="M4 3h16v18H4z"/><path d="M12 3v18M8 11h1M15 11h1"/>',
    painting: '<path d="M4 4h12v6H4z"/><path d="M10 10v4"/><path d="M8 14h4v7H8z"/>',
    roofing: '<path d="M2 12L12 4l10 8"/><path d="M5 12v8h14v-8"/>',
    plumbing: '<path d="M7 4v6a5 5 0 0 0 10 0V7"/><path d="M4 4h6M14 4h6"/><path d="M12 20v-4"/>',
    electrical: '<path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z"/>',
    remodeling: '<path d="M3 21h18"/><path d="M5 21V9l7-6 7 6v12"/><path d="M10 21v-6h4v6"/>',
    commercial: '<path d="M4 21V6l8-3 8 3v15"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01"/>'
  };

  let map = null;
  let layer = null;
  let meMarker = null;
  let available = false;
  let onSelect = null;

  const hasLeaflet = () => typeof L !== 'undefined' && L && typeof L.map === 'function';

  function init(containerId, { onSelect: sel } = {}) {
    onSelect = sel || null;
    if (!hasLeaflet()) {
      available = false;
      fallbackNotice(containerId);
      return null;
    }
    try {
      map = L.map(containerId, { zoomControl: true, attributionControl: true, tap: true })
        .setView([35.18, -89.78], 10);

      /* CARTO dark matter: the only widely available free basemap that is
         already a warm-neutral dark. A light basemap under this palette
         looks like a rendering bug. */
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      }).addTo(map);

      map.zoomControl.setPosition('bottomright');
      layer = L.layerGroup().addTo(map);
      available = true;
      return map;
    } catch (e) {
      available = false;
      fallbackNotice(containerId);
      return null;
    }
  }

  function fallbackNotice(containerId) {
    document.body.classList.add('no-map');
    const host = document.getElementById(containerId);
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(UI.el('div', { class: 'mapfallback' }, [
      UI.el('p', { class: 'mf-title', text: 'Map unavailable offline' }),
      UI.el('p', { class: 'mf-body', text: 'Search, photos and distances all still work. The map comes back when you have signal.' })
    ]));
  }

  function pinHTML(project, cls) {
    const glyph = GLYPH[primaryTrade(project)] || GLYPH.concrete;
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

  /* Grid clustering. Cheap, deterministic and enough for a metro's worth of
     pins; a clustering plugin would be another 40KB for no visible gain. */
  function cluster(items) {
    const z = map.getZoom();
    if (z >= 12 || items.length <= 12) return items.map((r) => ({ single: r }));
    const cell = z >= 10 ? 46 : 62;
    const buckets = new Map();
    items.forEach((r) => {
      const p = map.latLngToContainerPoint([r.coord.lat, r.coord.lng]);
      const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    });
    return [...buckets.values()].map((g) => (g.length === 1 ? { single: g[0] } : { group: g }));
  }

  /* `entries` are search results; `isOwner` decides which coordinate each
     project is allowed to expose. */
  function draw(entries, { isOwner = false, activeId = null, here = null, dimUnmatched = false } = {}) {
    if (!available || !layer) return;
    layer.clearLayers();

    const placed = entries
      .map((e) => ({ entry: e, coord: Geo.visibleCoord(e.project, isOwner) }))
      .filter((r) => r.coord);

    const nearestId = entries.find((e) => e.miles != null) ? entries.find((e) => e.miles != null).project.id : null;

    if (here) {
      L.circleMarker([here.lat, here.lng], {
        radius: 13, color: 'transparent', fillColor: '#5B9BD5', fillOpacity: 0.16, interactive: false
      }).addTo(layer);
      meMarker = L.marker([here.lat, here.lng], {
        icon: L.divIcon({ className: '', html: '<div class="mepin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false, zIndexOffset: -500
      }).addTo(layer);
    }

    cluster(placed).forEach((node) => {
      if (node.group) {
        const g = node.group;
        const lat = g.reduce((s, r) => s + r.coord.lat, 0) / g.length;
        const lng = g.reduce((s, r) => s + r.coord.lng, 0) / g.length;
        const m = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'pin-hit',
            html: `<div class="cluster ${g.length > 9 ? 'lg' : ''}">${g.length}</div>`,
            iconSize: [44, 44], iconAnchor: [22, 22]
          }),
          keyboard: false
        });
        m.on('click', () => map.flyTo([lat, lng], Math.min(map.getZoom() + 2.4, 16), { duration: 0.6 }));
        m.addTo(layer);
        return;
      }

      const { entry, coord } = node.single;
      const p = entry.project;
      const cls = [
        dimUnmatched ? 'is-match' : '',
        p.id === activeId ? 'is-active' : '',
        p.id === nearestId && dimUnmatched ? 'is-nearest' : ''
      ].filter(Boolean).join(' ');

      const m = L.marker([coord.lat, coord.lng], {
        icon: L.divIcon({ className: 'pin-hit', html: pinHTML(p, cls), iconSize: [38, 46], iconAnchor: [19, 46] }),
        title: p.name,
        riseOnHover: true,
        alt: p.name
      });
      m.on('click', () => onSelect && onSelect(p.id));
      m.addTo(layer);
    });
  }

  function fit(entries, { isOwner = false, here = null, animate = true } = {}) {
    if (!available || !map) return;
    const pts = entries.slice(0, 30)
      .map((e) => Geo.visibleCoord(e.project, isOwner))
      .filter(Boolean)
      .map((c) => [c.lat, c.lng]);
    if (here) pts.push([here.lat, here.lng]);
    if (!pts.length) return;

    const sheetWide = window.innerWidth >= 860;
    if (pts.length === 1) {
      map.flyTo(pts[0], 15, { duration: animate ? 0.7 : 0 });
      return;
    }
    try {
      map.flyToBounds(L.latLngBounds(pts), {
        paddingTopLeft: [sheetWide ? 70 : 50, 170],
        paddingBottomRight: [sheetWide ? 440 : 50, sheetWide ? 60 : 230],
        maxZoom: 15,
        duration: animate ? 0.75 : 0
      });
    } catch (e) { /* a degenerate bounds is not worth throwing over */ }
  }

  function focus(project, { isOwner = false, zoom = 16 } = {}) {
    if (!available || !map) return;
    const c = Geo.visibleCoord(project, isOwner);
    if (!c) return;
    map.flyTo([c.lat, c.lng], zoom, { duration: 0.8 });
  }

  function on(event, handler) { if (available && map) map.on(event, handler); }
  function invalidate() { if (available && map) setTimeout(() => map.invalidateSize(), 60); }

  return {
    init, draw, fit, focus, on, invalidate,
    get available() { return available; },
    get instance() { return map; }
  };
})();
