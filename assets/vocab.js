/* ==========================================================================
   Urban Concrete Showroom — search vocabulary
   Baltz & Sons Concrete · built by Dive In Digital Marketing

   WHY THIS FILE EXISTS
   A homeowner standing in a driveway does not type "slug:stamped-concrete".
   They type "stamped and colored driveway" or "patio with black granite
   colored". Both of those are several facets at once — a service, a surface,
   a treatment, a colour — written the way a person talks.

   So the search is not a substring match over descriptions. It is a parser:
   the query is read against the dictionaries below, longest phrase first, and
   what survives as an unmatched word is treated as free text. That is what
   lets "black granite" resolve to one colour rather than two stray words, and
   what lets "drive" find a driveway.

   ADDING VOCABULARY
   Every entry is {id, label, terms}. `id` is what a job record stores, `label`
   is what a human sees, `terms` are every way somebody might type it —
   including the misspellings we actually hear on the phone. Add freely; the
   parser prefers the longest matching phrase, so a new multi-word term is
   safe. Keep `terms` lowercase and singular where a plural is generated below.
   ========================================================================== */

/* --- services -------------------------------------------------------------
   The twelve service lines on baltzconcrete.com. `id` matches the website
   slug so a pin can deep-link to the matching service page.                 */
const SERVICES = [
  { id: 'stamped-concrete', label: 'Stamped Concrete', terms: ['stamped concrete', 'stamped', 'stamp', 'stampt', 'stamped cement', 'patterned concrete', 'imprinted concrete', 'textured concrete'] },
  { id: 'stained-concrete', label: 'Stained & Colored Concrete', terms: ['stained concrete', 'stained', 'stain', 'staining', 'colored concrete', 'coloured concrete', 'colored', 'coloring', 'colour', 'color', 'dyed concrete', 'acid stain', 'acid stained', 'acid washed'] },
  { id: 'concrete-patios', label: 'Concrete Patios', terms: ['concrete patio', 'patio', 'patios', 'pateo', 'back patio', 'backyard patio', 'porch slab'] },
  { id: 'concrete-driveways', label: 'Concrete Driveways', terms: ['concrete driveway', 'driveway', 'driveways', 'drive way', 'drive', 'car park pad', 'parking pad', 'garage apron', 'apron'] },
  { id: 'pool-decks', label: 'Pool Decks', terms: ['pool deck', 'pool decks', 'pool decking', 'pool surround', 'around the pool', 'pool patio', 'pool coping', 'coping', 'poolside'] },
  { id: 'outdoor-living', label: 'Outdoor Living', terms: ['outdoor living', 'outdoor kitchen', 'outdoor room', 'outdoor space', 'living space', 'backyard', 'back yard', 'pavilion', 'pergola slab', 'firepit', 'fire pit', 'fireplace'] },
  { id: 'concrete-paving', label: 'Paving & Walkways', terms: ['walkway', 'walk way', 'walkways', 'walk', 'sidewalk', 'side walk', 'path', 'pathway', 'paving', 'paved', 'steps', 'stairs', 'stoop', 'entry', 'entryway', 'front walk'] },
  { id: 'masonry', label: 'Masonry', terms: ['masonry', 'mason', 'masonary', 'brick', 'brickwork', 'block', 'stone work', 'stonework', 'retaining wall', 'seat wall', 'sitting wall', 'garden wall', 'column', 'columns', 'mailbox', 'veneer', 'stacked stone'] },
  { id: 'epoxy-flake-floors', label: 'Epoxy & Flake Floors', terms: ['epoxy', 'epoxy floor', 'flake floor', 'flake', 'garage floor', 'garage coating', 'floor coating', 'polyaspartic', 'chip floor'] },
  { id: 'polished-concrete-floors', label: 'Polished & Interior Floors', terms: ['polished concrete', 'polished', 'polish', 'interior floor', 'inside floor', 'basement floor', 'shop floor', 'ground and sealed', 'burnished'] },
  { id: 'commercial-concrete', label: 'Commercial Concrete', terms: ['commercial concrete', 'commercial', 'business', 'parking lot', 'sidewalk commercial', 'ada ramp', 'dumpster pad', 'flatwork', 'warehouse'] },
  { id: 'concrete-countertops', label: 'Concrete Countertops', terms: ['countertop', 'counter top', 'counters', 'countertops', 'bar top', 'bartop', 'kitchen counter', 'island', 'vanity', 'cast in place counter'] }
];

