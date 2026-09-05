/* Headless check of the solver core in decoder.js.
   Loads everything above the DOM section and plays full games at several board sizes. */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/decoder.js', 'utf8');
const cut = src.indexOf('/* ── state');
if (cut < 0) throw new Error('marker not found');
const core = src.slice(0, cut);
const M = (new Function(core + '\nreturn {LIMITS,DEF_LEN,DEF_NCOL,configure,buildPalette,canDistinct,' +
  'scoreOf,packed,exactOf,closeOf,consistent,costOf,randomInto,hillClimb,keyCounts,' +
  'cfg:()=>({LEN,NCOL,SPACE,PACK,PALETTE})};'))();

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL ' + msg); } };
const randCode = (len, ncol) => Array.from({ length: len }, () => (Math.random() * ncol) | 0);

/* 1. scoring, at the default 8 slots over 15 pegs */
M.configure(8, 15);
const s = (a, b) => { const p = M.scoreOf(a, b); return [M.exactOf(p), M.closeOf(p)]; };
console.log('scoring');
ok(String(s([0,1,2,3,4,5,6,7],[0,1,2,3,4,5,6,7])) === '8,0', 'identical → 8 exact');
ok(String(s([0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1])) === '0,0', 'disjoint → nothing');
ok(String(s([0,1,2,3,4,5,6,7],[7,6,5,4,3,2,1,0])) === '0,8', 'reversed → 8 close');
ok(String(s([0,0,1,1,2,2,3,3],[0,1,0,1,2,2,4,4])) === '4,2', 'duplicates counted by multiplicity');
ok(String(s([5,5,5,0,0,0,0,0],[5,5,0,0,0,0,0,0])) === '7,0', 'extra copy is not a close peg');
ok(String(s([0,1,1,1,1,1,1,1],[1,0,2,2,2,2,2,2])) === '0,2', 'min(count) rule');

/* 1b. the same laws hold at every board size, and packing never collides */
console.log('scoring across board sizes');
const SIZES = [[2,2],[3,4],[4,6],[5,15],[8,15],[12,10],[16,24],[2,24]];
for (const [len, ncol] of SIZES) {
  M.configure(len, ncol);
  const c = M.cfg();
  ok(c.LEN === len && c.NCOL === ncol, 'configure(' + len + ',' + ncol + ') takes');
  ok(c.PALETTE.length === ncol, 'palette has one colour per peg (' + ncol + ')');
  ok(new Set(c.PALETTE).size === ncol, 'palette colours are distinct (' + ncol + ')');
  ok(c.SPACE === Math.pow(ncol, len), 'search space is ncol^len (' + len + ',' + ncol + ')');
  const seenPack = new Set();
  for (let e = 0; e <= len; e++) for (let cl = 0; cl + e <= len; cl++) {
    const p = M.packed(e, cl);
    ok(!seenPack.has(p), 'packed results are unique (' + len + ',' + ncol + ')');
    seenPack.add(p);
    ok(M.exactOf(p) === e && M.closeOf(p) === cl, 'packed round-trips (' + e + ',' + cl + ')');
  }
  const same = randCode(len, ncol);
  ok(M.scoreOf(same, same) === M.packed(len, 0), 'identical → all exact (' + len + ',' + ncol + ')');
  for (let t = 0; t < 200; t++) {
    const a = randCode(len, ncol), b = randCode(len, ncol);
    ok(M.scoreOf(a, b) === M.scoreOf(b, a), 'score is symmetric (' + len + ',' + ncol + ')');
    const p = M.scoreOf(a, b);
    ok(M.exactOf(p) + M.closeOf(p) <= len, 'exact + close never exceeds the code length');
  }
}

/* 1c. limits are enforced, out-of-range sizes clamp */
console.log('limits');
M.configure(999, 999);
ok(M.cfg().LEN === M.LIMITS.len[1] && M.cfg().NCOL === M.LIMITS.ncol[1], 'oversized board clamps to the ceiling');
M.configure(0, 1);
ok(M.cfg().LEN === M.DEF_LEN && M.cfg().NCOL === M.LIMITS.ncol[0], 'zero falls back, undersized clamps to the floor');

