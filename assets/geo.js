/* ==========================================================================
   Urban Showroom — geography
   Built by Dive In Digital Marketing

   Distance, address lookup, and the privacy jitter. The brief is explicit
   about the last one: "exact residential addresses should not automatically
   be exposed to prospects or the public" and "public-facing map views should
   support approximate locations or generalized neighborhoods."

   So a project's coordinate exists twice. The true one, which the contractor
   sees and navigates to, and a blurred one that is all a prospect ever gets.
   The blur is deterministic — derived from the project id — so a public pin
   does not jiggle around the block every time the page reloads, which would
   both look broken and, over enough reloads, average out to the real house.
   ========================================================================== */
'use strict';

const Geo = (() => {
  const R_MILES = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;

  /* Great-circle distance in miles. The app covers one metro, so a spherical
     earth is well inside the error a dropped pin already carries. */
  function milesBetween(a, b) {
    if (!a || !b) return null;
    if (!isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) return null;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Drive time is deliberately never computed. There is no routing engine
     here, and calling 4.2 straight-line miles "nine minutes" would be a
     number nobody measured. The UI says "away", not "minutes". */
  function fmtMiles(mi) {
    if (mi === null || mi === undefined || !isFinite(mi)) return null;
    if (mi < 0.1) return 'right here';
    /* Yards, rounded to 25. A one-yard readout looks precise and is a
       privacy hole: two exact distances from two known anchors put a
       stranger on the homeowner's doorstep, however blurred the pin is. */
    if (mi < 1) return `${Math.max(25, Math.round((mi * 5280) / 3 / 25) * 25)} yd`;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }

  /* ---- coarsening -------------------------------------------------------
     This used to be a jitter: a stable pseudo-random offset seeded from the
     project id. That was not a privacy mechanism, it was an encoding. The
     seed is the project id, the id is public, and the algorithm ships in
     public JavaScript, so anyone holding a blurred pin could run the same
     two hashes backwards and recover the front door exactly — measured at
     0.0 ft of error. An offset is reversible by construction; nothing about
     choosing a better hash fixes that.

     So the pin is quantised instead. The coordinate is snapped to a fixed
     lattice roughly 800 ft on a side and the cell it lands in is all the
     viewer ever gets. Quantisation throws information away rather than
     hiding it: every house inside a cell produces the identical pin, and no
     amount of arithmetic recovers which one it was. Averaging over repeated
     views gains nothing either, because every view returns the same number.

     What this does NOT do, and the copy must not imply it does: a
     photograph of a house, next to its street name, on a pin within 800 ft,
     identifies the parcel to anybody willing to drive down the road. The
     coarsening stops bulk extraction and casual snooping. Somebody
     determined to find one specific house will find it. That is a property
     of showing photographs of houses, not of this function.               */
  const CELL = 0.0022;     // degrees of latitude; ~800 ft

  function blur(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return { lat, lng };
    const qLat = Math.round(lat / CELL) * CELL;
    // Longitude cells are widened by latitude so a cell stays roughly square
    // on the ground. Derived from the SNAPPED latitude, so every pin in a
    // lattice row uses the identical column width.
    const cellLng = CELL / Math.max(0.2, Math.cos(toRad(qLat)));
    const qLng = Math.round(lng / cellLng) * cellLng;
    return { lat: qLat, lng: qLng };
  }

  /* The brief's four levels. Ordered, so a viewer at one level sees
     everything at or below it.

       private  only the contractor
       team     the contractor's own staff
       client   shareable with a named customer
       public   the showroom a walk-in prospect is handed

     `exactAddress` is separate on purpose. Visibility answers WHO may see
     the project; exactAddress answers whether they get the house number.
     The brief wants the second to default to no regardless of the first:
     "exact residential addresses should not automatically be exposed". */
  const VISIBILITY = ['private', 'team', 'client', 'public'];
  const VISIBILITY_LABEL = {
    private: 'Private \u2014 only me',
    team: 'My team',
    client: 'Shareable with a client',
    public: 'Public showroom'
  };

  function canView(project, viewer) {
    // viewer: 'owner' | 'team' | 'client' | 'public'
    if (viewer === 'owner') return true;
    const need = VISIBILITY.indexOf(project.visibility || 'private');
    const has = VISIBILITY.indexOf(viewer === 'team' ? 'team' : viewer === 'client' ? 'client' : 'public');
    if (need < 0) return false;
    // A project marked 'client' is visible to a client and to the public
    // showroom only if it is marked 'public'. Higher index = wider audience.
    return need >= has;
  }

  /* The coordinate a given viewer is allowed to see. */
  function visibleCoord(project, isOwner) {
    if (project.lat == null || project.lng == null) return null;
    if (isOwner || project.exactAddress === true) {
      return { lat: project.lat, lng: project.lng, exact: true };
    }
    const b = blur(project.lat, project.lng);
    return { lat: b.lat, lng: b.lng, exact: false };
  }

  /* The address string a given viewer is allowed to see. Drops the house
     number for everyone but the contractor. */
  function visibleAddress(project, isOwner) {
    if (isOwner) {
      return project.address || [project.neighborhood, project.city, project.state].filter(Boolean).join(', ') || 'No address';
    }
    if (project.exactAddress === true && project.address) return project.address;
    const street = streetOnly(project.address);
    const parts = [street, project.neighborhood, project.city, project.state].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Location approximate';
  }

  /* "1234 Poplar Ave, Collierville TN" → "Poplar Ave". Strips a leading
     house number and any unit, keeping the street so the area still reads. */
  function streetOnly(address) {
    if (typeof address !== 'string' || !address.trim()) return '';
    let first = address.split(',')[0].trim();

    /* An address typed without commas — "1420 Poplar Ave Collierville TN
       38017" — used to arrive here whole, and the segment split left the
       ZIP in place. Drop a trailing ZIP and state before anything else. */
    first = first
      .replace(/\s+\d{5}(-\d{4})?\s*$/, '')
      .replace(/\s+[A-Z]{2}\s*$/, '')
      .trim();

    /* Units come off BEFORE the house number, not after. Anchored at ^,
       the number strip could not see past a leading "Unit B " or "#12 ",
       so "Apt 4 1234 Poplar Ave" kept its house number — and that is
       exactly how an address is typed off a work order.

       The number pattern also has to refuse an ordinal street name. An
       optional trailing letter with no lookahead turned "5th Ave" into
       "h Ave"; requiring whitespace after the token means "5th" is not a
       house number and survives, while "1234B " still goes. */
    const stripped = first
      .replace(/(\b(apt|apartment|unit|ste|suite|bldg|building|lot)\b|#)\s*[\w-]+/gi, ' ')
      .replace(/^\s*\d+[\d\-\/]*[A-Za-z]?(?=\s)\s*/, '')
      .replace(/^\s*\d+[\d\-\/]*[A-Za-z]?$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return stripped || '';
  }

  /* ---- address lookup ---------------------------------------------------
     Nominatim: free, keyless, and rate limited to roughly one request a
     second. It only fires on an explicit tap, and every failure path falls
     back to "drop the pin yourself" — which is what happens on a job site
     with one bar.

     Returns a hit, null for "no such address", or undefined for "could not
     reach the service". The caller tells those apart in the UI, because they
     need different advice.                                                  */
  async function geocode(address, { timeoutMs = 9000 } = {}) {
    const q = String(address || '').trim();
    if (!q) return null;
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=us&q=' + encodeURIComponent(q);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return undefined;
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) return null;
      const r = rows[0];
      const a = r.address || {};
      return {
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        display: r.display_name || q,
        city: a.city || a.town || a.village || a.hamlet || a.municipality || '',
        state: stateAbbrev(a.state) || '',
        neighborhood: a.neighbourhood || a.suburb || a.quarter || ''
      };
    } catch (e) {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  const STATES = {
    tennessee: 'TN', mississippi: 'MS', arkansas: 'AR', missouri: 'MO',
    alabama: 'AL', kentucky: 'KY', georgia: 'GA', louisiana: 'LA', texas: 'TX'
  };
  function stateAbbrev(name) {
    if (!name) return '';
    const k = String(name).trim().toLowerCase();
    if (STATES[k]) return STATES[k];
    return /^[A-Z]{2}$/.test(String(name).trim()) ? String(name).trim() : '';
  }

  /* Bounding box of a set of {lat,lng}, padded by a fraction of its span. */
  function bounds(points, padFraction = 0.12) {
    const pts = (points || []).filter((p) => p && isFinite(p.lat) && isFinite(p.lng));
    if (!pts.length) return null;
    let n = -Infinity, s = Infinity, e = -Infinity, w = Infinity;
    pts.forEach((p) => {
      n = Math.max(n, p.lat); s = Math.min(s, p.lat);
      e = Math.max(e, p.lng); w = Math.min(w, p.lng);
    });
    const padLat = Math.max((n - s) * padFraction, 0.004);
    const padLng = Math.max((e - w) * padFraction, 0.004);
    return { n: n + padLat, s: s - padLat, e: e + padLng, w: w - padLng };
  }

  return {
    milesBetween, fmtMiles, blur, visibleCoord, visibleAddress, streetOnly,
    geocode, bounds, stateAbbrev,
    VISIBILITY, VISIBILITY_LABEL, canView
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