/* --- surfaces -------------------------------------------------------------
   What the concrete IS, independent of how it was finished. A driveway can be
   stamped, stained, exposed or plain — the surface stays the same, and it is
   usually the noun a homeowner leads with.                                  */
const SURFACES = [
  { id: 'driveway', label: 'Driveway', terms: ['driveway', 'driveways', 'drive way', 'drive', 'apron', 'garage apron', 'parking pad', 'turnaround'] },
  { id: 'patio', label: 'Patio', terms: ['patio', 'patios', 'pateo', 'terrace', 'lanai', 'back patio', 'courtyard'] },
  { id: 'pool-deck', label: 'Pool deck', terms: ['pool deck', 'pool decking', 'pool surround', 'pool patio', 'poolside', 'coping', 'pool coping', 'swim up bar', 'swim-up bar'] },
  { id: 'walkway', label: 'Walkway', terms: ['walkway', 'walk', 'walkways', 'sidewalk', 'path', 'pathway', 'front walk', 'garden path'] },
  { id: 'steps', label: 'Steps & landing', terms: ['steps', 'step', 'stairs', 'stairway', 'landing', 'stoop', 'front steps', 'entry steps'] },
  { id: 'porch', label: 'Porch & entry', terms: ['porch', 'front porch', 'entry', 'entryway', 'entrance', 'foyer', 'front entry'] },
  { id: 'garage-floor', label: 'Garage floor', terms: ['garage floor', 'garage', 'garage slab', 'shop floor'] },
  { id: 'interior-floor', label: 'Interior floor', terms: ['interior floor', 'inside floor', 'basement floor', 'basement', 'living room floor', 'kitchen floor', 'sunroom'] },
  { id: 'countertop', label: 'Countertop & bar', terms: ['countertop', 'counter', 'counters', 'bar top', 'bar', 'island', 'vanity', 'kitchen counter', 'outdoor bar'] },
  { id: 'outdoor-kitchen', label: 'Outdoor kitchen', terms: ['outdoor kitchen', 'grill station', 'summer kitchen', 'bbq island', 'cook station'] },
  { id: 'wall', label: 'Wall', terms: ['wall', 'walls', 'retaining wall', 'seat wall', 'sitting wall', 'garden wall', 'knee wall'] },
  { id: 'firepit', label: 'Fire pit & fireplace', terms: ['fire pit', 'firepit', 'fireplace', 'fire feature', 'chiminea pad'] },
  { id: 'parking-lot', label: 'Parking lot', terms: ['parking lot', 'lot', 'parking area', 'dumpster pad', 'loading dock'] },
  { id: 'slab', label: 'Slab & foundation', terms: ['slab', 'foundation', 'footing', 'pad', 'shed pad', 'building pad'] }
];

/* --- stamp patterns -------------------------------------------------------
   The mat names. People rarely know them, which is why the free-text half of
   the parser matters — but the ones who do know them expect an exact hit.   */
const PATTERNS = [
  { id: 'ashlar-slate', label: 'Ashlar slate', terms: ['ashlar slate', 'ashlar', 'ashler', 'ashlar cut', 'slate ashlar'] },
  { id: 'seamless-slate', label: 'Seamless slate', terms: ['seamless slate', 'seamless', 'seamless texture', 'skin', 'texture skin', 'no grout line', 'no grout lines'] },
  { id: 'london-cobble', label: 'London cobble', terms: ['london cobble', 'london', 'london cobblestone'] },
  { id: 'colonial-cobble', label: 'Colonial cobble', terms: ['colonial cobble', 'colonial', 'cobble', 'cobblestone', 'cobble stone', 'cobbles'] },
  { id: 'random-stone', label: 'Random stone', terms: ['random stone', 'random', 'irregular stone', 'flagstone pattern', 'flag stone'] },
  { id: 'european-fan', label: 'European fan', terms: ['european fan', 'euro fan', 'fan pattern', 'fan', 'fantail'] },
  { id: 'wood-plank', label: 'Wood plank', terms: ['wood plank', 'wood grain', 'woodgrain', 'plank', 'boardwalk', 'barn board', 'timber'] },
  { id: 'herringbone', label: 'Herringbone', terms: ['herringbone', 'herring bone', 'brick herringbone'] },
  { id: 'running-bond', label: 'Running bond brick', terms: ['running bond', 'brick pattern', 'used brick', 'brick stamp'] },
  { id: 'roman-slate', label: 'Roman slate', terms: ['roman slate', 'roman', 'grand ashlar'] },
  { id: 'travertine', label: 'Travertine', terms: ['travertine', 'traventine', 'travertin'] },
  { id: 'medallion', label: 'Medallion / inlay', terms: ['medallion', 'inlay', 'inlaid', 'compass rose', 'compass', 'sun medallion', 'star', 'logo inlay', 'hand cut', 'hand-cut'] }
];

