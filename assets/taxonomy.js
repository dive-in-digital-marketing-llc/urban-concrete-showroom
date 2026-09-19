/* ==========================================================================
   Urban Showroom — taxonomy
   Built by Dive In Digital Marketing

   WHY THIS FILE EXISTS

   A homeowner standing in a driveway does not type `type:driveway`. They say
   "stamped and colored driveway", or "patio with black granite colored", or
   "outdoor kitchen with a fireplace" — several facets at once, in the order a
   person speaks them. So search is a parser, not a substring match: the query
   is read against the dictionaries below, longest phrase first, and whatever
   survives unmatched is treated as free text. That is what makes "black
   granite" resolve to one colour rather than two stray words.

   WHAT CHANGED IN v2

   Kevin's brief widens the product past concrete: "general contractors,
   specialty contractors, subcontractors, handymen, design-build". It names
   the tags it expects to see — outdoor kitchen, patio, retaining wall,
   poolscape, stamped concrete, masonry, pergola, fireplace, flooring,
   cabinetry, paint, plumbing, landscaping. So the old two-axis model
   (service + surface) became six:

     trade     who does it        concrete, masonry, landscaping, pools…
     type      what it is         driveway, patio, outdoor kitchen, floor…
     material  what it is made of concrete, brick, stone, wood, tile…
     pattern   how it is laid     ashlar slate, herringbone, running bond…
     finish    how it is treated  broom, polished, acid stain, epoxy flake…
     color     what colour it is  Black Granite, Sandstone, Charcoal…
     feature   the detail         fire feature, seat wall, border, inlay…

   Adding vocabulary: every entry is {id, label, terms}. `id` is what a record
   stores, `label` is what a human sees, `terms` are every way somebody might
   type it — including the misspellings we actually hear on the phone. The
   parser prefers the longest matching phrase, so a new multi-word term is
   always safe to add. Keep `terms` lowercase.
   ========================================================================== */
'use strict';

/* --- trades ---------------------------------------------------------------
   Who did the work. A project can sit on several: an outdoor living build is
   concrete AND masonry AND landscaping.                                     */
const TRADES = [
  { id: 'concrete', label: 'Concrete', terms: ['concrete', 'cement', 'flatwork', 'concrete work', 'slab work'] },
  { id: 'decorative-concrete', label: 'Decorative Concrete', terms: ['decorative concrete', 'stamped concrete', 'stained concrete', 'colored concrete', 'coloured concrete', 'architectural concrete', 'stamped', 'stamp', 'stamping', 'imprinted', 'imprint', 'decorative', 'fancy concrete'] },
  { id: 'masonry', label: 'Masonry', terms: ['masonry', 'mason', 'masonary', 'brickwork', 'stonework', 'stone work', 'block work', 'blockwork'] },
  { id: 'pools', label: 'Pools & Water', terms: ['pool', 'pools', 'poolscape', 'pool scape', 'swimming pool', 'spa', 'water feature', 'hot tub'] },
  { id: 'outdoor-living', label: 'Outdoor Living', terms: ['outdoor living', 'hardscape', 'hardscaping', 'backyard build', 'outdoor space', 'patio build'] },
  { id: 'landscaping', label: 'Landscaping', terms: ['landscaping', 'landscape', 'landscaper', 'planting', 'sod', 'turf', 'irrigation', 'grading'] },
  { id: 'carpentry', label: 'Carpentry & Decks', terms: ['carpentry', 'carpenter', 'deck', 'decks', 'decking', 'pergola', 'pavilion', 'framing', 'trim work'] },
  { id: 'fencing', label: 'Fencing', terms: ['fencing', 'fence', 'fences', 'gate', 'gates', 'railing'] },
  { id: 'flooring', label: 'Flooring', terms: ['flooring', 'floors', 'floor install', 'hardwood', 'lvp', 'laminate', 'tile floor'] },
  { id: 'cabinetry', label: 'Cabinetry & Millwork', terms: ['cabinetry', 'cabinets', 'cabinet', 'millwork', 'built ins', 'built-ins', 'joinery', 'casework'] },
  { id: 'painting', label: 'Painting & Coatings', terms: ['painting', 'paint', 'painter', 'coatings', 'coating', 'staining wood', 'refinishing'] },
  { id: 'roofing', label: 'Roofing', terms: ['roofing', 'roof', 'roofer', 'shingles', 'metal roof', 'reroof', 're-roof'] },
  { id: 'plumbing', label: 'Plumbing', terms: ['plumbing', 'plumber', 'repipe', 'drain', 'drainage', 'gas line'] },
  { id: 'electrical', label: 'Electrical', terms: ['electrical', 'electrician', 'wiring', 'lighting', 'low voltage', 'landscape lighting'] },
  { id: 'remodeling', label: 'Remodeling', terms: ['remodeling', 'remodel', 'renovation', 'renovate', 'rehab', 'build out', 'buildout', 'addition'] },
  { id: 'commercial', label: 'Commercial', terms: ['commercial', 'business', 'retail build', 'tenant improvement', 'municipal', 'industrial'] }
];

