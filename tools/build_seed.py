#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build data/seed.json — the sample pins the app ships with.

HONESTY RULE (didm/CLAUDE.md, Quality bar: "Distinguish observed from inferred")

The PHOTOS are real. Every file referenced here is a Baltz & Sons project photo
already published on baltzconcrete.com, carried over from this repo's assets/img.

The LOCATIONS are not. Nobody has given us the addresses of these jobs, so each
pin is placed at an approximate point inside a town Baltz & Sons actually serves
(the towns come from src/areas.py) and every record carries demo=true. The app
renders those with a "Sample" badge and a standing banner, and owner tools offer
a one-tap "remove the sample jobs".

Do not remove the demo flag to make a demo look better. The moment Kevin adds
his first real job the sample pins are meant to go.

The FACET VALUES are read off the photograph and the filename — a file called
`stamped-concrete-driveway-memphis-tn-ashlar-wet-finish` is a stamped driveway
in an ashlar pattern with a gloss sealer, and that is what it is tagged. Where
a colour could not be read confidently, it is left off rather than guessed;
an empty facet costs a search hit, a wrong one costs trust.

Regenerate:  python3 tools/build_seed.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
OUT = os.path.join(APP, 'data', 'seed.json')
IMG = os.path.join(APP, 'img')

# Approximate town centres for the service areas in src/areas.py. These place a
# pin in the right town; they are not the coordinates of any actual job site.
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


def place(town):
    """A point a mile or two off the town centre, so pins spread like houses."""
    lat, lng, state = TOWNS[town]
    return (
        round(lat + RNG.uniform(-0.028, 0.028), 6),
        round(lng + RNG.uniform(-0.034, 0.034), 6),
        state,
    )