/* --- finishes -------------------------------------------------------------
   How the top of the slab was treated. This is the vocabulary that separates
   a $9/ft broom drive from a $26/ft washed-and-banded one, so it earns a
   facet of its own rather than living in the description.                   */
const FINISHES = [
  { id: 'broom', label: 'Broom finish', terms: ['broom', 'broom finish', 'broomed', 'brushed', 'light broom', 'standard finish', 'plain'] },
  { id: 'smooth-trowel', label: 'Smooth trowel', terms: ['smooth', 'smooth trowel', 'troweled', 'trowelled', 'hard trowel', 'steel trowel', 'slick'] },
  { id: 'exposed-aggregate', label: 'Exposed aggregate', terms: ['exposed aggregate', 'exposed', 'aggregate', 'pea gravel', 'pea rock', 'exposed pebble'] },
  { id: 'washed', label: 'Washed / microwash', terms: ['washed', 'wash', 'microwash', 'micro wash', 'sandwash', 'sand wash', 'washed finish', 'washed aggregate', 'sand washed'] },
  { id: 'salt-finish', label: 'Salt finish', terms: ['salt finish', 'salt', 'rock salt', 'salted'] },
  { id: 'acid-stain', label: 'Acid stain', terms: ['acid stain', 'acid stained', 'acid', 'chemical stain', 'reactive stain', 'antique stain'] },
  { id: 'water-stain', label: 'Water-based stain', terms: ['water based stain', 'water stain', 'dye', 'dyed', 'tinted'] },
  { id: 'integral-color', label: 'Integral color', terms: ['integral color', 'integral colour', 'integral', 'mixed in color', 'through color', 'colored mix'] },
  { id: 'color-hardener', label: 'Color hardener', terms: ['color hardener', 'colour hardener', 'hardener', 'broadcast color', 'cast on color', 'shake on'] },
  { id: 'antique-release', label: 'Antique release', terms: ['antique release', 'release', 'antiquing', 'accent color', 'secondary color', 'two tone', 'two-tone'] },
  { id: 'polished', label: 'Polished', terms: ['polished', 'polish', 'grind and polish', 'burnished', 'honed', 'high gloss polish'] },
  { id: 'epoxy-flake', label: 'Epoxy flake', terms: ['epoxy flake', 'flake', 'chip', 'flake system', 'vinyl flake', 'epoxy chip'] },
  { id: 'overlay', label: 'Overlay / resurfacing', terms: ['overlay', 'resurface', 'resurfacing', 'microtopping', 'micro topping', 'skim coat', 'spray deck', 'knockdown'] },
  { id: 'sealed-gloss', label: 'Gloss sealer', terms: ['gloss', 'glossy', 'wet look', 'wet-look', 'high gloss', 'shiny'] },
  { id: 'sealed-matte', label: 'Matte sealer', terms: ['matte', 'matt', 'satin', 'natural look', 'low sheen'] }
];

/* --- colours --------------------------------------------------------------
   Real decorative-concrete colour names as they appear on the colour cards
   homeowners are handed (Brickform, Solomon, Increte and the release palette),
   plus the plain-English name people reach for instead. `swatch` drives the
   colour dot in the UI; it is an approximation of a cured, sealed sample, not
   a colour-matched value — the chip in the app says so.                     */