/* --- project types --------------------------------------------------------
   What the thing IS, independent of trade or finish. Usually the noun a
   customer leads with.                                                      */
const TYPES = [
  { id: 'driveway', label: 'Driveway', terms: ['driveway', 'driveways', 'drive way', 'drive', 'apron', 'garage apron', 'parking pad', 'turnaround', 'motor court'] },
  { id: 'patio', label: 'Patio', terms: ['patio', 'patios', 'pateo', 'terrace', 'lanai', 'back patio', 'courtyard', 'sun deck'] },
  // Bare "deck" is deliberately ambiguous: in this metro it is as likely to
  // mean the concrete round a pool as a timber one. Both senses are
  // registered and the scorer treats the word as a single ask, so whichever
  // the contractor actually built is the one that answers.
  { id: 'pool-deck', label: 'Pool deck', terms: ['deck', 'decking', 'pool deck', 'pool decking', 'pool surround', 'pool patio', 'poolside', 'coping', 'pool coping', 'swim up bar', 'swim-up bar', 'poolscape'] },
  { id: 'walkway', label: 'Walkway', terms: ['walkway', 'walk', 'walkways', 'sidewalk', 'side walk', 'path', 'pathway', 'front walk', 'garden path'] },
  { id: 'steps', label: 'Steps & landing', terms: ['steps', 'step', 'stairs', 'stairway', 'landing', 'stoop', 'front steps', 'entry steps', 'staircase'] },
  { id: 'porch', label: 'Porch & entry', terms: ['porch', 'front porch', 'entry', 'entryway', 'entrance', 'foyer', 'front entry', 'veranda'] },
  { id: 'outdoor-kitchen', label: 'Outdoor kitchen', terms: ['outdoor kitchen', 'grill station', 'summer kitchen', 'bbq island', 'cook station', 'grill island'] },
  { id: 'firepit', label: 'Fire pit & fireplace', terms: ['fire pit', 'firepit', 'fireplace', 'fire feature', 'chiminea', 'outdoor fireplace'] },
  { id: 'retaining-wall', label: 'Retaining wall', terms: ['retaining wall', 'retainer wall', 'garden wall', 'block wall', 'terraced wall'] },
  { id: 'seat-wall', label: 'Seat wall', terms: ['seat wall', 'sitting wall', 'bench wall', 'low wall', 'knee wall'] },
  { id: 'pergola', label: 'Pergola & pavilion', terms: ['pergola', 'pavilion', 'gazebo', 'arbor', 'shade structure', 'covered patio', 'ramada'] },
  { id: 'deck', label: 'Deck', terms: ['deck', 'decking', 'wood deck', 'composite deck', 'raised deck'] },
  { id: 'fence', label: 'Fence & gate', terms: ['fence', 'fencing', 'gate', 'privacy fence', 'railing', 'handrail'] },
  { id: 'countertop', label: 'Countertop & bar', terms: ['countertop', 'counter', 'counters', 'bar top', 'bar', 'island', 'vanity', 'kitchen counter', 'outdoor bar'] },
  { id: 'interior-floor', label: 'Interior floor', terms: ['interior floor', 'inside floor', 'basement floor', 'basement', 'living room floor', 'kitchen floor', 'sunroom floor', 'floor'] },
  { id: 'garage-floor', label: 'Garage floor', terms: ['garage floor', 'garage', 'garage slab', 'shop floor', 'workshop floor'] },
  { id: 'kitchen', label: 'Kitchen', terms: ['kitchen', 'kitchen remodel', 'kitchen renovation'] },
  { id: 'bathroom', label: 'Bathroom', terms: ['bathroom', 'bath', 'shower', 'master bath', 'powder room', 'wet room'] },
  { id: 'cabinets', label: 'Cabinets & built-ins', terms: ['cabinets', 'cabinetry', 'built in', 'built-in', 'bookcase', 'closet system', 'pantry'] },
  { id: 'pool', label: 'Pool & spa', terms: ['pool', 'swimming pool', 'spa', 'hot tub', 'plunge pool', 'waterfall'] },
  { id: 'roof', label: 'Roof', terms: ['roof', 'roofing', 'shingle roof', 'metal roof', 'flat roof'] },
  { id: 'exterior', label: 'Exterior & siding', terms: ['exterior', 'siding', 'facade', 'stucco', 'veneer', 'exterior paint'] },
  { id: 'parking-lot', label: 'Parking lot', terms: ['parking lot', 'parking area', 'dumpster pad', 'loading dock', 'ada ramp'] },
  { id: 'slab', label: 'Slab & foundation', terms: ['slab', 'foundation', 'footing', 'pad', 'shed pad', 'building pad', 'footer'] },
  { id: 'landscape', label: 'Landscape & planting', terms: ['landscape', 'landscaping', 'planting', 'garden', 'sod', 'lawn', 'beds', 'mulch'] },
  { id: 'drainage', label: 'Drainage & grading', terms: ['drainage', 'grading', 'french drain', 'catch basin', 'regrade', 'downspout'] }
];

