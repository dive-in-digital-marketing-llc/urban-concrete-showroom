# Urban Concrete Showroom

A map of every job Baltz & Sons has poured, searchable in plain English, built to be
shown on a phone standing in somebody's driveway.

A customer asks "do you have a showroom?" Kevin hands them his phone. They type
*stamped and colored driveway* and get the closest house where that exact thing was
built — his photographs, the pattern, the colour, the finish, and how far away it is.

Status: **working prototype, not sold.** Kevin Baltz has not bought this. It ships with
32 sample pins so it demos from a cold start; those are real Baltz & Sons photographs at
approximate locations, flagged `demo: true`, badged in the UI, and removable in one tap.

---

## Run it

```
cd apps/urban-concrete-showroom
python3 -m http.server 8777
# http://127.0.0.1:8777/
```

Static files only — no build step, no server, no database. Owner PIN is `1945` until
changed in owner tools.

## Deploy it

Any static host. It is deliberately not part of the WordPress theme: nothing here needs
PHP, and keeping it separate means a theme deploy can never take the showroom down.
Serve `apps/urban-concrete-showroom/` at a path or subdomain and it works as-is.

Two things a host must get right:

- **HTTPS.** Geolocation and the service worker both refuse to run without it, and the
  whole product is distance.
- **Correct MIME type on `manifest.webmanifest`** (`application/manifest+json`), or the
  install-to-home-screen prompt never appears.

---

## What is in here

```
index.html              the app shell
assets/vocab.js         the search vocabulary — services, surfaces, patterns,
                        finishes, colours, features, and every way people say them
assets/app.js           store, search engine, map, owner tools
assets/app.css          styles, carried from the site's "Foundry" design system
data/seed.json          the 32 sample pins (generated)
tools/build_seed.py     regenerates data/seed.json
tools/test_search.js    headless checks on the parser and the ranker
vendor/leaflet/         Leaflet 1.9.4, vendored (BSD-2-Clause, LICENSE included)
img/                    project photographs and app icons
sw.js                   service worker: offline shell, tile and photo cache
```

### Where the data lives

In the browser, in IndexedDB, on the phone that added it. There is no account and no
server. That is a deliberate trade:

- **For:** works with no signal, costs nothing to run, no customer address ever leaves
  the device, and there is nothing of ours for Kevin to be locked into.
- **Against:** the book does not sync between phones by itself. Export and import is
  how a job gets from Kevin's phone to a crew lead's, and it is one tap each way.

If the product is ever sold to more than one contractor, that is the line where a real
backend starts earning its keep. Not before.

---

## The search

This is the part worth reading before changing anything.

A homeowner does not type `slug:stamped-concrete`. They type *stamped and colored
driveway*, or *patio with black granite colored* — several facets at once, in the order
a person speaks them. So the query is parsed, not substring-matched:

1. **Normalise** — `&` becomes `and`, punctuation goes, case goes.
2. **Strip the instruction words** — *near me*, *closest* and friends mean "sort by
   distance", not "filter on the word near".
3. **Walk longest-phrase-first** against the vocabulary. This is what makes
   `black granite` resolve to one colour rather than the word *black* plus the word
   *granite*, and why `colonial cobble` is found before the bare `cobble`.
4. **Whatever is left** is free text, scored against the job's own words.

Then every job is scored across six dimensions — service, surface, colour, pattern,
finish, feature. Three things about the scoring are load-bearing:

- **A job sits on more than one service line.** A stamped cobblestone driveway is filed
  under Stamped Concrete *and* it is a driveway. With a single service value, a search
  for "cobblestone driveway" ranked two driveways that were not cobble above the one
  that was. `serviceSet()` derives the implied lines from the surface and the finish.
- **A miss demotes, it does not veto.** Ask for something he has never built and you
  should still see the nearest thing to it, lower down.
- **Rare facets count for more.** Without this, the common noun swamps the specific
  one: "seamless slate patio" scored three ordinary patios above the single seamless
  slate job in the book, because *patio* hit twice and *seamless slate* only once.

And when somebody names a rare thing that nothing near the top has, the best job that
*does* have it is promoted to second place and labelled "Closest … we have built".
Promoting beats reranking: nothing relevant gets demoted, and the customer is told
plainly that it is not an exact match.

```
node tools/test_search.js
```

Runs the parser and ranker headless against `data/seed.json`, including the two queries
this product was pitched on. It exits non-zero on failure, so CI can gate on it. Every
check in there is a bug that was actually found, not a hypothetical.

### Adding vocabulary

`assets/vocab.js`, `{id, label, terms}`. Put in every way somebody might type it,
including the misspellings you hear on the phone. Multi-word terms are safe — the
parser prefers the longest match. Then rerun the tests.

---

## What the owner side does

Behind a four-digit PIN, so the phone can be handed to a customer.

**Adding a job** takes a name, a location, photos, and a few taps:

- **Location** three ways: *I am here now* (GPS — the right answer, because he is
  standing on the job the day he finishes it), an address lookup, or dragging the pin.
- **Photos** straight from the camera, up to twelve. Every one is drawn to a canvas and
  re-encoded before it is stored — phone cameras produce 4–12MB files and twenty jobs of
  those would blow past any browser quota.
- **Facets** as buttons, not typing. This is the part that decides whether a customer
  finds the job in two years, so the form says so.

**Privacy is on by default.** These are customers' houses. With it on, a visitor sees
the street and the town and a pin on the block — never the house number. Turning it off
for a job is a deliberate act and the form says to ask the homeowner first.

**Export** writes every job and photo to one JSON file. **Import** merges one back.

---

## Things that will bite

- **Nominatim** (the address lookup) is free, keyless, and rate-limited to roughly one
  request a second. It only fires on an explicit tap, and every failure path falls back
  to "drop the pin yourself" — which is what happens on a job site with one bar.
- **Map tiles** come from CARTO's free basemap. Fine at this volume; if the app is ever
  sold more widely, that needs a paid tile plan or a self-hosted style.
- **Leaflet is vendored on purpose.** It was on a CDN, and the first browser test found
  that a blocked CDN left the app stuck on its splash screen forever. It now ships with
  the app, and the app renders the list, the search and the photos even if the map
  cannot load at all.
- **Storage is per-device and per-origin.** Clearing site data clears the book. Export
  before changing phones; owner tools say so.
- **The sample pins must go** the moment Kevin adds real work. Do not strip the `demo`
  flag to make a screenshot look better — it is what keeps approximate locations from
  being read as real job sites.
