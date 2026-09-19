# Urban Showroom

Every job a contractor has finished, on a map, searchable in plain English, built to be
shown on a phone standing in somebody's driveway.

A customer asks "do you have a showroom?" The contractor hands them his phone. They type
*stamped and colored driveway* and get the closest house where that exact thing was
built — his photographs, the before and after, the pattern, the colour, the finish, and
how far away it is.

Status: **working prototype, not sold.** Kevin Baltz has not bought this. It ships with
32 sample projects so it demos from a cold start; those are real Baltz & Sons
photographs at approximate locations, flagged `demo: true`, badged in the UI, and
removable in one tap from the contractor tools.

---

## What it is

A static site. No server, no database, no build step, no account. Everything the
contractor adds lives in IndexedDB on his own device, which is why the backup in the
tools menu matters: it is the only copy that survives a lost phone.

Built to Kevin Baltz's brief, which asks for a project record keyed on an address rather
than a photo album, photo intelligence that does the filing while the contractor does
the deciding, and a privacy model that never puts a customer's street number in front of
a stranger.

The vocabulary is deliberately trade-agnostic — sixteen trades, twenty-six project
types, from concrete and masonry through carpentry, roofing, cabinetry and remodelling.
Renaming the company in the tools menu is all it takes for this to be a different
contractor's showroom.

## What the customer sees

- **Search in their own words.** "Patio with black granite colored", "pool deck near me",
  "before and after in Germantown", "driveways from 2024". The parse is shown back to
  them in their own phrasing so a miss is correctable rather than mysterious.
- **Three views over the same results** — pins on a map, a gallery, and a wall of
  before/after sets.
- **A before/after presentation mode**: full screen, no chrome, a seam you drag with a
  finger or the arrow keys.
- **Distance from where they are standing**, to the pin they can actually see.

## What the contractor gets

Behind a PIN:

- **Photo import that files itself.** EXIF location and timestamp propose which job each
  photo belongs to and say *why* ("120 yd from this job; taken during it"). Perceptual
  hashing groups shots of the same view and flags duplicates. Stage (before / during /
  after) is inferred from the calendar days the photos span. Captions and tags are
  drafted from what is actually known. **Every one of those is a suggestion on a
  confirmation screen. Nothing is written until he taps Save.**
- **Before/after pairs proposed, not assumed** — matched on framing and the gap between
  days, presented with a confidence and a reason, one tap to accept, reject or swap.
- **A project editor** covering type, trade, material, pattern, finish, colour, features,
  custom tags, dates, cover photo and the four visibility levels.
- **Curated sets** — save a search or a hand-picked group as "Outdoor kitchens for the
  Harts" and open it before a meeting.
- **Backup and restore** as a single JSON file with the photos inside it. The dialog is
  explicit that the file holds every job at every privacy level, the exact addresses and
  each photo's GPS fix — it is a backup, not something to hand anybody.
- **An inbox for photos left unfiled**, so "leave unfiled" is a decision rather than a
  place things disappear to.

## Privacy

Four levels per project: private, my team, shareable with a client, public showroom.
A **hand-over mode** in the tools decides which of them a locked app shows once the
phone leaves the contractor's hand, which is what makes the middle two levels mean
anything. New jobs default to *client-shareable*, so putting one in the always-on
public showroom is a deliberate act rather than the default.

Exact residential addresses are **never** exposed automatically.

- A non-owner viewer gets the coordinate **quantised** to a fixed ~800 ft lattice, not
  offset. An offset is reversible by construction — the first version of this seeded a
  hash on the project id, and since the id is public and the algorithm ships in public
  JavaScript, the front door came back out of it with zero error. Quantisation throws
  the information away instead: every house in a cell produces the identical pin.
- The address is rendered street-only, with the house number, unit and ZIP stripped.
- The **search index is built from that same redacted address**, so typing a house
  number cannot confirm what the display withheld.
- Distances are measured **from the coarsened pin, not the real house**, and rounded to
  25 yards. Place anchors ("near Germantown") are centroids of coarsened points too —
  built from true ones, thirty distances on one screen solve back to a real address.
- `Geo.canView` is the single gate. Every render path draws from `App.visibleProjects()`.
- `exactAddress` is a separate per-project opt-in, off by default, and publishing one to
  the public showroom asks for a second tap.

**What this does not do.** A photograph of a house, beside its street name, with a pin
within 800 ft of it, identifies the parcel to anyone willing to drive down the road. The
coarsening stops bulk extraction and casual snooping; it does not stop somebody
determined to find one specific house. That is a property of showing photographs of
houses, and it is worth saying to a client rather than leaving implied.

The PIN is honest about itself too: the whole app runs in the browser, so it keeps a
customer holding the phone out of the editing screens. It is not a security boundary,
and the dialog says so.

## What is real and what is not

- **Real:** EXIF parsing from raw bytes, perceptual hashing, duplicate detection,
  photo→project matching, stage inference, pair proposals, the whole search engine, the
  privacy model, offline operation.
- **Not a vision model.** "AI captions and tags" here means a deterministic, on-device
  heuristic that assembles a caption from things the app actually knows — the stage, the
  project's own facets, the dominant colour, the date. It never invents an object it
  cannot see. A real vision model needs a server and an API key, neither of which can
  live in a public static repo. `Intel.vision` is a documented swap-in seam for the day
  that changes.
- **No drive time.** Distances are straight-line. There is no routing engine and
  `Geo.fmtMiles` will not pretend otherwise.
- **The sample book has no before/after pairs.** Every Baltz photograph we have is
  finished work. Fabricating a "before" of a real customer's house was not acceptable,
  so the before/after wall is empty until real pairs are imported — two or three sets
  from Kevin would make that demo land.

---

## Run it

```
python3 -m http.server 8777
# http://127.0.0.1:8777/
```

Static files only. The PIN is set on first use of the contractor tools.

## Tests

```
node tools/test_engine.js      # 152 checks: EXIF, geo, privacy, hashing, intel, search, migration
```

The EXIF tests build a structurally real JPEG in memory with computed offsets and read
it back — little- and big-endian, both hemispheres, null island, garbage, truncation.

## Deploy it

Any static host; it is published from `main` at the repository root to GitHub Pages.
See `DEPLOY.md`.

## Layout

```
index.html              markup only — no logic
assets/taxonomy.js      the vocabulary: 7 dimensions, weights, term index
assets/geo.js           distance, the blur, visibility, geocode
assets/exif.js          EXIF from raw bytes (JPEG APP1, WebP RIFF)
assets/imaging.js       resize, encode, dHash, colour layout
assets/store.js         IndexedDB, v1→v2 migration, in-memory fallback
assets/intel.js         matching, stages, pairs, captions, tags
assets/search.js        parse, score, rank
assets/map.js           Leaflet wrapper — never reads a raw coordinate
assets/ui.js            DOM helpers; nothing builds HTML from data
assets/owner.js         the contractor tools
assets/app.js           the controller
vendor/leaflet/         vendored, not a CDN — a blocked CDN once froze the splash
data/seed.json          the sample book
tools/build_seed.py     regenerates it
tools/test_engine.js    the suite
```

Built by [Dive In Digital Marketing](https://diveindigitalmarketing.com).