/* --- materials ------------------------------------------------------------
   What it is made of. The brief lists material as a first-class search axis
   and a later-phase hook for supplier tagging.                              */
const MATERIALS = [
  { id: 'poured-concrete', label: 'Poured concrete', terms: ['poured concrete', 'concrete', 'cement', 'cast in place', 'cast-in-place', 'ready mix', 'redimix'] },
  { id: 'pavers', label: 'Pavers', terms: ['pavers', 'paver', 'brick pavers', 'concrete pavers', 'interlocking pavers'] },
  { id: 'brick', label: 'Brick', terms: ['brick', 'bricks', 'brickwork', 'used brick', 'clay brick'] },
  { id: 'natural-stone', label: 'Natural stone', terms: ['natural stone', 'stone', 'fieldstone', 'field stone', 'limestone', 'granite slab', 'bluestone'] },
  { id: 'flagstone', label: 'Flagstone', terms: ['flagstone', 'flag stone', 'irregular flagstone', 'slate paving'] },
  { id: 'stacked-stone', label: 'Stacked stone', terms: ['stacked stone', 'stack stone', 'ledgestone', 'ledger stone', 'dry stack'] },
  { id: 'block', label: 'Block & CMU', terms: ['block', 'cmu', 'cinder block', 'concrete block', 'segmental block'] },
  { id: 'wood', label: 'Wood', terms: ['wood', 'timber', 'cedar', 'pressure treated', 'ipe', 'hardwood', 'lumber'] },
  { id: 'composite', label: 'Composite', terms: ['composite', 'trex', 'pvc decking', 'capped composite'] },
  { id: 'tile', label: 'Tile', terms: ['tile', 'porcelain', 'ceramic', 'mosaic', 'subway tile'] },
  { id: 'epoxy', label: 'Epoxy & resin', terms: ['epoxy', 'resin', 'polyaspartic', 'urethane', 'resinous'] },
  { id: 'gravel', label: 'Gravel & aggregate', terms: ['gravel', 'aggregate', 'pea gravel', 'crushed stone', 'decomposed granite'] },
  { id: 'metal', label: 'Metal', terms: ['metal', 'steel', 'aluminum', 'wrought iron', 'iron', 'corten'] },
  { id: 'stucco', label: 'Stucco & render', terms: ['stucco', 'render', 'parge', 'parging'] }
];