const COLORS = [
  { id: 'black-granite', label: 'Black Granite', swatch: '#2E2C2B', terms: ['black granite', 'granite black', 'black', 'charcoal black', 'onyx', 'obsidian'] },
  { id: 'charcoal', label: 'Charcoal', swatch: '#4A4744', terms: ['charcoal', 'dark grey', 'dark gray', 'graphite', 'smoke'] },
  { id: 'slate-grey', label: 'Slate Grey', swatch: '#6E6B67', terms: ['slate grey', 'slate gray', 'slate', 'grey', 'gray', 'natural grey', 'natural gray', 'pewter', 'silver'] },
  { id: 'platinum', label: 'Platinum', swatch: '#9A958E', terms: ['platinum', 'light grey', 'light gray', 'silver fox', 'dove', 'ash'] },
  { id: 'bone-white', label: 'Bone White', swatch: '#D9D2C6', terms: ['bone white', 'white', 'off white', 'cream', 'ivory', 'alabaster', 'limestone'] },
  { id: 'sandstone', label: 'Sandstone', swatch: '#C8AC82', terms: ['sandstone', 'sand', 'sandy', 'beige', 'tan', 'buff', 'desert tan'] },
  { id: 'harvest-gold', label: 'Harvest Gold', swatch: '#C9963F', terms: ['harvest gold', 'gold', 'golden', 'wheat', 'honey', 'amber', 'straw'] },
  { id: 'adobe', label: 'Adobe', swatch: '#B5794E', terms: ['adobe', 'clay', 'sunset', 'tuscan', 'caramel'] },
  { id: 'terra-cotta', label: 'Terra Cotta', swatch: '#A85A3C', terms: ['terra cotta', 'terracotta', 'terra-cotta', 'rust', 'orange', 'santa fe'] },
  { id: 'brick-red', label: 'Brick Red', swatch: '#8E4436', terms: ['brick red', 'red', 'barn red', 'salmon', 'autumn red'] },
  { id: 'chestnut', label: 'Chestnut', swatch: '#7A5237', terms: ['chestnut', 'nutmeg', 'cinnamon', 'russet', 'fawn'] },
  { id: 'walnut', label: 'Walnut', swatch: '#5E4530', terms: ['walnut', 'dark walnut', 'brown', 'coffee', 'espresso', 'padre brown', 'mahogany'] },
  { id: 'driftwood', label: 'Driftwood', swatch: '#8A7F70', terms: ['driftwood', 'weathered', 'grey brown', 'gray brown', 'taupe', 'greige', 'mushroom'] },
  { id: 'fern-green', label: 'Fern Green', swatch: '#5F6B4B', terms: ['fern green', 'green', 'sage', 'moss', 'olive', 'forest'] },
  { id: 'cordovan', label: 'Cordovan', swatch: '#6B3B3A', terms: ['cordovan', 'burgundy', 'wine', 'maroon', 'oxblood', 'plum'] }
];

/* --- features -------------------------------------------------------------
   The details a homeowner points at when they say "I want THAT". These are
   what turn a pin from "a patio" into "the one with the compass in it".     */
const FEATURES = [
  { id: 'border', label: 'Contrasting border', terms: ['border', 'banded', 'band', 'ribbon', 'brick ribbon', 'accent border', 'framed'] },
  { id: 'saw-cut', label: 'Saw-cut pattern', terms: ['saw cut', 'sawcut', 'scored', 'scoring', 'grid', 'diamond pattern', 'joint pattern'] },
  { id: 'grass-joint', label: 'Grass joints', terms: ['grass joint', 'grass joints', 'turf joint', 'planted joint', 'floating pad', 'floating panels'] },
  { id: 'seat-wall', label: 'Seat wall', terms: ['seat wall', 'sitting wall', 'bench wall', 'low wall'] },
  { id: 'waterfall', label: 'Water feature', terms: ['waterfall', 'water feature', 'rock waterfall', 'grotto', 'spillway', 'fountain'] },
  { id: 'swim-up-bar', label: 'Swim-up bar', terms: ['swim up bar', 'swim-up bar', 'pool bar', 'in pool bar', 'wet bar'] },
  { id: 'pavilion', label: 'Pavilion / cover', terms: ['pavilion', 'covered', 'cover', 'roof', 'pergola', 'gazebo', 'shade structure'] },
  { id: 'fire-feature', label: 'Fire feature', terms: ['fire pit', 'firepit', 'fireplace', 'fire feature', 'chimney'] },
  { id: 'waterfall-edge', label: 'Waterfall edge', terms: ['waterfall edge', 'mitred edge', 'mitered edge', 'drop edge', 'apron edge'] },
  { id: 'logo-inlay', label: 'Custom inlay', terms: ['logo', 'logo inlay', 'custom inlay', 'engraved', 'engraving', 'monogram', 'initials', 'crest'] },
  { id: 'steps-integrated', label: 'Integrated steps', terms: ['steps', 'integrated steps', 'bullnose', 'bull nose', 'tread'] },
  { id: 'repair', label: 'Repair / replacement', terms: ['repair', 'replaced', 'replacement', 'tear out', 'demo', 'crack repair', 'rescue', 'redo', 'fix'] }
];

