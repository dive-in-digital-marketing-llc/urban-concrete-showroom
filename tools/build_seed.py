#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build data/seed.json — the sample book the app ships with.

HONESTY RULES (didm/CLAUDE.md, Quality bar: "distinguish observed from inferred")

The PHOTOS are real. Every file here is a Baltz & Sons project photograph
already published on baltzconcrete.com.

The LOCATIONS are not. Nobody has given us job addresses, so each project sits
at an approximate point inside a town Baltz & Sons actually serves, and every
record carries demo=true. The app badges those and offers a one-tap removal.
Do not strip the flag to make a screenshot look better.

There are NO seeded before/after pairs, and that is deliberate. Every
photograph we have is of finished work, so every seeded photo is stage
"after". Inventing a "before" would mean fabricating a picture of a real
customer's house. The pairing engine is real and covered by tests in
tools/test_intel.js; it has nothing to pair until Kevin imports photographs
he took before he started. The app's before/after screen says exactly that.

The FACETS are read off the photograph and its filename. Where a value could
not be read confidently it is left off rather than guessed: an empty facet
costs a search hit, a wrong one costs trust.

Regenerate:  python3 tools/build_seed.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
OUT = os.path.join(APP, 'data', 'seed.json')

# Approximate town centres for the service areas. These place a pin in the
# right town; they are not the coordinates of any actual job site.
TOWNS = {
    'Memphis':      (35.1495, -90.0490, 'TN'),
    'Collierville': (35.0420, -89.6645, 'TN'),
    'Germantown':   (35.0868, -89.8101, 'TN'),
    'Arlington':    (35.2959, -89.6687, 'TN'),
    'Eads':         (35.1742, -89.6172, 'TN'),
    'Bartlett':     (35.2045, -89.8739, 'TN'),
    'Cordova':      (35.1556, -89.7770, 'TN'),
    'Lakeland':     (35.2453, -89.7362, 'TN'),
    'Millington':   (35.3415, -89.8973, 'TN'),
    'Covington':    (35.5645, -89.6461, 'TN'),
    'Brighton':     (35.4839, -89.7245, 'TN'),
    'Munford':      (35.4459, -89.8117, 'TN'),
    'Oakland':      (35.2287, -89.5162, 'TN'),
    'Somerville':   (35.2359, -89.3448, 'TN'),
    'Olive Branch': (34.9618, -89.8295, 'MS'),
    'Hernando':     (34.8226, -89.9915, 'MS'),
    'Southaven':    (34.9890, -90.0126, 'MS'),
}

# Seeded so a rebuild does not reshuffle every pin and churn the diff.
RNG = random.Random(1945)

MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December']


def place(town):
    lat, lng, state = TOWNS[town]
    return (
        round(lat + RNG.uniform(-0.028, 0.028), 6),
        round(lng + RNG.uniform(-0.034, 0.034), 6),
        state,
    )


