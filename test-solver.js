/* Headless check of the solver core in decoder.js.
   Loads everything above the DOM section and plays full games. */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/decoder.js', 'utf8');
const cut = src.indexOf('/* ── state');
if (cut < 0) throw new Error('marker not found');
const core = src.slice(0, cut);
const box = {};
(new Function(core + '\nreturn {LEN,NCOL,SPACE,PALETTE,scoreOf,packed,consistent,costOf,randomInto,hillClimb,keyCounts};')).call(box);
const M = (new Function(core + '\nreturn {LEN,NCOL,SPACE,scoreOf,packed,consistent,costOf,randomInto,hillClimb,keyCounts};'))();

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL ' + msg); } };

/* 1. scoring */
const s = (a, b) => { const p = M.scoreOf(a, b); return [p >> 4, p & 15]; };
console.log('scoring');
ok(String(s([0,1,2,3,4,5,6,7],[0,1,2,3,4,5,6,7])) === '8,0', 'identical → 8 exact');
ok(String(s([0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1])) === '0,0', 'disjoint → nothing');
ok(String(s([0,1,2,3,4,5,6,7],[7,6,5,4,3,2,1,0])) === '0,8', 'reversed → 8 close');
ok(String(s([0,0,1,1,2,2,3,3],[0,1,0,1,2,2,4,4])) === '4,2', 'duplicates counted by multiplicity');
ok(String(s([5,5,5,0,0,0,0,0],[5,5,0,0,0,0,0,0])) === '7,0', 'extra copy is not a close peg');
ok(String(s([0,1,1,1,1,1,1,1],[1,0,2,2,2,2,2,2])) === '0,2', 'min(count) rule');
// symmetry
for (let t = 0; t < 400; t++) {
  const a = [], b = [];
  for (let i = 0; i < 8; i++) { a.push((Math.random()*15)|0); b.push((Math.random()*15)|0); }
  ok(M.scoreOf(a,b) === M.scoreOf(b,a), 'score is symmetric');
  const [e, c] = s(a,b);
  ok(e + c <= 8, 'exact + close never exceeds 8');
}

/* 2. hill climb finds codes that satisfy every constraint */
console.log('guided repair');
for (let trial = 0; trial < 30; trial++) {
  const secret = []; for (let i = 0; i < 8; i++) secret.push((Math.random()*15)|0);
  const cons = [];
  for (let g = 0; g < 5; g++) {
    const guess = []; for (let i = 0; i < 8; i++) guess.push((Math.random()*15)|0);
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

/* 2b. no-repeats mode keeps codes distinct */
console.log('no-repeats mode');
for (let trial = 0; trial < 15; trial++) {
  const bagArr = [...Array(15).keys()];
  for (let i = bagArr.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; [bagArr[i],bagArr[j]]=[bagArr[j],bagArr[i]]; }
  const secret = bagArr.slice(0, 8);
  const cons = [];
  const scratch = new Uint8Array(8);
  for (let g = 0; g < 4; g++) {
    M.randomInto(scratch, false);
    const guess = Array.from(scratch);
    ok(new Set(guess).size === 8, 'randomInto(no repeats) has 8 distinct pegs');
    cons.push({ code: guess, target: M.scoreOf(secret, guess) });
  }
  let hits = 0;
  for (let a = 0; a < 60; a++) if (M.hillClimb(scratch, cons, false)) {
    ok(new Set(Array.from(scratch)).size === 8, 'repaired no-repeat code stays distinct');
    ok(M.consistent(scratch, cons), 'repaired no-repeat code is consistent');
    hits++;
  }
  ok(hits > 0, 'no-repeat repair found a code');
}

/* 3. full games: same pipeline the page runs (reject, then repair), informative pick */
function buildPool(cons, target, allowRepeats) {
  const scratch = new Uint8Array(8);
  const seen = new Set(), pool = [];
  let attempts = 0, accepted = 0, repaired = 0;
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
  if (pool.length < target && cons.length) {
    const t1 = Date.now(); let stale = 0;
    while (pool.length < target && Date.now() - t1 < 1400 && stale < 600) {
      if (M.hillClimb(scratch, cons, allowRepeats)) {
        const k = scratch.join(',');
        if (!seen.has(k)) { seen.add(k); pool.push(Array.from(scratch)); repaired++; stale = 0; continue; }
      }
      stale++;
    }
  }
  return { pool, attempts, accepted, repaired };
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

console.log('full games');
const GAMES = 20, MAXTURNS = 14;
let solvedCount = 0, turnsTotal = 0, worst = 0, slowest = 0;
for (let g = 0; g < GAMES; g++) {
  const secret = []; for (let i = 0; i < 8; i++) secret.push((Math.random()*15)|0);
  const cons = [];
  let turns = 0, done = false;
  while (turns < MAXTURNS && !done) {
    const t = Date.now();
    const { pool, repaired } = buildPool(cons, 1000, true);
    slowest = Math.max(slowest, Date.now() - t);
    if (!pool.length) { console.log('  FAIL empty pool on game ' + g + ' turn ' + turns); fails++; break; }
    for (const c of pool) ok(M.consistent(c, cons), 'every pooled code satisfies every row');
    ok(pool.some(c => c.join() === secret.join()) || repaired > 0 || pool.length >= 1000,
       'secret survives in a full uniform pool');
    const guess = pick(pool);
    const res = M.scoreOf(secret, guess);
    turns++;
    if ((res >> 4) === 8) { done = true; break; }
    cons.push({ code: guess, target: res });
  }
  if (done) { solvedCount++; turnsTotal += turns; worst = Math.max(worst, turns); }
  else { console.log('  FAIL game ' + g + ' unsolved in ' + MAXTURNS + ' turns (secret ' + secret.join(' ') + ')'); fails++; }
}
console.log('  solved ' + solvedCount + '/' + GAMES +
  ', mean ' + (turnsTotal / Math.max(solvedCount,1)).toFixed(2) + ' turns, worst ' + worst +
  ', slowest solve ' + slowest + 'ms');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall checks passed');
process.exit(fails ? 1 : 0);