# id, title, service, surface, pattern, colors, finishes, features, town,
# neighborhood, year, description, photos
JOBS = [
    ('ashlar-drive-collierville', 'Ashlar slate driveway, wet-look finish',
     'stamped-concrete', 'driveway', 'ashlar-slate', ['charcoal', 'slate-grey'],
     ['color-hardener', 'antique-release', 'sealed-gloss'], ['border'],
     'Collierville', 'Bray Station', 2024,
     'Full driveway replacement in ashlar slate with a charcoal hardener and a darker antique '
     'release in the joints. Finished with a solvent sealer, which is what gives it the wet look '
     'in the photo — that is the sealer, not the colour, and it needs redoing every three years.',
     ['stamped-concrete-driveway-memphis-tn-ashlar-wet-finish',
      'stamped-concrete-driveway-memphis-tn-random-stone-border']),

    ('cobble-drive-germantown', 'Colonial cobble driveway and garage apron',
     'stamped-concrete', 'driveway', 'colonial-cobble', ['sandstone', 'walnut'],
     ['color-hardener', 'antique-release'], ['border'],
     'Germantown', 'Farmington', 2023,
     'Cobble field with a hand-cut border running the length of the drive and squared off at the '
     'apron. The tight radius at the turnaround is stamped, not cut — that is the part that takes '
     'the extra day.',
     ['stamped-concrete-driveway-memphis-tn-cobblestone-approach',
      'stamped-concrete-driveway-memphis-tn-cobblestone-garage-apron',
      'colonial-cobble-stamped-driveway-memphis-tn-detail']),

    ('eurofan-drive-eads', 'European fan driveway',
     'stamped-concrete', 'driveway', 'european-fan', ['harvest-gold', 'chestnut'],
     ['color-hardener', 'antique-release'], [],
     'Eads', '', 2023,
     'European fan is the hardest pattern to keep straight on a long run because the fans have to '
     'stay on a line the eye can follow. Gold hardener with a brown release sitting in the joints.',
     ['european-fan-stamped-concrete-driveway-memphis-tn']),

    ('dogwood-drive-arlington', 'Random stone approach under the dogwoods',
     'stamped-concrete', 'driveway', 'random-stone', ['slate-grey', 'driftwood'],
     ['color-hardener', 'antique-release'], ['border'],
     'Arlington', '', 2024,
     'Random stone field with a running-bond border. Root pressure from the trees either side is '
     'why this one is thicker than a standard drive and jointed where it is.',
     ['stamped-concrete-driveway-memphis-tn-dogwoods-hero']),

    ('stamped-patio-cordova', 'Stamped back patio, adobe and terra cotta',
     'stamped-concrete', 'patio', 'ashlar-slate', ['adobe', 'terra-cotta'],
     ['integral-color', 'antique-release'], [],
     'Cordova', '', 2022,
     'Integral colour through the slab with a release accent, so a chip shows the same colour '
     'rather than grey. Ashlar pattern, squared to the house.',
     ['stamped-concrete-memphis-tn-patio',
      'baltz-sons-concrete-memphis-tn-finished-patio']),

    ('seatwall-patio-bartlett', 'Stamped patio with a poured seat wall',
     'stamped-concrete', 'patio', 'random-stone', ['chestnut', 'sandstone'],
     ['color-hardener', 'antique-release'], ['seat-wall'],
     'Bartlett', '', 2023,
     'The seat wall is poured and capped as part of the same job, so the cap colour matches the '
     'field instead of being chased later with a stain.',
     ['stamped-concrete-seat-wall-memphis-tn-stained-patio']),

    ('compass-patio-collierville', 'Compass star fire pit patio, hand-cut and stained',
     'stained-concrete', 'patio', 'medallion', ['black-granite', 'terra-cotta', 'harvest-gold'],
     ['acid-stain', 'sealed-gloss'], ['fire-feature', 'logo-inlay', 'saw-cut'],
     'Collierville', 'Schilling Farms', 2024,
     'Compass star cut into the cured slab by hand, then each point stained separately and the '
     'field taken down to a black granite. The fire pit is the centre of the star. This is the one '
     'to show somebody who thinks concrete is grey.',
     ['stained-concrete-patio-memphis-tn-compass-star-firepit']),

    ('sun-medallion-germantown', 'Hand-cut sun medallion inlay',
     'stained-concrete', 'patio', 'medallion', ['harvest-gold', 'terra-cotta', 'walnut'],
     ['acid-stain', 'sealed-gloss'], ['logo-inlay', 'saw-cut'],
     'Germantown', '', 2023,
     'Saw-cut medallion stained in three passes, lightest first. Acid stain is a reaction, not a '
     'paint — the colour comes out of the concrete, which is why no two of these are identical.',
     ['stained-concrete-sun-medallion-memphis-tn-hand-cut-inlay']),

    ('acid-floor-memphis', 'Acid-stained interior floor, Midtown',
     'stained-concrete', 'interior-floor', '', ['walnut', 'chestnut'],
     ['acid-stain', 'sealed-gloss'], [],
     'Memphis', 'Midtown', 2022,
     'Existing slab, ground flat, stained and sealed in place. Half the cost of tearing it out and '
     'the variation in the old slab is what makes the finish look like leather.',
     ['stained-concrete-memphis-tn-acid-stain']),

    ('terracotta-deck-olive-branch', 'Terra cotta banded pool deck',
     'stained-concrete', 'pool-deck', '', ['terra-cotta', 'bone-white'],
     ['acid-stain', 'sealed-matte'], ['border'],
     'Olive Branch', '', 2023,
     'Banded stain with a light field so the deck stays cool enough to stand on in August. Matte '
     'sealer on a pool deck, never gloss — gloss plus water is a slip claim waiting to happen.',
     ['stained-concrete-pool-deck-memphis-tn-terracotta-banded']),

    ('seamless-deck-collierville', 'Seamless slate pool deck, grey',
     'pool-decks', 'pool-deck', 'seamless-slate', ['slate-grey', 'charcoal'],
     ['color-hardener', 'antique-release'], [],
     'Collierville', '', 2024,
     'Seamless texture, so there are no repeating grout lines to line up and nowhere for a pattern '
     'error to hide. The most-asked-for finish in the Mid-South right now.',
     ['seamless-slate-stamped-pool-deck-memphis-tn-grey']),

    ('waterfall-deck-lakeland', 'Pool deck around a rock waterfall',
     'pool-decks', 'pool-deck', 'random-stone', ['driftwood', 'slate-grey'],
     ['washed'], ['waterfall'],
     'Lakeland', '', 2022,
     'Deck poured to the rock rather than the rock set onto the deck, which is the only way the '
     'joint between the two does not open up in year three.',
     ['concrete-pool-deck-memphis-tn-rock-waterfall']),

    ('grass-joint-deck-germantown', 'Floating panels with grass joints',
     'pool-decks', 'pool-deck', '', ['platinum'],
     ['smooth-trowel'], ['grass-joint'],
     'Germantown', '', 2024,
     'Each panel is its own pour with turf between. It looks like a design choice and it is, but it '
     'also means the deck has nowhere to build up stress and crack.',
     ['concrete-pool-deck-memphis-tn-smooth-grey-grass-joints']),

    ('banded-deck-southaven', 'Stamped border with washed panels',
     'pool-decks', 'pool-deck', 'ashlar-slate', ['bone-white', 'slate-grey'],
     ['washed'], ['border'],
     'Southaven', '', 2023,
     'Stamped band framing washed panels. Two finishes on one deck is more work than either alone, '
     'and it is what stops a big deck reading as a parking lot.',
     ['concrete-pool-deck-memphis-tn-stamped-border-washed-panels']),

    ('broom-deck-millington', 'Broom-finish pool deck',
     'pool-decks', 'pool-deck', '', ['slate-grey'],
     ['broom'], [],
     'Millington', '', 2022,
     'Plain broom finish, done properly: flat, drained away from the coping, and jointed so the '
     'cracks land where they were told to. Not every deck needs to be decorative.',
     ['concrete-pool-deck-memphis-tn-broom-finish']),

    ('freeform-deck-oakland', 'Freeform pool, washed aggregate deck',
     'pool-decks', 'pool-deck', '', ['bone-white', 'sandstone'],
     ['washed', 'exposed-aggregate'], [],
     'Oakland', '', 2023,
     'Washed finish on a freeform shape, which means every edge is hand-worked. The detail shot is '
     'the same deck up close — that texture is the aggregate in the mix, not a coating on top.',
     ['washed-aggregate-pool-deck-memphis-tn-freeform-pool',
      'washed-aggregate-concrete-finish-memphis-tn-detail']),

    ('coping-deck-hernando', 'Washed deck with grey and white coping',
     'pool-decks', 'pool-deck', '', ['platinum', 'bone-white'],
     ['washed'], ['border'],
     'Hernando', '', 2024,
     'Coping poured in a lighter mix than the deck so the edge reads as a line. The second photo is '
     'a stamped coping detail on the same job.',
     ['washed-aggregate-pool-deck-memphis-tn-grey-white-coping',
      'stamped-concrete-pool-coping-memphis-tn-washed-aggregate-deck']),

    ('swimup-collierville', 'Swim-up bar and deck',
     'outdoor-living', 'pool-deck', '', ['sandstone'],
     ['smooth-trowel', 'sealed-matte'], ['swim-up-bar'],
     'Collierville', '', 2024,
     'Bar top cast to sit just above the waterline with stools poured into the pool floor. Everything '
     'below water is a different mix design than everything above it.',
     ['concrete-swim-up-bar-memphis-tn-pool']),

    ('exposed-drive-germantown', 'Exposed aggregate driveway with a brick ribbon',
     'concrete-driveways', 'driveway', '', ['bone-white', 'brick-red'],
     ['exposed-aggregate'], ['border'],
     'Germantown', '', 2023,
     'Exposed aggregate field with a real brick ribbon, not a stamped one. Washed at the right hour '
     'of the right day — too early and the stone rolls out, too late and it never shows.',
     ['exposed-aggregate-driveway-memphis-tn-brick-ribbon-border',
      'exposed-aggregate-driveway-memphis-tn-curved-apron']),

    ('exposed-steps-bartlett', 'Exposed aggregate steps and walk',
     'concrete-paving', 'steps', '', ['sandstone'],
     ['exposed-aggregate'], ['steps-integrated'],
     'Bartlett', '', 2022,
     'Steps and the walk poured together so the tread height is identical the whole way up. The '
     'exposed finish is also the grippiest thing you can put on an outdoor stair.',
     ['exposed-aggregate-steps-walkway-memphis-tn']),

    ('walkway-cordova', 'Front walkway, saw-cut pattern',
     'concrete-paving', 'walkway', '', ['slate-grey'],
     ['broom'], ['saw-cut'],
     'Cordova', '', 2023,
     'Broom finish with a saw-cut grid. Cutting the joints early, within the first day, is what '
     'decides whether the cracks follow the lines or ignore them.',
     ['concrete-walkway-memphis-tn-paving']),

    ('drive-replace-memphis', 'Driveway replacement, East Memphis',
     'concrete-driveways', 'driveway', '', ['slate-grey'],
     ['broom'], ['repair'],
     'Memphis', 'East Memphis', 2024,
     'Original 1970s drive had scaled through and settled at the downspout. Tear-out, regrade, '
     'drainage corrected, then repour — the settlement was a water problem before it was a '
     'concrete problem.',
     ['concrete-driveway-memphis-tn-residential']),

    ('patio-munford', 'Backyard patio, broom finish',
     'concrete-patios', 'patio', '', ['slate-grey'],
     ['broom'], [],
     'Munford', '', 2022,
     'Straightforward patio, squared to the house and pitched a quarter inch to the foot away from '
     'the foundation. The pitch is the part nobody notices until it is wrong.',
     ['concrete-patio-memphis-tn-backyard']),

    ('retaining-brighton', 'Stone retaining wall',
     'masonry', 'wall', '', ['driftwood'],
     [], [],
     'Brighton', '', 2023,
     'Stone-faced retaining wall on a poured footing with drainage behind it. A wall that holds dirt '
     'is a drainage job wearing a stone jacket.',
     ['masonry-memphis-tn-stone-retaining-wall']),

    ('kitchen-fireplace-collierville', 'Outdoor kitchen and fireplace',
     'outdoor-living', 'outdoor-kitchen', '', ['sandstone', 'chestnut'],
     [], ['fire-feature'],
     'Collierville', '', 2024,
     'Kitchen run, chimney and hearth built as one structure on a single footing so nothing moves '
     'independently of anything else.',
     ['outdoor-kitchen-memphis-tn-fireplace']),

    ('pavilion-somerville', 'Pool deck under a stone pavilion',
     'outdoor-living', 'pool-deck', '', ['driftwood', 'sandstone'],
     ['washed'], ['pavilion'],
     'Somerville', '', 2023,
     'Columns set before the deck went in, so the deck is poured around them and there is no '
     'patched collar at the base of each post.',
     ['pool-deck-outdoor-living-memphis-tn-stone-pavilion']),

    ('counter-stacked-germantown', 'Outdoor kitchen countertop, stacked stone base',
     'concrete-countertops', 'countertop', '', ['driftwood'],
     ['smooth-trowel', 'sealed-matte'], [],
     'Germantown', '', 2024,
     'Cast in place on top of the stone base rather than made in a shop and set — no seam at the '
     'back, and the overhang is whatever the drawing said it was.',
     ['concrete-countertop-memphis-tn-outdoor-kitchen-stacked-stone',
      'concrete-countertop-memphis-tn-two-tier-outdoor-bar']),

    ('counter-kitchen-collierville', 'Kitchen countertops with a stone backsplash',
     'concrete-countertops', 'countertop', '', ['charcoal'],
     ['smooth-trowel', 'sealed-matte'], [],
     'Collierville', '', 2023,
     'Interior counters in a charcoal mix with a food-safe matte sealer. Concrete moves with the '
     'house, so the seam placement is decided by the cabinet run, not by the slab size.',
     ['concrete-countertops-memphis-tn-kitchen-stone-backsplash']),

    ('bartop-waterfall-memphis', 'Bar top with a waterfall edge, black granite',
     'concrete-countertops', 'countertop', '', ['black-granite'],
     ['smooth-trowel', 'sealed-gloss'], ['waterfall-edge'],
     'Memphis', '', 2024,
     'Black granite mix with a mitred waterfall edge, so the grain runs over the end instead of '
     'stopping at it. The mitre is cut and closed while the piece is still green.',
     ['concrete-bar-top-memphis-tn-waterfall-edge']),

    ('polished-bartop-memphis', 'Polished bar top with an inlaid logo',
     'polished-concrete-floors', 'countertop', '', ['charcoal'],
     ['polished', 'sealed-gloss'], ['logo-inlay'],
     'Memphis', 'Downtown', 2023,
     'Ground and polished through the grits to expose the aggregate, with the logo inlaid in brass '
     'before the final passes so the metal polishes flush with the surface.',
     ['polished-concrete-bar-top-memphis-tn-inlaid-logo']),

    ('stained-bartop-covington', 'Stained bar top, chiselled edge',
     'stained-concrete', 'countertop', '', ['walnut'],
     ['acid-stain', 'sealed-gloss'], [],
     'Covington', '', 2022,
     'Acid stain over a standard grey mix with the edge chiselled by hand after the cure, which is '
     'the only way to get an edge that reads as stone rather than as a form line.',
     ['stained-concrete-bar-top-memphis-tn-chiselled-edge']),

    ('commercial-memphis', 'Commercial flatwork',
     'commercial-concrete', 'parking-lot', '', ['slate-grey'],
     ['broom'], [],
     'Memphis', '', 2024,
     'Commercial pour on a night schedule so the business never closed. Flatwork, jointing and '
     'ADA-compliant falls at the entrances.',
     ['commercial-concrete-memphis-tn-flatwork']),
]


def build():
    out = []
    missing = []
    for (jid, title, service, surface, pattern, colors, finishes, features,
         town, hood, year, desc, photos) in JOBS:
        lat, lng, state = place(town)
        srcs = []
        for p in photos:
            rel = f'img/{p}.webp'
            if not os.path.exists(os.path.join(APP, rel)):
                missing.append(rel)
                continue
            srcs.append({'src': rel})
        out.append({
            'id': f'seed-{jid}',
            'title': title,
            'service': service,
            'surface': surface,
            'pattern': pattern,
            'color': colors,
            'finish': finishes,
            'feature': features,
            'description': desc,
            'address': '',
            'city': town,
            'state': state,
            'neighborhood': hood,
            'year': year,
            'lat': lat,
            'lng': lng,
            'privacy': True,
            'photos': srcs,
            'demo': True,
        })

    if missing:
        raise SystemExit('Missing photos:\n  ' + '\n  '.join(sorted(set(missing))))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    print(f'Wrote {len(out)} sample jobs to {os.path.relpath(OUT, APP)}')
    print(f'  photos referenced: {sum(len(j["photos"]) for j in out)}')
    print(f'  towns covered:     {len({j["city"] for j in out})}')


if __name__ == '__main__':
    build()