# slug, name, type, trade[], material[], pattern, finish[], color[], feature[],
# tags[], town, neighborhood, month, year, notes, photo files[]
PROJECTS = [
    ('ashlar-drive-collierville', 'Ashlar slate driveway, wet-look finish',
     'driveway', ['decorative-concrete', 'concrete'], ['poured-concrete'], 'ashlar-slate',
     ['color-hardener', 'antique-release', 'sealed-gloss'], ['charcoal', 'slate-grey'], ['border'],
     ['driveway replacement', 'wet look'],
     'Collierville', 'Bray Station', 4, 2024,
     'Full driveway replacement in ashlar slate with a charcoal hardener and a darker antique '
     'release in the joints. Finished with a solvent sealer, which is what gives it the wet look '
     'in the photo — that is the sealer, not the colour, and it needs redoing every three years.',
     ['stamped-concrete-driveway-memphis-tn-ashlar-wet-finish',
      'stamped-concrete-driveway-memphis-tn-random-stone-border']),

    ('cobble-drive-germantown', 'Colonial cobble driveway and garage apron',
     'driveway', ['decorative-concrete', 'concrete'], ['poured-concrete'], 'colonial-cobble',
     ['color-hardener', 'antique-release'], ['sandstone', 'walnut'], ['border'],
     ['cobblestone', 'turnaround'],
     'Germantown', 'Farmington', 9, 2023,
     'Cobble field with a hand-cut border running the length of the drive and squared off at the '
     'apron. The tight radius at the turnaround is stamped, not cut — that is the part that '
     'takes the extra day.',
     ['stamped-concrete-driveway-memphis-tn-cobblestone-approach',
      'stamped-concrete-driveway-memphis-tn-cobblestone-garage-apron',
      'colonial-cobble-stamped-driveway-memphis-tn-detail']),

    ('eurofan-drive-eads', 'European fan driveway',
     'driveway', ['decorative-concrete', 'concrete'], ['poured-concrete'], 'european-fan',
     ['color-hardener', 'antique-release'], ['harvest-gold', 'chestnut'], [],
     ['european fan'],
     'Eads', '', 6, 2023,
     'European fan is the hardest pattern to keep straight on a long run, because the fans have to '
     'stay on a line the eye can follow. Gold hardener with a brown release sitting in the joints.',
     ['european-fan-stamped-concrete-driveway-memphis-tn']),

    ('dogwood-drive-arlington', 'Random stone approach under the dogwoods',
     'driveway', ['decorative-concrete', 'concrete'], ['poured-concrete'], 'random-stone',
     ['color-hardener', 'antique-release'], ['slate-grey', 'driftwood'], ['border'],
     ['root heave', 'tree roots'],
     'Arlington', '', 3, 2024,
     'Random stone field with a running-bond border. Root pressure from the trees either side is '
     'why this one is thicker than a standard drive and jointed where it is.',
     ['stamped-concrete-driveway-memphis-tn-dogwoods-hero']),

    ('stamped-patio-cordova', 'Stamped back patio, adobe and terra cotta',
     'patio', ['decorative-concrete', 'concrete'], ['poured-concrete'], 'ashlar-slate',
     ['integral-color', 'antique-release'], ['adobe', 'terra-cotta'], [],
     [], 'Cordova', '', 5, 2022,
     'Integral colour through the slab with a release accent, so a chip shows the same colour '
     'rather than grey. Ashlar pattern, squared to the house.',
     ['stamped-concrete-memphis-tn-patio',
      'baltz-sons-concrete-memphis-tn-finished-patio']),

    ('seatwall-patio-bartlett', 'Stamped patio with a poured seat wall',
     'patio', ['decorative-concrete', 'concrete', 'masonry'], ['poured-concrete'], 'random-stone',
     ['color-hardener', 'antique-release'], ['chestnut', 'sandstone'], ['seat-wall'],
     [], 'Bartlett', '', 8, 2023,
     'The seat wall is poured and capped as part of the same job, so the cap colour matches the '
     'field instead of being chased later with a stain.',
     ['stamped-concrete-seat-wall-memphis-tn-stained-patio']),

    ('compass-patio-collierville', 'Compass star fire pit patio, hand-cut and stained',
     'patio', ['decorative-concrete', 'outdoor-living'], ['poured-concrete'], 'medallion',
     ['acid-stain', 'sealed-gloss'], ['black-granite', 'terra-cotta', 'harvest-gold'],
     ['fire-feature', 'logo-inlay', 'saw-cut'],
     ['compass', 'medallion', 'showpiece'],
     'Collierville', 'Schilling Farms', 10, 2024,
     'Compass star cut into the cured slab by hand, then each point stained separately and the '
     'field taken down to a black granite. The fire pit is the centre of the star. This is the one '
     'to show somebody who thinks concrete is grey.',
     ['stained-concrete-patio-memphis-tn-compass-star-firepit']),

    ('sun-medallion-germantown', 'Hand-cut sun medallion inlay',
     'patio', ['decorative-concrete'], ['poured-concrete'], 'medallion',
     ['acid-stain', 'sealed-gloss'], ['harvest-gold', 'terra-cotta', 'walnut'],
     ['logo-inlay', 'saw-cut'], ['medallion'],
     'Germantown', '', 7, 2023,
     'Saw-cut medallion stained in three passes, lightest first. Acid stain is a reaction, not a '
     'paint — the colour comes out of the concrete, which is why no two of these are identical.',
     ['stained-concrete-sun-medallion-memphis-tn-hand-cut-inlay']),

    ('acid-floor-memphis', 'Acid-stained interior floor, Midtown',
     'interior-floor', ['decorative-concrete', 'flooring'], ['poured-concrete'], '',
     ['acid-stain', 'sealed-gloss'], ['walnut', 'chestnut'], [],
     ['interior', 'existing slab'],
     'Memphis', 'Midtown', 2, 2022,
     'Existing slab, ground flat, stained and sealed in place. Half the cost of tearing it out, and '
     'the variation in the old slab is what makes the finish look like leather.',
     ['stained-concrete-memphis-tn-acid-stain']),

    ('terracotta-deck-olive-branch', 'Terra cotta banded pool deck',
     'pool-deck', ['decorative-concrete', 'pools'], ['poured-concrete'], '',
     ['acid-stain', 'sealed-matte'], ['terra-cotta', 'bone-white'], ['border'],
     ['cool deck'], 'Olive Branch', '', 5, 2023,
     'Banded stain with a light field, so the deck stays cool enough to stand on in August. Matte '
     'sealer on a pool deck, never gloss — gloss plus water is a slip claim waiting to happen.',
     ['stained-concrete-pool-deck-memphis-tn-terracotta-banded']),

    ('seamless-deck-collierville', 'Seamless slate pool deck, grey',
     'pool-deck', ['decorative-concrete', 'pools'], ['poured-concrete'], 'seamless-slate',
     ['color-hardener', 'antique-release'], ['slate-grey', 'charcoal'], [],
     ['seamless', 'no grout lines'],
     'Collierville', '', 6, 2024,
     'Seamless texture, so there are no repeating grout lines to line up and nowhere for a pattern '
     'error to hide. The most-asked-for finish in the Mid-South right now.',
     ['seamless-slate-stamped-pool-deck-memphis-tn-grey']),

    ('waterfall-deck-lakeland', 'Pool deck around a rock waterfall',
     'pool-deck', ['pools', 'masonry'], ['poured-concrete', 'natural-stone'], 'random-stone',
     ['washed'], ['driftwood', 'slate-grey'], ['waterfall'],
     [], 'Lakeland', '', 7, 2022,
     'Deck poured to the rock rather than the rock set onto the deck, which is the only way the '
     'joint between the two does not open up in year three.',
     ['concrete-pool-deck-memphis-tn-rock-waterfall']),

    ('grass-joint-deck-germantown', 'Floating panels with grass joints',
     'pool-deck', ['pools', 'concrete', 'landscaping'], ['poured-concrete'], '',
     ['smooth-trowel'], ['platinum'], ['grass-joint'],
     ['floating panels', 'modern'],
     'Germantown', '', 5, 2024,
     'Each panel is its own pour with turf between. It looks like a design choice and it is, but it '
     'also means the deck has nowhere to build up stress and crack.',
     ['concrete-pool-deck-memphis-tn-smooth-grey-grass-joints']),

    ('banded-deck-southaven', 'Stamped border with washed panels',
     'pool-deck', ['decorative-concrete', 'pools'], ['poured-concrete'], 'ashlar-slate',
     ['washed'], ['bone-white', 'slate-grey'], ['border'],
     [], 'Southaven', '', 8, 2023,
     'Stamped band framing washed panels. Two finishes on one deck is more work than either alone, '
     'and it is what stops a big deck reading as a parking lot.',
     ['concrete-pool-deck-memphis-tn-stamped-border-washed-panels']),

    ('broom-deck-millington', 'Broom-finish pool deck',
     'pool-deck', ['concrete', 'pools'], ['poured-concrete'], '',
     ['broom'], ['slate-grey'], [],
     [], 'Millington', '', 6, 2022,
     'Plain broom finish, done properly: flat, drained away from the coping, and jointed so the '
     'cracks land where they were told to. Not every deck needs to be decorative.',
     ['concrete-pool-deck-memphis-tn-broom-finish']),

    ('freeform-deck-oakland', 'Freeform pool, washed aggregate deck',
     'pool-deck', ['concrete', 'pools'], ['poured-concrete', 'gravel'], '',
     ['washed', 'exposed-aggregate'], ['bone-white', 'sandstone'], [],
     ['freeform'], 'Oakland', '', 9, 2023,
     'Washed finish on a freeform shape, which means every edge is hand-worked. The detail shot is '
     'the same deck up close — that texture is the aggregate in the mix, not a coating on top.',
     ['washed-aggregate-pool-deck-memphis-tn-freeform-pool',
      'washed-aggregate-concrete-finish-memphis-tn-detail']),

    ('coping-deck-hernando', 'Washed deck with grey and white coping',
     'pool-deck', ['concrete', 'pools'], ['poured-concrete'], '',
     ['washed'], ['platinum', 'bone-white'], ['border'],
     ['coping'], 'Hernando', '', 4, 2024,
     'Coping poured in a lighter mix than the deck so the edge reads as a line. The second photo is '
     'a stamped coping detail on the same job.',
     ['washed-aggregate-pool-deck-memphis-tn-grey-white-coping',
      'stamped-concrete-pool-coping-memphis-tn-washed-aggregate-deck']),

    ('swimup-collierville', 'Swim-up bar and deck',
     'pool-deck', ['outdoor-living', 'pools'], ['poured-concrete'], '',
     ['smooth-trowel', 'sealed-matte'], ['sandstone'], ['swim-up-bar'],
     ['swim up bar'], 'Collierville', '', 7, 2024,
     'Bar top cast to sit just above the waterline with stools poured into the pool floor. '
     'Everything below water is a different mix design than everything above it.',
     ['concrete-swim-up-bar-memphis-tn-pool']),

    ('exposed-drive-germantown', 'Exposed aggregate driveway with a brick ribbon',
     'driveway', ['concrete', 'masonry'], ['poured-concrete', 'brick'], '',
     ['exposed-aggregate'], ['bone-white', 'brick-red'], ['border'],
     ['brick ribbon'], 'Germantown', '', 10, 2023,
     'Exposed aggregate field with a real brick ribbon, not a stamped one. Washed at the right hour '
     'of the right day — too early and the stone rolls out, too late and it never shows.',
     ['exposed-aggregate-driveway-memphis-tn-brick-ribbon-border',
      'exposed-aggregate-driveway-memphis-tn-curved-apron']),

    ('exposed-steps-bartlett', 'Exposed aggregate steps and walk',
     'steps', ['concrete'], ['poured-concrete'], '',
     ['exposed-aggregate'], ['sandstone'], ['steps-integrated'],
     ['grip'], 'Bartlett', '', 4, 2022,
     'Steps and the walk poured together so the tread height is identical the whole way up. The '
     'exposed finish is also the grippiest thing you can put on an outdoor stair.',
     ['exposed-aggregate-steps-walkway-memphis-tn']),

    ('walkway-cordova', 'Front walkway, saw-cut pattern',
     'walkway', ['concrete'], ['poured-concrete'], '',
     ['broom'], ['slate-grey'], ['saw-cut'],
     [], 'Cordova', '', 3, 2023,
     'Broom finish with a saw-cut grid. Cutting the joints early, within the first day, is what '
     'decides whether the cracks follow the lines or ignore them.',
     ['concrete-walkway-memphis-tn-paving']),

    ('drive-replace-memphis', 'Driveway replacement, East Memphis',
     'driveway', ['concrete'], ['poured-concrete'], '',
     ['broom'], ['slate-grey'], ['repair', 'drainage-detail'],
     ['tear out', 'settlement'], 'Memphis', 'East Memphis', 5, 2024,
     'Original 1970s drive had scaled through and settled at the downspout. Tear-out, regrade, '
     'drainage corrected, then repour — the settlement was a water problem before it was a '
     'concrete problem.',
     ['concrete-driveway-memphis-tn-residential']),

    ('patio-munford', 'Backyard patio, broom finish',
     'patio', ['concrete'], ['poured-concrete'], '',
     ['broom'], ['slate-grey'], [],
     [], 'Munford', '', 6, 2022,
     'Straightforward patio, squared to the house and pitched a quarter inch to the foot away from '
     'the foundation. The pitch is the part nobody notices until it is wrong.',
     ['concrete-patio-memphis-tn-backyard']),

    ('retaining-brighton', 'Stone retaining wall',
     'retaining-wall', ['masonry', 'landscaping'], ['natural-stone', 'block'], '',
     [], ['driftwood'], ['drainage-detail'],
     ['retaining wall', 'drainage'], 'Brighton', '', 9, 2023,
     'Stone-faced retaining wall on a poured footing with drainage behind it. A wall that holds '
     'dirt is a drainage job wearing a stone jacket.',
     ['masonry-memphis-tn-stone-retaining-wall']),

    ('kitchen-fireplace-collierville', 'Outdoor kitchen and fireplace',
     'outdoor-kitchen', ['outdoor-living', 'masonry'], ['stacked-stone', 'block'], '',
     [], ['sandstone', 'chestnut'], ['fire-feature'],
     ['outdoor kitchen', 'fireplace'], 'Collierville', '', 8, 2024,
     'Kitchen run, chimney and hearth built as one structure on a single footing, so nothing moves '
     'independently of anything else.',
     ['outdoor-kitchen-memphis-tn-fireplace']),

    ('pavilion-somerville', 'Pool deck under a stone pavilion',
     'pergola', ['outdoor-living', 'masonry', 'carpentry'], ['natural-stone', 'poured-concrete'], '',
     ['washed'], ['driftwood', 'sandstone'], ['pavilion'],
     ['pavilion', 'covered'], 'Somerville', '', 6, 2023,
     'Columns set before the deck went in, so the deck is poured around them and there is no '
     'patched collar at the base of each post.',
     ['pool-deck-outdoor-living-memphis-tn-stone-pavilion']),

    ('counter-stacked-germantown', 'Outdoor kitchen countertop, stacked stone base',
     'countertop', ['concrete', 'outdoor-living'], ['poured-concrete', 'stacked-stone'], '',
     ['smooth-trowel', 'sealed-matte'], ['driftwood'], [],
     ['cast in place'], 'Germantown', '', 5, 2024,
     'Cast in place on top of the stone base rather than made in a shop and set — no seam at '
     'the back, and the overhang is whatever the drawing said it was.',
     ['concrete-countertop-memphis-tn-outdoor-kitchen-stacked-stone',
      'concrete-countertop-memphis-tn-two-tier-outdoor-bar']),

    ('counter-kitchen-collierville', 'Kitchen countertops with a stone backsplash',
     'countertop', ['concrete', 'remodeling'], ['poured-concrete', 'natural-stone'], '',
     ['smooth-trowel', 'sealed-matte'], ['charcoal'], [],
     ['interior', 'food safe'], 'Collierville', '', 11, 2023,
     'Interior counters in a charcoal mix with a food-safe matte sealer. Concrete moves with the '
     'house, so the seam placement is decided by the cabinet run, not by the slab size.',
     ['concrete-countertops-memphis-tn-kitchen-stone-backsplash']),

    ('bartop-waterfall-memphis', 'Bar top with a waterfall edge, black granite',
     'countertop', ['concrete'], ['poured-concrete'], '',
     ['smooth-trowel', 'sealed-gloss'], ['black-granite'], ['waterfall-edge'],
     ['waterfall edge', 'mitre'], 'Memphis', '', 2, 2024,
     'Black granite mix with a mitred waterfall edge, so the grain runs over the end instead of '
     'stopping at it. The mitre is cut and closed while the piece is still green.',
     ['concrete-bar-top-memphis-tn-waterfall-edge']),

    ('polished-bartop-memphis', 'Polished bar top with an inlaid logo',
     'countertop', ['decorative-concrete', 'commercial'], ['poured-concrete', 'metal'], '',
     ['polished', 'sealed-gloss'], ['charcoal'], ['logo-inlay'],
     ['brass inlay', 'commercial'], 'Memphis', 'Downtown', 4, 2023,
     'Ground and polished through the grits to expose the aggregate, with the logo inlaid in brass '
     'before the final passes so the metal polishes flush with the surface.',
     ['polished-concrete-bar-top-memphis-tn-inlaid-logo']),

    ('stained-bartop-covington', 'Stained bar top, chiselled edge',
     'countertop', ['decorative-concrete'], ['poured-concrete'], '',
     ['acid-stain', 'sealed-gloss'], ['walnut'], [],
     ['chiselled edge'], 'Covington', '', 10, 2022,
     'Acid stain over a standard grey mix with the edge chiselled by hand after the cure, which is '
     'the only way to get an edge that reads as stone rather than as a form line.',
     ['stained-concrete-bar-top-memphis-tn-chiselled-edge']),

    ('commercial-memphis', 'Commercial flatwork',
     'parking-lot', ['commercial', 'concrete'], ['poured-concrete'], '',
     ['broom'], ['slate-grey'], [],
     ['night pour', 'ada'], 'Memphis', '', 3, 2024,
     'Commercial pour on a night schedule so the business never closed. Flatwork, jointing and '
     'ADA-compliant falls at the entrances.',
     ['commercial-concrete-memphis-tn-flatwork']),
]