/* --- stamp / layout patterns --------------------------------------------- */
const PATTERNS = [
  { id: 'ashlar-slate', label: 'Ashlar slate', terms: ['ashlar slate', 'ashlar', 'ashler', 'ashlar cut', 'slate ashlar'] },
  { id: 'seamless-slate', label: 'Seamless slate', terms: ['seamless slate', 'seamless', 'seamless texture', 'skin', 'texture skin', 'no grout line', 'no grout lines'] },
  { id: 'london-cobble', label: 'London cobble', terms: ['london cobble', 'london', 'london cobblestone'] },
  { id: 'colonial-cobble', label: 'Colonial cobble', terms: ['colonial cobble', 'colonial', 'cobble', 'cobblestone', 'cobble stone', 'cobbles'] },
  { id: 'random-stone', label: 'Random stone', terms: ['random stone', 'random', 'irregular stone', 'flagstone pattern'] },
  { id: 'european-fan', label: 'European fan', terms: ['european fan', 'euro fan', 'fan pattern', 'fan', 'fantail'] },
  { id: 'wood-plank', label: 'Wood plank', terms: ['wood plank', 'wood grain', 'woodgrain', 'plank', 'boardwalk', 'barn board'] },
  { id: 'herringbone', label: 'Herringbone', terms: ['herringbone', 'herring bone', 'brick herringbone', 'chevron'] },
  { id: 'running-bond', label: 'Running bond', terms: ['running bond', 'brick pattern', 'brick stamp', 'stretcher bond'] },
  { id: 'basketweave', label: 'Basketweave', terms: ['basketweave', 'basket weave'] },
  { id: 'roman-slate', label: 'Roman slate', terms: ['roman slate', 'roman', 'grand ashlar'] },
  { id: 'travertine', label: 'Travertine', terms: ['travertine', 'traventine', 'travertin'] },
  { id: 'medallion', label: 'Medallion / inlay', terms: ['medallion', 'inlay', 'inlaid', 'compass rose', 'compass', 'sun medallion', 'star', 'logo inlay', 'hand cut', 'hand-cut'] }
];

/* --- finishes ------------------------------------------------------------- */
const FINISHES = [
  { id: 'broom', label: 'Broom finish', terms: ['broom', 'broom finish', 'broomed', 'brushed', 'light broom', 'standard finish', 'plain'] },
  { id: 'smooth-trowel', label: 'Smooth trowel', terms: ['smooth', 'smooth trowel', 'troweled', 'trowelled', 'hard trowel', 'steel trowel', 'slick'] },
  { id: 'exposed-aggregate', label: 'Exposed aggregate', terms: ['exposed aggregate', 'exposed', 'aggregate', 'pea gravel finish', 'exposed pebble'] },
  { id: 'washed', label: 'Washed / microwash', terms: ['washed', 'wash', 'microwash', 'micro wash', 'sandwash', 'sand wash', 'washed finish', 'washed aggregate', 'sand washed'] },
  { id: 'salt-finish', label: 'Salt finish', terms: ['salt finish', 'salt', 'rock salt', 'salted'] },
  { id: 'acid-stain', label: 'Acid stain', terms: ['acid stain', 'acid stained', 'acid', 'chemical stain', 'reactive stain', 'antique stain', 'stained', 'stain'] },
  { id: 'water-stain', label: 'Water-based stain', terms: ['water based stain', 'water stain', 'dye', 'dyed', 'tinted', 'stained', 'stain'] },
  { id: 'integral-color', label: 'Integral color', terms: ['integral color', 'integral colour', 'integral', 'mixed in color', 'through color', 'colored mix', 'colored', 'coloured', 'color', 'colour'] },
  { id: 'color-hardener', label: 'Color hardener', terms: ['color hardener', 'colour hardener', 'hardener', 'broadcast color', 'cast on color', 'shake on', 'colored', 'coloured', 'color', 'colour'] },
  { id: 'antique-release', label: 'Antique release', terms: ['antique release', 'release', 'antiquing', 'accent color', 'secondary color', 'two tone', 'two-tone'] },
  { id: 'polished', label: 'Polished', terms: ['polished', 'polish', 'grind and polish', 'burnished', 'honed', 'high gloss polish'] },
  { id: 'epoxy-flake', label: 'Epoxy flake', terms: ['epoxy flake', 'flake', 'chip floor', 'flake system', 'vinyl flake', 'epoxy chip'] },
  { id: 'overlay', label: 'Overlay / resurfacing', terms: ['overlay', 'resurface', 'resurfacing', 'microtopping', 'micro topping', 'skim coat', 'spray deck', 'knockdown'] },
  { id: 'sealed-gloss', label: 'Gloss sealer', terms: ['gloss', 'glossy', 'wet look', 'wet-look', 'high gloss', 'shiny'] },
  { id: 'sealed-matte', label: 'Matte sealer', terms: ['matte', 'matt', 'satin', 'natural look', 'low sheen'] },
  { id: 'painted', label: 'Painted', terms: ['painted', 'paint', 'repainted', 'two coat', 'sprayed'] },
  { id: 'sanded-refinished', label: 'Sanded & refinished', terms: ['sanded', 'refinished', 'resanded', 'screen and recoat'] }
];