/* --- the dimension table --------------------------------------------------
   `weight` is how much a hit on this dimension is worth when ranking. A
   service or surface hit is the strongest signal of intent — those are the
   nouns people lead with. Colour is close behind, because a homeowner who
   names a colour has already decided. Features are the tiebreakers.         */
const DIMENSIONS = [
  { key: 'service', label: 'Service',  list: SERVICES, weight: 12, multi: false },
  { key: 'surface', label: 'Surface',  list: SURFACES, weight: 11, multi: false },
  { key: 'color',   label: 'Color',    list: COLORS,   weight: 10, multi: true  },
  { key: 'pattern', label: 'Pattern',  list: PATTERNS, weight: 8,  multi: false },
  { key: 'finish',  label: 'Finish',   list: FINISHES, weight: 8,  multi: true  },
  { key: 'feature', label: 'Features', list: FEATURES, weight: 5,  multi: true  }
];

/* --- noise ----------------------------------------------------------------
   Dropped before free-text scoring so "patio with black granite colored"
   does not spend a point on "with".                                         */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'with', 'in', 'on', 'of', 'for', 'to', 'at', 'by',
  'or', 'my', 'me', 'i', 'we', 'you', 'is', 'are', 'was', 'some', 'any',
  'that', 'this', 'it', 'its', 'like', 'want', 'need', 'looking', 'look',
  'show', 'find', 'see', 'got', 'have', 'has', 'do', 'does', 'near', 'nearby',
  'around', 'close', 'closest', 'nearest', 'job', 'jobs', 'work', 'concrete',
  'cement', 'please', 'something', 'one', 'ones', 'new', 'good', 'nice'
]);

/* Words that mean "sort me by distance" rather than "filter me". Stripped from
   the query but flip the near-me switch on. */
const PROXIMITY_WORDS = ['near me', 'nearest', 'closest', 'close to me', 'nearby', 'near by', 'around me', 'by me'];

/* --- lookup index ---------------------------------------------------------
   Built once. Maps every term (and a naive plural) to {dim, id}. Phrases are
   kept whole; the parser walks the query longest-phrase-first so "black
   granite" is consumed before "black" ever gets a chance.                   */
const TERM_INDEX = (() => {
  const idx = new Map();
  let maxWords = 1;
  const add = (term, dim, id) => {
    const t = term.trim();
    if (!t) return;
    if (!idx.has(t)) idx.set(t, []);
    const bucket = idx.get(t);
    if (!bucket.some((e) => e.dim === dim && e.id === id)) bucket.push({ dim, id });
    maxWords = Math.max(maxWords, t.split(' ').length);
  };
  DIMENSIONS.forEach(({ key, list }) => {
    list.forEach((item) => {
      add(item.label.toLowerCase(), key, item.id);
      item.terms.forEach((t) => {
        add(t, key, item.id);
        // Naive plural so "patios"/"driveways" hit without listing both.
        if (!t.endsWith('s') && !t.includes(' ')) add(t + 's', key, item.id);
      });
    });
  });
  return { idx, maxWords };
})();

/* Label lookup for rendering chips back to the user. */
const LABELS = (() => {
  const m = {};
  DIMENSIONS.forEach(({ key, list }) => {
    m[key] = {};
    list.forEach((i) => { m[key][i.id] = i; });
  });
  return m;
})();

function labelFor(dim, id) {
  const hit = LABELS[dim] && LABELS[dim][id];
  return hit ? hit.label : id;
}

function swatchFor(colorId) {
  const hit = LABELS.color && LABELS.color[colorId];
  return hit ? hit.swatch : '#6E6B67';
}