def draft_caption(parts, town, month, year):
    """Mirror the caption the app's HeuristicVision would draft, so the sample
    book looks exactly like a book the contractor filled in himself."""
    head = ' — '.join([p for p in parts if p])
    tail = f'{town}, {MONTHS[month - 1]} {year}'
    text = f'{head}. {tail}' if head else tail
    return text[0].upper() + text[1:] + '.'


def build():
    projects = []
    photos = []
    missing = []

    for (slug, name, ptype, trades, materials, pattern, finishes, colors,
         features, tags, town, hood, month, year, notes, files) in PROJECTS:
        lat, lng, state = place(town)
        pid = f'seed-{slug}'

        # A plausible job window: most of these run one to three weeks.
        started = f'{year:04d}-{month:02d}-{RNG.randint(1, 8):02d}T13:00:00.000Z'
        completed = f'{year:04d}-{month:02d}-{RNG.randint(18, 27):02d}T18:00:00.000Z'

        photo_ids = []
        for i, f in enumerate(files):
            rel = f'img/{f}.webp'
            if not os.path.exists(os.path.join(APP, rel)):
                missing.append(rel)
                continue
            phid = f'{pid}-p{i + 1}'
            photo_ids.append(phid)
            bits = []
            if pattern:
                bits.append(pattern.replace('-', ' '))
            bits.append(ptype.replace('-', ' '))
            photos.append({
                'id': phid,
                'projectId': pid,
                'url': rel,
                'width': None,
                'height': None,
                'bytes': None,
                'hash': None,
                'layout': None,
                'avgColor': None,
                'exif': {'lat': None, 'lng': None, 'takenAt': completed, 'make': '', 'model': ''},
                'dateSource': 'seed',
                # Every photograph we have is of finished work. Saying so is
                # the whole reason the before/after screen is honestly empty.
                'stage': 'after',
                'stageSource': 'seed',
                'caption': draft_caption(['After'] + bits, town, month, year),
                'captionSource': 'auto',
                'tags': [],
                'order': i,
                'demo': True,
                'created': completed,
            })

        projects.append({
            'id': pid,
            'name': name,
            'address': '',
            'lat': lat,
            'lng': lng,
            'city': town,
            'state': state,
            'neighborhood': hood,
            'type': ptype,
            'trade': trades,
            'material': materials,
            'pattern': pattern,
            'finish': finishes,
            'color': colors,
            'feature': features,
            'tags': tags,
            'notes': notes,
            'startedAt': started,
            'completedAt': completed,
            'visibility': 'public',
            'exactAddress': False,
            'coverPhotoId': photo_ids[0] if photo_ids else None,
            'pairs': [],          # see the module docstring: nothing to pair yet
            'demo': True,
            'schema': 2,
            'created': completed,
            'updated': completed,
        })

    if missing:
        raise SystemExit('Missing photos:\n  ' + '\n  '.join(sorted(set(missing))))

    out = {'schema': 2, 'projects': projects, 'photos': photos}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)

    print(f'Wrote {len(projects)} sample projects and {len(photos)} photos')
    print(f'  towns covered:      {len({p["city"] for p in projects})}')
    print(f'  project types:      {len({p["type"] for p in projects})}')
    print(f'  trades covered:     {len({t for p in projects for t in p["trade"]})}')
    print(f'  materials covered:  {len({m for p in projects for m in p["material"]})}')
    print('  before/after pairs: 0 (every sample photo is finished work)')


if __name__ == '__main__':
    build()