/* --- colours --------------------------------------------------------------
   Real decorative-concrete colour names as they appear on the cards a
   homeowner is handed (Brickform, Solomon, Increte and the release palette),
   plus the plain-English word people reach for instead. `swatch` drives the
   colour dot in the UI; it approximates a cured, sealed sample and the UI
   says so rather than pretending it is a colour match.                      */
const COLORS = [
  { id: 'black-granite', label: 'Black Granite', swatch: '#2E2C2B', terms: ['black granite', 'granite black', 'black', 'charcoal black', 'onyx', 'obsidian'] },
  { id: 'charcoal', label: 'Charcoal', swatch: '#4A4744', terms: ['charcoal', 'dark grey', 'dark gray', 'graphite', 'smoke'] },
  { id: 'slate-grey', label: 'Slate Grey', swatch: '#6E6B67', terms: ['slate grey', 'slate gray', 'slate', 'grey', 'gray', 'natural grey', 'natural gray', 'pewter', 'silver'] },
  { id: 'platinum', label: 'Platinum', swatch: '#9A958E', terms: ['platinum', 'light grey', 'light gray', 'silver fox', 'dove', 'ash'] },
  { id: 'bone-white', label: 'Bone White', swatch: '#D9D2C6', terms: ['bone white', 'white', 'off white', 'cream', 'ivory', 'alabaster', 'limestone colour'] },
  { id: 'sandstone', label: 'Sandstone', swatch: '#C8AC82', terms: ['sandstone', 'sand', 'sandy', 'beige', 'tan', 'buff', 'desert tan'] },
  { id: 'harvest-gold', label: 'Harvest Gold', swatch: '#C9963F', terms: ['harvest gold', 'gold', 'golden', 'wheat', 'honey', 'amber', 'straw'] },
  { id: 'adobe', label: 'Adobe', swatch: '#B5794E', terms: ['adobe', 'clay', 'sunset', 'tuscan', 'caramel'] },
  { id: 'terra-cotta', label: 'Terra Cotta', swatch: '#A85A3C', terms: ['terra cotta', 'terracotta', 'terra-cotta', 'rust', 'orange', 'santa fe'] },
  { id: 'brick-red', label: 'Brick Red', swatch: '#8E4436', terms: ['brick red', 'red', 'barn red', 'salmon', 'autumn red'] },
  { id: 'chestnut', label: 'Chestnut', swatch: '#7A5237', terms: ['chestnut', 'nutmeg', 'cinnamon', 'russet', 'fawn'] },
  { id: 'walnut', label: 'Walnut', swatch: '#5E4530', terms: ['walnut', 'dark walnut', 'brown', 'coffee', 'espresso', 'padre brown', 'mahogany'] },
  { id: 'driftwood', label: 'Driftwood', swatch: '#8A7F70', terms: ['driftwood', 'weathered', 'grey brown', 'gray brown', 'taupe', 'greige', 'mushroom'] },
  { id: 'fern-green', label: 'Fern Green', swatch: '#5F6B4B', terms: ['fern green', 'green', 'sage', 'moss', 'olive', 'forest'] },
  { id: 'cordovan', label: 'Cordovan', swatch: '#6B3B3A', terms: ['cordovan', 'burgundy', 'wine', 'maroon', 'oxblood', 'plum'] },
  { id: 'navy', label: 'Navy', swatch: '#33404F', terms: ['navy', 'blue', 'midnight', 'indigo', 'slate blue'] }
];