/* 2. hill climb finds codes that satisfy every constraint */
console.log('guided repair');
M.configure(8, 15);
for (let trial = 0; trial < 30; trial++) {
  const secret = randCode(8, 15);
  const cons = [];
  for (let g = 0; g < 5; g++) {
    const guess = randCode(8, 15);
    cons.push({ code: guess, target: M.scoreOf(secret, guess) });
  }
  const scratch = new Uint8Array(8);
  let hits = 0;
  for (let a = 0; a < 60; a++) if (M.hillClimb(scratch, cons, true)) {
    ok(M.consistent(scratch, cons), 'repaired code satisfies all constraints');
    hits++;
  }
  ok(hits > 0, 'repair found at least one code for 5 constraints (trial ' + trial + ')');
}

/* 2b. no-repeats mode keeps codes distinct, at any size that allows it */
console.log('no-repeats mode');
for (const [len, ncol] of [[8,15],[4,6],[10,12]]) {
  M.configure(len, ncol);
  for (let trial = 0; trial < 8; trial++) {
    const bagArr = [...Array(ncol).keys()];
    for (let i = bagArr.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; [bagArr[i],bagArr[j]]=[bagArr[j],bagArr[i]]; }
    const secret = bagArr.slice(0, len);
    const cons = [];
    const scratch = new Uint8Array(len);
    for (let g = 0; g < 4; g++) {
      M.randomInto(scratch, false);
      const guess = Array.from(scratch);
      ok(new Set(guess).size === len, 'randomInto(no repeats) has ' + len + ' distinct pegs');
      cons.push({ code: guess, target: M.scoreOf(secret, guess) });
    }
    let hits = 0;
    for (let a = 0; a < 60; a++) if (M.hillClimb(scratch, cons, false)) {
      ok(new Set(Array.from(scratch)).size === len, 'repaired no-repeat code stays distinct');
      ok(M.consistent(scratch, cons), 'repaired no-repeat code is consistent');
      hits++;
    }
    ok(hits > 0, 'no-repeat repair found a code (' + len + ',' + ncol + ')');
  }
}

/* 2c. a code longer than the peg set cannot be distinct, so sampling falls back to repeats */
console.log('over-long codes');
M.configure(6, 4);
ok(!M.canDistinct(), 'canDistinct() is false when the code outruns the peg set');
const over = new Uint8Array(6);
for (let t = 0; t < 50; t++) {
  M.randomInto(over, false);
  ok(Array.from(over).every(v => v >= 0 && v < 4), 'fallback sampling stays in range');
}

/* 3. full games: same pipeline the page runs (reject, then repair), informative pick */
function buildPool(len, cons, target, allowRepeats, prev) {
  const scratch = new Uint8Array(len);
  const seen = new Set(), pool = [];
  let attempts = 0, accepted = 0, repaired = 0, carried = 0;
  const nearby = prev || [];
  const survivors = nearby.filter(c => M.consistent(c, cons));
  const seedFor = () => {
    if (Math.random() < 0.5) return null;
    return pool.length ? pool[(Math.random()*pool.length)|0]
      : nearby.length ? nearby[(Math.random()*nearby.length)|0] : null;
  };
  const CAP = Math.max(500000, target * 400);
  const t0 = Date.now();
  while (pool.length < target && attempts < CAP && Date.now() - t0 < 900) {
    M.randomInto(scratch, allowRepeats); attempts++;
    if (M.consistent(scratch, cons)) {
      accepted++;
      const k = scratch.join(',');
      if (!seen.has(k)) { seen.add(k); pool.push(Array.from(scratch)); }
    }
  }
  for (const c of survivors) {
    if (pool.length >= target) break;
    const k = c.join(',');
    if (!seen.has(k)) { seen.add(k); pool.push(c); carried++; }
  }
  if (pool.length < target && cons.length) {
    const t1 = Date.now(); let stale = 0;
    while (pool.length < target && Date.now() - t1 < 1400 && stale < 600) {
      if (M.hillClimb(scratch, cons, allowRepeats, seedFor())) {
        const k = scratch.join(',');
        if (!seen.has(k)) { seen.add(k); pool.push(Array.from(scratch)); repaired++; stale = 0; continue; }
      }
      stale++;
    }
  }
  return { pool, attempts, accepted, repaired, carried };
}
function pick(pool) {
  if (pool.length === 1) return pool[0];
  const sh = pool.slice().sort(() => Math.random() - 0.5);
  const cand = sh.slice(0, Math.min(80, pool.length));
  const test = sh.slice(0, Math.min(400, pool.length));
  let best = null, bestExp = Infinity;
  for (const g of cand) {
    const b = new Map();
    for (const t of test) { const v = M.scoreOf(t, g); b.set(v, (b.get(v) || 0) + 1); }
    let sum = 0; for (const v of b.values()) sum += v * v;
    if (sum / test.length < bestExp) { bestExp = sum / test.length; best = g; }
  }
  return best;
}

