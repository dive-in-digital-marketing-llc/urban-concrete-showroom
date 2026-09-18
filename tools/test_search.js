/* Headless check of the parser + ranker against the queries this product was
   pitched on. Run: node tools/test_search.js
   Exits non-zero if any expectation fails, so CI can gate on it. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..');

const ctx = { console, module: {}, window: {}, document: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(APP, 'assets/vocab.js'), 'utf8'), ctx);

// Pull the Search IIFE and its helpers out of app.js without the DOM half.
const app = fs.readFileSync(path.join(APP, 'assets/app.js'), 'utf8');
const start = app.indexOf('function milesBetween');
const end = app.indexOf('/* ==========================================================================\n   4. app state');
if (start < 0 || end < 0) throw new Error(`could not slice app.js (start=${start}, end=${end})`);
vm.runInContext(app.slice(start, end), ctx);
// Top-level const in a vm script is a lexical binding, not a property of the
// global object, so hand the pieces out explicitly.
vm.runInContext('globalThis.__api = { Search, milesBetween, DIMENSIONS, serviceSet, primaryService };', ctx);
const API = ctx.__api;

const jobs = JSON.parse(fs.readFileSync(path.join(APP, 'data/seed.json'), 'utf8'));
const HERE = { lat: 35.0420, lng: -89.6645 }; // standing in Collierville

let fails = 0;
function check(q, expect, opts = {}) {
  const parsed = API.Search.parse(q);
  const out = API.Search.run(jobs, parsed, opts.here === null ? null : HERE);
  const top = out.results.slice(0, 3).map(r => r.job.id);
  const facets = Object.fromEntries(
    Object.entries(parsed.facets).map(([k, v]) => [k, [...v]]));

  let ok = true;
  const notes = [];

  if (expect.facets) {
    for (const [dim, ids] of Object.entries(expect.facets)) {
      const got = facets[dim] || [];
      for (const id of ids) {
        if (!got.includes(id)) { ok = false; notes.push(`missing facet ${dim}=${id}`); }
      }
    }
  }
  if (expect.topIs && top[0] !== expect.topIs) {
    ok = false; notes.push(`top was ${top[0]}, wanted ${expect.topIs}`);
  }
  if (expect.topIncludes) {
    const within = out.results.slice(0, expect.within || 3).map((r) => r.job.id);
    for (const id of expect.topIncludes) {
      if (!within.includes(id)) { ok = false; notes.push(`${id} not in top ${expect.within || 3}`); }
    }
  }
  if (expect.minResults && out.results.length < expect.minResults) {
    ok = false; notes.push(`only ${out.results.length} results`);
  }
  if (expect.notCut && out.cut) { ok = false; notes.push('fell back to closest-matches'); }
  if (expect.spotlight && !out.results.some((r) => r.spotlight)) {
    ok = false; notes.push('expected a "closest thing we have built" promotion');
  }
  if (expect.topAllMatch) {
    out.results.slice(0, 3).forEach((r) => {
      if (!expect.topAllMatch(r.job)) { ok = false; notes.push(`${r.job.id} should not be in the top 3`); }
    });
  }
  if (expect.nearMe !== undefined && parsed.nearMe !== expect.nearMe) {
    ok = false; notes.push(`nearMe was ${parsed.nearMe}`);
  }

  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${q}"`);
  console.log(`      parsed: ${JSON.stringify(facets)}${parsed.free.length ? ' free=' + JSON.stringify(parsed.free) : ''}`);
  console.log(`      top:    ${out.results.slice(0, 3).map((r, i) =>
    `${i + 1}. ${r.job.title} (${r.score.toFixed(1)}, ${r.miles ? r.miles.toFixed(1) + 'mi' : '—'})`).join('\n              ')}`);
  if (notes.length) console.log(`      !!      ${notes.join('; ')}`);
  console.log('');
}

console.log('=== the two queries the product was pitched on ===\n');

check('stamped & colored driveway', {
  facets: { service: ['stamped-concrete'], surface: ['driveway'] },
  minResults: 4, notCut: true,
  // every top hit must actually be a stamped driveway, not just any driveway
  topAllMatch: (j) => API.serviceSet(j).includes('stamped-concrete')
                   && j.surface === 'driveway'
});

check('patio with black granite colored', {
  facets: { surface: ['patio'], color: ['black-granite'] },
  topIs: 'seed-compass-patio-collierville', notCut: true
});

console.log('=== the way people actually talk ===\n');

check('stamped concrete driveway near me', { nearMe: true, facets: { surface: ['driveway'] } });
check('pool deck washed aggregate', { facets: { surface: ['pool-deck'], finish: ['washed'] }, minResults: 3 });
check('seamless slate patio', {
  facets: { pattern: ['seamless-slate'] },
  // regression: the only seamless-slate job he owns is a pool deck, and it was
  // being dropped entirely rather than offered as the closest thing available
  /* He has no seamless-slate PATIO. Patios first is the right answer; what
     matters is that the seamless-slate job he does own (a pool deck) is on the
     screen and near the top, not dropped. */
  topIncludes: ['seed-seamless-deck-collierville'], within: 2, minResults: 4,
  spotlight: true
});
check('do you have any stamped patios', { facets: { service: ['stamped-concrete'], surface: ['patio'] } });
check('exposed aggregate drive', {
  facets: { surface: ['driveway'], finish: ['exposed-aggregate'] },
  topIs: 'seed-exposed-drive-germantown'
});
check('outdoor kitchen with a fireplace', { facets: { surface: ['outdoor-kitchen'] } });
check('black bar top', { facets: { color: ['black-granite'], surface: ['countertop'] } });
check('stained patio with a fire pit', { facets: { service: ['stained-concrete'] } });
check('retaining wall', { facets: { service: ['masonry'], surface: ['wall'] } });
check('somethin like a cobblestone driveway', {
  facets: { pattern: ['colonial-cobble'], surface: ['driveway'] },
  topIs: 'seed-cobble-drive-germantown'   // regression: cobble drive ranked 3rd behind two non-cobble drives
});
check('grey pool deck no grout lines', { facets: { pattern: ['seamless-slate'] } });

console.log('=== edge cases ===\n');
check('', { minResults: 30 });
check('zzzzqqq nonsense', {});
check('driveway', { facets: { surface: ['driveway'] }, minResults: 6 });

console.log(fails ? `\n${fails} FAILING CHECK(S)\n` : '\nAll checks passed.\n');
process.exit(fails ? 1 : 0);