/* --- features -------------------------------------------------------------
   The details a customer points at when they say "I want THAT". These turn a
   pin from "a patio" into "the one with the compass in it".                  */
const FEATURES = [
  { id: 'border', label: 'Contrasting border', terms: ['border', 'banded', 'band', 'ribbon', 'brick ribbon', 'accent border', 'framed'] },
  { id: 'saw-cut', label: 'Saw-cut pattern', terms: ['saw cut', 'sawcut', 'scored', 'scoring', 'grid', 'diamond pattern', 'joint pattern'] },
  { id: 'grass-joint', label: 'Grass joints', terms: ['grass joint', 'grass joints', 'turf joint', 'planted joint', 'floating pad', 'floating panels'] },
  { id: 'seat-wall', label: 'Seat wall', terms: ['seat wall', 'sitting wall', 'bench wall'] },
  { id: 'waterfall', label: 'Water feature', terms: ['waterfall', 'water feature', 'rock waterfall', 'grotto', 'spillway', 'fountain', 'bubbler'] },
  { id: 'swim-up-bar', label: 'Swim-up bar', terms: ['swim up bar', 'swim-up bar', 'pool bar', 'in pool bar', 'wet bar'] },
  { id: 'pavilion', label: 'Pavilion / cover', terms: ['pavilion', 'covered', 'cover', 'roof structure', 'pergola cover', 'gazebo', 'shade'] },
  { id: 'fire-feature', label: 'Fire feature', terms: ['fire pit', 'firepit', 'fireplace', 'fire feature', 'chimney', 'fire bowl'] },
  { id: 'waterfall-edge', label: 'Waterfall edge', terms: ['waterfall edge', 'mitred edge', 'mitered edge', 'drop edge', 'apron edge', 'waterfall counter'] },
  { id: 'logo-inlay', label: 'Custom inlay', terms: ['logo', 'logo inlay', 'custom inlay', 'engraved', 'engraving', 'monogram', 'initials', 'crest'] },
  { id: 'steps-integrated', label: 'Integrated steps', terms: ['integrated steps', 'bullnose', 'bull nose', 'tread', 'built in steps'] },
  { id: 'lighting', label: 'Integrated lighting', terms: ['lighting', 'lights', 'led', 'landscape lighting', 'step lights', 'uplighting'] },
  { id: 'drainage-detail', label: 'Drainage detail', terms: ['drain', 'channel drain', 'trench drain', 'french drain', 'catch basin'] },
  { id: 'repair', label: 'Repair / replacement', terms: ['repair', 'replaced', 'replacement', 'tear out', 'demo', 'crack repair', 'rescue', 'redo', 'fix', 'restoration'] }
];

/* --- the dimension table --------------------------------------------------
   `weight` is what a hit on this dimension is worth when ranking. Type and
   trade are the nouns people lead with, so they score highest. Colour is
   close behind, because somebody who names a colour has already decided.
   Features are the tiebreakers.

   `multi` marks the dimensions a project can hold several values of.        */