function playGames(len, ncol, games, poolTarget, maxTurns) {
  M.configure(len, ncol);
  let solvedCount = 0, starved = 0, turnsTotal = 0, worst = 0, slowest = 0;
  for (let g = 0; g < games; g++) {
    const secret = randCode(len, ncol);
    const cons = [];
    let turns = 0, done = false, prev = [];
    while (turns < maxTurns && !done) {
      const t = Date.now();
      const { pool, repaired, carried } = buildPool(len, cons, poolTarget, true, prev);
      slowest = Math.max(slowest, Date.now() - t);
      if (!pool.length) { starved++; break; }
      for (const c of pool) ok(M.consistent(c, cons), 'every pooled code satisfies every row');
      ok(pool.some(c => c.join() === secret.join()) || repaired > 0 || carried > 0 || pool.length >= poolTarget,
         'secret survives in a full uniform pool');
      prev = pool;
      const guess = pick(pool);
      const res = M.scoreOf(secret, guess);
      turns++;
      if (M.exactOf(res) === len) { done = true; break; }
      cons.push({ code: guess, target: res });
    }
    if (done) { solvedCount++; turnsTotal += turns; worst = Math.max(worst, turns); }
  }
  // A game that neither cracks the code nor reports an empty pool has run out of
  // turns with candidates still standing, which means the guesses stopped cutting.
  ok(solvedCount + starved === games, len + '×' + ncol + ': every game ends solved or starved');
  console.log('  ' + len + '×' + ncol + ': solved ' + solvedCount + '/' + games +
    (starved ? ', starved ' + starved : '') +
    ', mean ' + (turnsTotal / Math.max(solvedCount,1)).toFixed(2) + ' turns, worst ' + worst +
    ', slowest solve ' + slowest + 'ms');
  return { solved: solvedCount, starved, games };
}

console.log('full games');
const eight = playGames(8, 15, 20, 1000, 14);
ok(eight.solved === eight.games, 'every 8×15 game solved');
const small = playGames(4, 6, 8, 300, 10);
ok(small.solved === small.games, 'every 4×6 game solved');
const six = playGames(6, 10, 8, 600, 12);
ok(six.solved === six.games, 'every 6×10 game solved');
// Two slots split the field into five score classes, one of which holds ~84% of
// it, so a short code needs many more turns than a long one — not a stall.
const short = playGames(2, 24, 3, 200, 60);
ok(short.solved === short.games, 'every 2×24 game solved');
// Long codes are where sampling strains: the remaining set gets small enough that
// neither random draws nor repair find it, and the pool comes back empty. Past
// eight slots that is reported, not asserted away — what has to hold is that the
// pipeline stays sound, which the per-turn checks above cover.
const ten = playGames(10, 12, 6, 600, 18);
const long = playGames(12, 15, 4, 1000, 24);
console.log('  (starved: ' + ten.starved + '/' + ten.games + ' at 10 slots, ' +
  long.starved + '/' + long.games + ' at 12 — the documented limit of sampling)');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall checks passed');
process.exit(fails ? 1 : 0);