const DIMENSIONS = [
  { key: 'type',     label: 'Type',     list: TYPES,     weight: 12, multi: false },
  { key: 'trade',    label: 'Trade',    list: TRADES,    weight: 11, multi: true  },
  { key: 'color',    label: 'Color',    list: COLORS,    weight: 10, multi: true  },
  { key: 'material', label: 'Material', list: MATERIALS, weight: 9,  multi: true  },
  { key: 'pattern',  label: 'Pattern',  list: PATTERNS,  weight: 8,  multi: false },
  { key: 'finish',   label: 'Finish',   list: FINISHES,  weight: 8,  multi: true  },
  { key: 'feature',  label: 'Features', list: FEATURES,  weight: 5,  multi: true  }
];

/* --- stages ---------------------------------------------------------------
   The brief asks for before / during / after classification and pairing.    */
const STAGES = [
  { id: 'before', label: 'Before', terms: ['before', 'existing', 'demo', 'tear out', 'old', 'prior', 'original'] },
  { id: 'during', label: 'During', terms: ['during', 'in progress', 'progress', 'forming', 'pour', 'pouring', 'mid job', 'wip'] },
  { id: 'after',  label: 'After',  terms: ['after', 'finished', 'complete', 'completed', 'final', 'done', 'reveal'] }
];

/* --- noise ----------------------------------------------------------------
   Dropped before free-text scoring so "patio with black granite colored"
   does not spend a point on "with".                                         */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'with', 'in', 'on', 'of', 'for', 'to', 'at', 'by',
  'or', 'my', 'me', 'i', 'we', 'you', 'is', 'are', 'was', 'some', 'any',
  'that', 'this', 'it', 'its', 'like', 'want', 'need', 'looking', 'look',
  'show', 'find', 'see', 'got', 'have', 'has', 'had', 'do', 'does', 'did',
  'job', 'jobs', 'work', 'project', 'projects', 'please', 'something',
  // Positional filler. "near"/"around" are consumed as part of a place
  // anchor or a proximity phrase when they mean something; left over, they
  // are noise. "lot" was a term for a parking lot, which turned "a lot of
  // driveways" into a search for one.
  'near', 'around', 'close', 'lot', 'about', 'from',
  'one', 'ones', 'new', 'good', 'nice', 'ever', 'done', 'anything'
]);

/* Words that mean "sort me by distance" rather than "filter me". They are
   stripped from the query but flip the near-me switch on. */
const PROXIMITY_WORDS = [
  'near me', 'nearest', 'closest', 'close to me', 'nearby', 'near by',
  'around me', 'by me', 'close by'
];

/* Words that mean "only show me before/after sets". */
const PAIR_WORDS = ['before and after', 'before after', 'before/after', 'befores and afters', 'transformation'];

/* --- lookup index ---------------------------------------------------------
   Built once. Maps every term (and a naive plural) to {dim, id}. Phrases are
   kept whole; the parser walks the query longest-phrase-first so "black
   granite" is consumed before "black" ever gets a chance.                   */
/* Plurals are generated rather than listed by hand, and the rule has to be
   better than "+s on single words". That version left every multi-word type
   unfindable in the plural, and worse: "outdoor kitchens" fell through to
   `type:kitchen` — the INDOOR remodel — plus the free word "outdoor", so
   the brief's own example collection returned a countertop and a set of
   steps. It also produced washs, polishs, porchs and mulchs, so "porches"
   matched nothing at all. */
function pluralise(term) {
  const parts = String(term).split(' ');
  const last = parts[parts.length - 1];
  if (!last || last.endsWith('s')) return null;
  let p;
  if (/(x|z|ch|sh)$/.test(last)) p = last + 'es';
  else if (/[^aeiou]y$/.test(last)) p = last.slice(0, -1) + 'ies';
  else p = last + 's';
  parts[parts.length - 1] = p;
  return parts.join(' ');
}

const TERM_INDEX = (() => {
  const idx = new Map();
  let maxWords = 1;
  const add = (term, dim, id) => {
    const t = String(term || '').trim();
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
        const pl = pluralise(t);
        if (pl) add(pl, key, item.id);
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
  m.stage = {};
  STAGES.forEach((s) => { m.stage[s.id] = s; });
  return m;
})();

function labelFor(dim, id) {
  const hit = LABELS[dim] && LABELS[dim][id];
  return hit ? hit.label : String(id || '');
}

function swatchFor(colorId) {
  const hit = LABELS.color && LABELS.color[colorId];
  return hit ? hit.swatch : '#6E6B67';
}

/* --- implied values -------------------------------------------------------
   A project belongs to more than one bucket, and search has to know it. A
   stamped cobblestone driveway is Decorative Concrete AND Concrete AND a
   driveway — with a single trade value, "cobblestone driveway" ranked two
   non-cobble driveways above the one that was cobble. These are the buckets
   implied by what a project is, rather than typed by hand.                  */
const IMPLIED_TRADE = {
  type: {
    driveway: 'concrete', patio: 'concrete', 'pool-deck': 'pools', walkway: 'concrete',
    steps: 'concrete', porch: 'concrete', 'outdoor-kitchen': 'outdoor-living',
    firepit: 'outdoor-living', 'retaining-wall': 'masonry', 'seat-wall': 'masonry',
    pergola: 'carpentry', deck: 'carpentry', fence: 'fencing', countertop: 'concrete',
    'interior-floor': 'flooring', 'garage-floor': 'flooring', kitchen: 'remodeling',
    bathroom: 'remodeling', cabinets: 'cabinetry', pool: 'pools', roof: 'roofing',
    exterior: 'painting', 'parking-lot': 'commercial', slab: 'concrete',
    landscape: 'landscaping', drainage: 'landscaping'
  },
  finish: {
    // "Decorative Concrete" is one line on the website, so any deliberate
    // colour or texture puts the project on it — which is what makes a search
    // for "colored driveway" find a stamped drive with a hardener in it.
    'acid-stain': 'decorative-concrete',
    'water-stain': 'decorative-concrete',
    'integral-color': 'decorative-concrete',
    'color-hardener': 'decorative-concrete',
    'antique-release': 'decorative-concrete',
    polished: 'decorative-concrete',
    'epoxy-flake': 'flooring',
    overlay: 'decorative-concrete',
    painted: 'painting',
    'sanded-refinished': 'flooring'
  },
  pattern: {
    // Every stamp pattern implies decorative concrete.
    _any: 'decorative-concrete'
  },
  material: {
    brick: 'masonry', 'natural-stone': 'masonry', 'stacked-stone': 'masonry',
    block: 'masonry', flagstone: 'masonry', pavers: 'masonry',
    wood: 'carpentry', composite: 'carpentry', tile: 'flooring', epoxy: 'flooring',
    stucco: 'masonry', metal: 'fencing'
  }
};

/* Every trade a project sits on, primary first. */
function tradeSet(project) {
  const out = [];
  const push = (id) => { if (id && !out.includes(id)) out.push(id); };
  const raw = project.trade;
  (Array.isArray(raw) ? raw : raw ? [raw] : []).forEach(push);
  push(IMPLIED_TRADE.type[project.type]);
  (project.material || []).forEach((m) => push(IMPLIED_TRADE.material[m]));
  (project.finish || []).forEach((f) => push(IMPLIED_TRADE.finish[f]));
  if (project.pattern) push(IMPLIED_TRADE.pattern._any);
  return out;
}

/* The one the pin glyph and the card eyebrow use. */
function primaryTrade(project) {
  const raw = project.trade;
  if (Array.isArray(raw) && raw.length) return raw[0];
  if (typeof raw === 'string' && raw) return raw;
  return tradeSet(project)[0] || 'concrete';
}

/* Exported for the headless tests, which run outside a browser. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRADES, TYPES, MATERIALS, PATTERNS, FINISHES, COLORS, FEATURES,
    DIMENSIONS, STAGES, STOPWORDS, PROXIMITY_WORDS, PAIR_WORDS, pluralise,
    TERM_INDEX, LABELS, labelFor, swatchFor, tradeSet, primaryTrade, IMPLIED_TRADE
  };
}
