/* Decoder — Mastermind solver by consistency sampling.
   The code length and the number of pegs are both configurable; the board
   defaults to 8 slots drawn from 15 pegs numbered 0–14. */

const LIMITS = { len: [2, 16], ncol: [2, 24] };
const DEF_LEN = 8, DEF_NCOL = 15;
const FIELD_MAX = 320;                       // candidate strips drawn
const STORE_KEY = 'decoder.v2';

/* Fifteen hand-picked pegs. A smaller set takes an even spread of these so the
   colours stay far apart; a larger one falls back to a generated wheel. */
const BASE_PALETTE = [
  '#E23B3B', '#F2712C', '#F3B41B', '#DCE84B', '#8FCB3F',
  '#35A85B', '#2FBFA0', '#35B7E8', '#3D6FE0', '#6C4BE0',
  '#A64BD6', '#E45BB8', '#F09090', '#9C6B45', '#C9CBD6'
];

const clamp = (n, [lo, hi]) => n < lo ? lo : n > hi ? hi : n;

function hslHex(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = k => {
    const t = (k + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(t - 3, 9 - t, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function buildPalette(n) {
  const base = BASE_PALETTE;
  if (n <= base.length) {
    return Array.from({ length: n }, (_, i) =>
      base[n === 1 ? 0 : Math.round(i * (base.length - 1) / (n - 1))]);
  }
  // Alternating lightness keeps neighbouring hues apart once the wheel gets crowded.
  return Array.from({ length: n }, (_, i) =>
    hslHex((i * 360 / n + 6) % 360, i % 2 ? 54 : 72, i % 3 === 1 ? 68 : 54));
}

function relLum(hex) {
  const v = i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
}

/* ── board configuration ─────────────────────────────────── */
/* Everything below reads LEN / NCOL, so changing the board is a matter of
   calling configure() and re-rendering. */
let LEN, NCOL, SPACE, PACK, PALETTE, LIGHT_PEG, cntA, cntB, bag;

function configure(len, ncol) {
  LEN = clamp(Math.round(len) || DEF_LEN, LIMITS.len);
  NCOL = clamp(Math.round(ncol) || DEF_NCOL, LIMITS.ncol);
  SPACE = Math.pow(NCOL, LEN);
  PACK = LEN + 1;                            // a result packs as exact*PACK + close
  PALETTE = buildPalette(NCOL);
  LIGHT_PEG = PALETTE.map(h => relLum(h) > 0.32);
  cntA = new Int32Array(NCOL);
  cntB = new Int32Array(NCOL);
  bag = new Uint8Array(NCOL);
}
configure(DEF_LEN, DEF_NCOL);

// Distinct pegs are only possible while the code is no longer than the peg set.
const canDistinct = () => LEN <= NCOL;

/* ── scoring ─────────────────────────────────────────────── */
function scoreOf(a, b) {
  let exact = 0;
  cntA.fill(0); cntB.fill(0);
  for (let i = 0; i < LEN; i++) {
    const x = a[i], y = b[i];
    if (x === y) exact++;
    else { cntA[x]++; cntB[y]++; }
  }
  let close = 0;
  for (let c = 0; c < NCOL; c++) close += cntA[c] < cntB[c] ? cntA[c] : cntB[c];
  return exact * PACK + close;
}

const packed = (exact, close) => exact * PACK + close;
const exactOf = p => (p / PACK) | 0;
const closeOf = p => p % PACK;

function keyCounts(key) {
  let exact = 0, close = 0;
  for (const k of key) { if (k === 1) exact++; else if (k === 2) close++; }
  return { exact, close };
}

function consistent(code, cons) {
  for (let i = 0; i < cons.length; i++) {
    if (scoreOf(code, cons[i].code) !== cons[i].target) return false;
  }
  return true;
}

function costOf(code, cons) {
  let total = 0;
  for (let i = 0; i < cons.length; i++) {
    const s = scoreOf(code, cons[i].code), t = cons[i].target;
    total += Math.abs(exactOf(s) - exactOf(t)) + Math.abs(closeOf(s) - closeOf(t));
  }
  return total;
}

/* ── random codes ────────────────────────────────────────── */
const randInt = n => (Math.random() * n) | 0;

function randomInto(code, allowRepeats) {
  if (allowRepeats || !canDistinct()) {
    for (let i = 0; i < LEN; i++) code[i] = randInt(NCOL);
  } else {
    // partial Fisher–Yates over 0..NCOL-1
    for (let i = 0; i < NCOL; i++) bag[i] = i;
    for (let i = 0; i < LEN; i++) {
      const j = i + randInt(NCOL - i);
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      code[i] = bag[i];
    }
  }
}

/* Nudge a code off a known-good spot without breaking the distinct-peg rule. */
function kick(code, allowRepeats) {
  const i = randInt(LEN);
  if (allowRepeats || !canDistinct()) { code[i] = randInt(NCOL); return; }
  for (let t = 0; t < 8; t++) {
    const v = randInt(NCOL);
    if (!code.includes(v)) { code[i] = v; return; }
  }
  const j = randInt(LEN), tmp = code[i]; code[i] = code[j]; code[j] = tmp;
}

/* Guided repair: hill-climb a code until it satisfies every row. Used only when
   uniform sampling has starved. Given a seed — a code that already fits — it
   restarts from a kicked copy of it, which converges far more often than a
   random restart once the rows pile up or the code gets long. */
function hillClimb(code, cons, allowRepeats, seed) {
  if (seed) {
    for (let i = 0; i < LEN; i++) code[i] = seed[i];
    const kicks = 1 + randInt(2);
    for (let k = 0; k < kicks; k++) kick(code, allowRepeats);
  } else {
    randomInto(code, allowRepeats);
  }
  let cur = costOf(code, cons);
  let sideways = 0;

  for (let step = 0; step < 160 && cur > 0; step++) {
    let best = Infinity, moveI = -1, moveV = -1, swap = false, ties = 0;

    for (let i = 0; i < LEN; i++) {
      const orig = code[i];
      for (let v = 0; v < NCOL; v++) {
        if (v === orig) continue;
        if (!allowRepeats && code.includes(v)) continue;
        code[i] = v;
        const c = costOf(code, cons);
        code[i] = orig;
        if (c < best) { best = c; moveI = i; moveV = v; swap = false; ties = 1; }
        else if (c === best && Math.random() * ++ties < 1) { moveI = i; moveV = v; swap = false; }
      }
    }
    if (!allowRepeats) {
      for (let i = 0; i < LEN; i++) for (let j = i + 1; j < LEN; j++) {
        const a = code[i], b = code[j];
        code[i] = b; code[j] = a;
        const c = costOf(code, cons);
        code[i] = a; code[j] = b;
        if (c < best) { best = c; moveI = i; moveV = j; swap = true; ties = 1; }
        else if (c === best && Math.random() * ++ties < 1) { moveI = i; moveV = j; swap = true; }
      }
    }

    if (best > cur) break;
    if (best === cur) { if (++sideways > 10) break; } else sideways = 0;

    if (swap) { const t = code[moveI]; code[moveI] = code[moveV]; code[moveV] = t; }
    else code[moveI] = moveV;
    cur = best;
  }
  return cur === 0;
}

/* ── state ───────────────────────────────────────────────── */
const state = {
  guesses: [],                                  // { code:[LEN], key:[LEN of 0|1|2] }
  draft: { code: Array(LEN).fill(null), key: emptyKey() },
  sel: 0,
  poolSize: 1000,
  allowRepeats: true,
  optimise: true,
  pool: [],
  seeds: [],                                    // last non-empty pool, kept for restarts
  fieldCodes: [],
  stats: null,
  suggestion: null,
  scale: 1,
  solving: false,
  run: 0
};

/* ── tiny DOM helpers ────────────────────────────────────── */
const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const yieldUI = () => new Promise(r => setTimeout(r, 0));
const fmt = n => Math.round(n).toLocaleString('en-US');

function pegEl(v, tag) {
  const n = el(tag || 'span', 'peg ' + (LIGHT_PEG[v] ? 'on-light' : 'on-dark'), String(v));
  n.style.background = PALETTE[v];
  return n;
}

/* ── rendering ───────────────────────────────────────────── */
function renderRail() {
  const rail = $('rail');
  rail.innerHTML = '';
  PALETTE.forEach(c => { const i = el('i'); i.style.background = c; rail.appendChild(i); });
}

function renderPalette() {
  const p = $('palette');
  p.innerHTML = '';
  // Past fifteen pegs the row wraps rather than shrinking the pegs to nothing.
  p.style.setProperty('--pcols', Math.min(NCOL, 15));
  for (let v = 0; v < NCOL; v++) {
    const b = pegEl(v, 'button');
    b.type = 'button';
    b.title = 'Peg ' + v;
    b.setAttribute('aria-label', 'Peg ' + v);
    b.addEventListener('click', () => placePeg(v));
    p.appendChild(b);
  }
}

function codeStrip(code, opts) {
  const wrap = el('div', 'code');
  code.forEach((v, i) => {
    if (opts && opts.slots) {
      const btn = el('button', 'slot' + (opts.selected === i ? ' sel' : ''));
      btn.type = 'button';
      btn.setAttribute('aria-label', v == null ? 'Slot ' + (i + 1) + ', empty' : 'Slot ' + (i + 1) + ', peg ' + v);
      btn.appendChild(v == null ? el('div', 'hole') : pegEl(v));
      btn.addEventListener('click', () => { state.sel = i; renderRows(); });
      wrap.appendChild(btn);
    } else {
      wrap.appendChild(v == null ? el('div', 'hole') : pegEl(v));
    }
  });
  return wrap;
}

/* A row's feedback is two counts: black pegs (right peg, right slot) and white
   pegs (right peg, wrong slot). The two spinners clamp against each other, since
   a row can never hold more key pegs than the code has slots. */
function keyBox(key, onChange) {
  const box = el('div', 'keys');
  const inputs = {};

  const sync = () => {
    inputs.exact.value = key.exact;
    inputs.close.value = key.close;
    inputs.exact.max = LEN - key.close;
    inputs.close.max = LEN - key.exact;
  };

  const build = kind => {
    const isExact = kind === 'exact';
    const lab = el('label', 'keyin');
    lab.title = isExact ? 'Black pegs — right peg, right slot' : 'White pegs — right peg, wrong slot';
    lab.appendChild(el('i', 'k2 ' + (isExact ? 'filled' : 'ring')));

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'keynum';
    input.min = '0';
    input.step = '1';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', isExact
      ? 'Black key pegs — right peg, right slot'
      : 'White key pegs — right peg, wrong slot');
    input.addEventListener('change', () => {
      const other = isExact ? 'close' : 'exact';
      key[kind] = clamp(Math.round(Number(input.value)) || 0, [0, LEN - key[other]]);
      sync();
      onChange();
    });

    inputs[kind] = input;
    lab.appendChild(input);
    lab.appendChild(el('span', 'keylbl', isExact ? 'black' : 'white'));
    return lab;
  };

  box.appendChild(build('exact'));
  box.appendChild(build('close'));
  sync();
  return box;
}

// A function declaration, not a const: the state literal below is built before this point.
function emptyKey() { return { exact: 0, close: 0 }; }

/* Accepts the per-peg array older boards were saved with. */
function normKey(k) {
  const c = Array.isArray(k) ? keyCounts(k) : k || {};
  const exact = clamp(Math.round(Number(c.exact)) || 0, [0, LEN]);
  return { exact, close: clamp(Math.round(Number(c.close)) || 0, [0, LEN - exact]) };
}

function keyError(key) {
  if (key.exact === LEN - 1 && key.close === 1) {
    return (LEN - 1) + ' black and one white is impossible — one misplaced peg has nowhere else to go.';
  }
  return '';
}

function renderRows() {
  const rows = $('rows');
  rows.innerHTML = '';

  state.guesses.forEach((g, gi) => {
    const row = el('div', 'row' + (g.key.exact === LEN ? ' solved' : ''));
    row.appendChild(el('div', 'idx', String(gi + 1)));
    row.appendChild(codeStrip(g.code));
    // Edited in place rather than re-rendered, so the spinner keeps focus.
    row.appendChild(keyBox(g.key, () => {
      row.classList.toggle('solved', g.key.exact === LEN);
      $('err').textContent = keyError(g.key);
      save(); renderWon(); solve();
    }));
    const del = el('button', 'del', '×');
    del.type = 'button';
    del.title = 'Remove this row';
    del.setAttribute('aria-label', 'Remove guess ' + (gi + 1));
    del.addEventListener('click', () => {
      state.guesses.splice(gi, 1);
      save(); renderRows(); solve();
    });
    row.appendChild(del);
    rows.appendChild(row);
  });

  const d = state.draft;
  const row = el('div', 'row draft');
  row.appendChild(el('div', 'idx', String(state.guesses.length + 1)));
  row.appendChild(codeStrip(d.code, { slots: true, selected: state.sel }));
  row.appendChild(keyBox(d.key, () => { $('err').textContent = ''; }));
  const saveBtn = el('button', 'btn primary save', 'Save');
  saveBtn.type = 'button';
  saveBtn.id = 'saveGuess';
  saveBtn.title = 'Record this guess';
  saveBtn.setAttribute('aria-label', 'Save guess ' + (state.guesses.length + 1));
  saveBtn.disabled = state.solving;
  saveBtn.addEventListener('click', addGuess);
  row.appendChild(saveBtn);
  rows.appendChild(row);

  const n = state.guesses.length;
  $('rowCount').textContent = n === 0 ? 'no guesses yet' : n + (n === 1 ? ' guess' : ' guesses') + ' recorded';
}

function renderField(codes, animateIn) {
  const f = $('field');
  f.innerHTML = '';
  f.style.setProperty('--candw', (LEN * 8 + 10) + 'px');
  state.fieldCodes = codes.slice(0, FIELD_MAX);

  if (!codes.length) {
    const box = el('div', 'field-empty');
    box.appendChild(el('b', null, state.guesses.length ? 'Nothing found.' : 'Every code is still possible.'));
    // Sampling can come up empty on a big board even when a code does fit, so the
    // copy stops short of calling the rows wrong.
    box.appendChild(el('div', null, state.guesses.length
      ? 'Either the rows disagree — check the counts, one is probably off by a peg — or the search came up empty, which gets likelier as the code gets longer. Raising the pool size or removing a row makes it try again.'
      : 'Add a guess and its key pegs to start cutting the field down.'));
    f.appendChild(box);
    return;
  }

  state.fieldCodes.forEach((code, idx) => {
    const strip = el('div', 'cand' + (animateIn ? ' in' : ''));
    if (animateIn) strip.style.animationDelay = Math.min(idx * 1.4, 260) + 'ms';
    code.forEach(v => { const dot = el('i'); dot.style.background = PALETTE[v]; strip.appendChild(dot); });
    f.appendChild(strip);
  });
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  $('sPool').textContent = fmt(s.pool);
  $('sRate').textContent = s.attempts
    ? (s.accepted ? '1 in ' + fmt(s.attempts / s.accepted) : '< 1 in ' + fmt(s.attempts / 3))
    : '—';
  $('sLeft').innerHTML = s.exhaustive
    ? fmt(s.pool) + ' <small>exact</small>'
    : s.accepted
      ? '~' + fmt(s.estLeft) + ' <small>est.</small>'
      // Nothing survived random sampling: bound it below by what guided search
      // dug up, above by the 95% rule-of-three ceiling.
      : fmt(s.pool) + '–' + fmt(s.estLeft) + ' <small>range</small>';

  const note = state.guesses.length === 0
    ? 'every code is still possible'
    : (s.exhaustive ? 'complete set of survivors' : 'sample of the survivors');
  $('fieldNote').textContent = note;

  let m = '';
  if (s.attempts) {
    m += 'Threw <b>' + fmt(s.attempts) + '</b> random codes, kept <b>' + fmt(s.acceptedDistinct) + '</b>.';
  }
  if (s.carried) {
    m += (m ? '<br>' : '') + 'Carried <b>' + fmt(s.carried) + '</b> code' + (s.carried === 1 ? '' : 's') +
      ' over from the last pool — they still fit every row.';
  }
  if (s.repaired) {
    m += (m ? '<br>' : '') + 'Random sampling starved, so <b>' + fmt(s.repaired) + '</b> more ' +
      (s.repaired === 1 ? 'was' : 'were') +
      ' found by guided search — still consistent, but no longer a uniform sample.';
  }
  if (s.exhaustive) {
    m += (m ? '<br>' : '') + 'No new codes turned up after that. This is almost certainly the whole remaining set.';
  }
  $('method').innerHTML = m;
}

function renderSuggestion() {
  const box = $('sugg'), code = $('suggCode'), why = $('suggWhy');
  code.innerHTML = '';
  if (!state.suggestion) {
    box.classList.add('empty');
    $('useSugg').disabled = true;
    why.textContent = state.pool.length ? 'Nothing suggested yet.' : 'No candidates to suggest from.';
    return;
  }
  box.classList.remove('empty');
  $('useSugg').disabled = false;
  code.appendChild(codeStrip(state.suggestion.code));
  why.textContent = state.suggestion.why;
}

function renderWon() {
  const box = $('wonBox');
  box.innerHTML = '';
  const last = state.guesses[state.guesses.length - 1];
  if (last && last.key.exact === LEN) {
    const w = el('div', 'won');
    w.appendChild(el('h3', null, 'Cracked it.'));
    w.appendChild(el('p', null, LEN + ' exact pegs on row ' + state.guesses.length + '. Clear the board to start another game.'));
    box.appendChild(w);
  }
}

/* ── the solver ──────────────────────────────────────────── */
function constraints() {
  return state.guesses.map(g => ({ code: g.code, target: packed(g.key.exact, g.key.close) }));
}

async function solve(animatedIn) {
  const run = ++state.run;
  const cons = constraints();
  // A tiny board can hold fewer codes than the pool asks for; without this the
  // sampler would spend its whole budget looking for codes that do not exist.
  const target = Math.min(state.poolSize, SPACE);
  const allowRepeats = state.allowRepeats || !canDistinct();
  const bar = $('bar'), fill = bar.firstElementChild;
  bar.classList.add('on');
  state.solving = true;
  setBusy(true);

  const scratch = new Uint8Array(LEN);
  const seen = new Set();
  const pool = [];
  let attempts = 0, accepted = 0, repaired = 0, carried = 0, exhaustive = false;

  // The last pool fits every row but, at most, the newest one — so its codes are
  // either survivors outright or near misses worth restarting from. Survivors are
  // held back until after the uniform phase so they cannot skew its acceptance
  // rate, which is what the estimate below is built on.
  const nearby = state.seeds.filter(c => c.length === LEN);
  const survivors = nearby.filter(c => consistent(c, cons));
  // Half the restarts start from a code that already fits, half from nothing.
  // Seeded restarts converge far more often; random ones keep the pool from
  // collapsing into one corner of the space, and both matter.
  const seedFor = () => {
    if (Math.random() < 0.5) return null;
    return pool.length ? pool[randInt(pool.length)]
      : nearby.length ? nearby[randInt(nearby.length)] : null;
  };

  const CAP = Math.max(500000, target * 400);
  const REJECT_MS = 900;
  const t0 = performance.now();

  while (pool.length < target && attempts < CAP && performance.now() - t0 < REJECT_MS) {
    const stop = attempts + 20000;
    while (attempts < stop && pool.length < target) {
      randomInto(scratch, allowRepeats);
      attempts++;
      if (consistent(scratch, cons)) {
        accepted++;
        const arr = Array.from(scratch);
        const k = arr.join(',');
        if (!seen.has(k)) { seen.add(k); pool.push(arr); }
      }
    }
    fill.style.width = Math.max(pool.length / target, attempts / CAP) * 100 + '%';
    await yieldUI();
    if (run !== state.run) return;                 // superseded by a newer solve
  }
  const acceptedDistinct = pool.length;

  for (const c of survivors) {
    if (pool.length >= target) break;
    const k = c.join(',');
    if (!seen.has(k)) { seen.add(k); pool.push(c); carried++; }
  }

  // Guided top-up when uniform sampling can no longer find survivors.
  if (pool.length < target && cons.length) {
    const t1 = performance.now();
    let stale = 0;
    while (pool.length < target && performance.now() - t1 < 1400 && stale < 600) {
      for (let b = 0; b < 12 && pool.length < target && performance.now() - t1 < 1400; b++) {
        if (hillClimb(scratch, cons, allowRepeats, seedFor())) {
          const arr = Array.from(scratch);
          const k = arr.join(',');
          if (!seen.has(k)) { seen.add(k); pool.push(arr); repaired++; stale = 0; continue; }
        }
        stale++;
      }
      fill.style.width = (pool.length / target) * 100 + '%';
      await yieldUI();
      if (run !== state.run) return;
    }
    if (stale >= 600 && pool.length) exhaustive = true;
  }

  state.pool = pool;
  // An empty pool keeps the old seeds: the search may simply have come up short,
  // and starting the next attempt from nothing would guarantee it does again.
  if (pool.length) state.seeds = pool;
  state.stats = {
    pool: pool.length,
    attempts,
    accepted,
    acceptedDistinct,
    repaired,
    carried,
    exhaustive,
    estLeft: accepted ? (accepted / attempts) * SPACE : (3 / Math.max(attempts, 1)) * SPACE
  };

  bar.classList.remove('on');
  fill.style.width = '0%';
  state.solving = false;
  setBusy(false);

  renderField(shuffled(pool).slice(0, FIELD_MAX), animatedIn !== false);
  renderStats();

  state.suggestion = null;
  renderSuggestion();
}

function setBusy(on) {
  $('suggest').disabled = on;
  const save = $('saveGuess');
  if (save) save.disabled = on;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Pick a guess from the surviving pool. In "informative" mode, try a batch of
   candidates and keep the one that splits the pool into the smallest average
   remainder. */
function pickGuess() {
  const pool = state.pool;
  if (!pool.length) return null;
  if (pool.length === 1) {
    return { code: pool[0], why: 'Only one code survives every row. This is the answer.' };
  }
  if (!state.optimise) {
    return { code: pool[randInt(pool.length)], why: 'Drawn at random from the ' + fmt(pool.length) + ' surviving candidates.' };
  }

  const cand = shuffled(pool).slice(0, Math.min(80, pool.length));
  const test = shuffled(pool).slice(0, Math.min(400, pool.length));
  let best = null, bestExp = Infinity;
  const buckets = new Map();

  for (const g of cand) {
    buckets.clear();
    for (const t of test) {
      const s = scoreOf(t, g);
      buckets.set(s, (buckets.get(s) || 0) + 1);
    }
    let sum = 0;
    for (const v of buckets.values()) sum += v * v;
    const exp = sum / test.length;
    if (exp < bestExp) { bestExp = exp; best = g; }
  }

  const frac = bestExp / test.length;
  const left = Math.max(1, Math.round(frac * (state.stats && !state.stats.exhaustive && state.stats.accepted
    ? state.stats.estLeft : pool.length)));
  return {
    code: best,
    why: 'Best of ' + cand.length + ' candidates tried: expected to leave about ' +
      fmt(left) + ' code' + (left === 1 ? '' : 's') + ' standing (' + (frac * 100).toFixed(1) + '% of the field).'
  };
}

/* ── entry ───────────────────────────────────────────────── */
function placePeg(v) {
  state.draft.code[state.sel] = v;
  state.sel = Math.min(state.sel + 1, LEN - 1);
  syncTyped();
  renderRows();
  $('err').textContent = '';
}

/* Mirror the draft into the text field so pegs you click land there too. A plain number
   list can only spell out a filled prefix, so a code with a hole in it leaves the field blank. */
function syncTyped() {
  const code = state.draft.code;
  let n = 0;
  while (n < LEN && code[n] != null) n++;
  const holed = code.slice(n).some(c => c != null);
  $('typed').value = holed ? '' : code.slice(0, n).join(' ');
}

function clearDraft() {
  state.draft.code = Array(LEN).fill(null);
  state.draft.key = emptyKey();
  state.sel = 0;
  $('typed').value = '';
  $('err').textContent = '';
  renderRows();
}

async function addGuess() {
  const d = state.draft;
  const err = $('err');
  if (d.code.some(c => c == null)) {
    err.textContent = 'Fill all ' + LEN + ' slots before adding the guess.';
    return;
  }
  const bad = keyError(d.key);
  if (bad) { err.textContent = bad; return; }
  err.textContent = '';

  const guess = { code: d.code.slice(), key: { ...d.key } };
  await cullField(guess);

  state.guesses.push(guess);
  clearDraft();
  save();
  renderRows();
  renderWon();
  await solve();
}

/* Fade out the strips that this guess rules out, before resampling. */
function cullField(guess) {
  const target = packed(guess.key.exact, guess.key.close);
  const strips = $('field').querySelectorAll('.cand');
  if (!strips.length) return Promise.resolve();
  let culled = 0;
  strips.forEach((node, i) => {
    const code = state.fieldCodes[i];
    if (!code) return;
    if (scoreOf(code, guess.code) !== target) { node.classList.add('out'); culled++; }
  });
  if (!culled) return Promise.resolve();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return new Promise(r => setTimeout(r, reduced ? 0 : 420));
}

function parseTyped(raw) {
  const parts = raw.trim().split(/[^0-9]+/).filter(s => s.length);
  if (!parts.length) return { code: Array(LEN).fill(null) };
  if (parts.length > LEN) return { error: 'That is ' + parts.length + ' pegs. The code is ' + LEN + '.' };
  const code = Array(LEN).fill(null);
  for (let i = 0; i < parts.length; i++) {
    const n = parseInt(parts[i], 10);
    if (n < 0 || n > NCOL - 1) return { error: 'Peg ' + n + ' is out of range. Use 0 to ' + (NCOL - 1) + '.' };
    code[i] = n;
  }
  return { code, filled: parts.length };
}

/* ── text size ───────────────────────────────────────────── */
const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];

function applyScale() {
  const root = document.documentElement;
  root.style.setProperty('--scale', state.scale);
  $('zoomVal').textContent = Math.round(state.scale * 100) + '%';
  $('zoomOut').disabled = state.scale <= SCALES[0];
  $('zoomIn').disabled = state.scale >= SCALES[SCALES.length - 1];
  syncWidth();
}

// Zoom rescales the layout but not the viewport, so the breakpoints work off the
// width the page actually gets to lay out in.
function syncWidth() {
  const w = window.innerWidth / state.scale;
  document.documentElement.dataset.w = w <= 560 ? 'sm' : w <= 960 ? 'md' : 'lg';
}

function stepScale(dir) {
  const i = SCALES.indexOf(state.scale);
  const next = SCALES[Math.min(Math.max((i < 0 ? SCALES.indexOf(1) : i) + dir, 0), SCALES.length - 1)];
  if (next === state.scale) return;
  state.scale = next;
  applyScale();
  save();
}

/* ── persistence ─────────────────────────────────────────── */
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      len: LEN,
      ncol: NCOL,
      guesses: state.guesses,
      poolSize: state.poolSize,
      allowRepeats: state.allowRepeats,
      optimise: state.optimise,
      scale: state.scale
    }));
  } catch (e) { /* private mode — board just won't persist */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.len || d.ncol) configure(d.len || LEN, d.ncol || NCOL);
    if (Array.isArray(d.guesses)) {
      state.guesses = d.guesses
        .filter(g => g && Array.isArray(g.code) && g.code.length === LEN &&
          g.code.every(v => Number.isInteger(v) && v >= 0 && v < NCOL))
        .map(g => ({ code: g.code, key: normKey(g.key) }));
    }
    if (d.poolSize) state.poolSize = d.poolSize;
    if (typeof d.allowRepeats === 'boolean') state.allowRepeats = d.allowRepeats;
    if (typeof d.optimise === 'boolean') state.optimise = d.optimise;
    if (SCALES.includes(d.scale)) state.scale = d.scale;
  } catch (e) { /* ignore a corrupt board */ }
}

/* ── board size ──────────────────────────────────────────── */
function renderSpec() {
  $('chipSpace').textContent = fmt(SPACE);
  $('codeLen').value = LEN;
  $('numPegs').value = NCOL;
  const range = $('pegRange');
  range.textContent = '0–' + (NCOL - 1);
  range.parentElement.title = 'Pegs are numbered 0 to ' + (NCOL - 1) + '.';

  // Distinct pegs need at least as many pegs as slots.
  const box = $('repeats');
  box.disabled = !canDistinct();
  box.checked = state.allowRepeats || !canDistinct();
  box.parentElement.title = canDistinct() ? '' :
    'A ' + LEN + '-slot code cannot avoid repeats with only ' + NCOL + ' pegs.';

  const sample = [];
  for (let i = 0; i < LEN; i++) sample.push(randInt(NCOL));
  $('typed').placeholder = 'e.g. ' + sample.join(' ');
}

/* Resize the board. Recorded guesses belong to the old size, so they go. */
function applyConfig(len, ncol) {
  if (len === LEN && ncol === NCOL) return;
  configure(len, ncol);
  state.guesses = [];
  state.draft = { code: Array(LEN).fill(null), key: emptyKey() };
  state.sel = 0;
  state.suggestion = null;
  state.pool = [];
  state.seeds = [];
  state.fieldCodes = [];
  $('typed').value = '';
  $('err').textContent = '';
  renderSpec();
  renderRail();
  renderPalette();
  renderRows();
  renderWon();
  renderSuggestion();
  save();
  solve();
}

/* ── wiring ──────────────────────────────────────────────── */
function init() {
  load();
  // load() may have resized the board, and the draft row was built for the default.
  state.draft = { code: Array(LEN).fill(null), key: emptyKey() };

  renderSpec();
  $('poolSize').value = state.poolSize;
  $('optimise').checked = state.optimise;

  applyScale();
  window.addEventListener('resize', syncWidth);

  $('zoomIn').addEventListener('click', () => stepScale(1));
  $('zoomOut').addEventListener('click', () => stepScale(-1));

  renderRail();
  renderPalette();
  renderRows();
  renderWon();

  $('clearDraft').addEventListener('click', clearDraft);

  $('typed').addEventListener('input', e => {
    const r = parseTyped(e.target.value);
    if (r.error) { $('err').textContent = r.error; return; }
    $('err').textContent = '';
    state.draft.code = r.code;
    state.sel = Math.min(r.filled || 0, LEN - 1);
    renderRows();
  });
  $('typed').addEventListener('keydown', e => { if (e.key === 'Enter') addGuess(); });

  $('suggest').addEventListener('click', () => {
    state.suggestion = pickGuess();
    renderSuggestion();
  });
  $('useSugg').addEventListener('click', () => {
    if (!state.suggestion) return;
    state.draft.code = state.suggestion.code.slice();
    state.sel = 0;
    syncTyped();
    renderRows();
    $('typed').focus();
  });

  $('poolSize').addEventListener('change', e => {
    const n = Math.max(50, Math.min(20000, parseInt(e.target.value, 10) || 1000));
    e.target.value = n;
    state.poolSize = n;
    save(); solve();
  });
  $('codeLen').addEventListener('change', e => {
    const n = clamp(parseInt(e.target.value, 10) || LEN, LIMITS.len);
    e.target.value = n;
    applyConfig(n, NCOL);
  });
  $('numPegs').addEventListener('change', e => {
    const n = clamp(parseInt(e.target.value, 10) || NCOL, LIMITS.ncol);
    e.target.value = n;
    applyConfig(LEN, n);
  });
  $('repeats').addEventListener('change', e => { state.allowRepeats = e.target.checked; save(); solve(); });
  $('optimise').addEventListener('change', e => { state.optimise = e.target.checked; save(); });

  $('reset').addEventListener('click', () => {
    state.guesses = [];
    clearDraft();
    save();
    renderRows();
    renderWon();
    solve();
  });

  // Keyboard: digits fill the selected slot, arrows move, backspace clears.
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { stepScale(1); return; }
    if (e.key === '-' || e.key === '_') { stepScale(-1); return; }
    if (e.key === 'ArrowRight') { state.sel = Math.min(state.sel + 1, LEN - 1); renderRows(); }
    else if (e.key === 'ArrowLeft') { state.sel = Math.max(state.sel - 1, 0); renderRows(); }
    else if (e.key === 'Backspace') {
      e.preventDefault();
      state.draft.code[state.sel] = null;
      state.sel = Math.max(state.sel - 1, 0);
      syncTyped(); renderRows();
    } else if (/^[0-9]$/.test(e.key)) {
      // A second digit within 800ms rewrites the slot just filled: 1 then 2 → 12.
      const now = performance.now();
      const digit = parseInt(e.key, 10);
      const combined = typeBuf.value * 10 + digit;
      if (typeBuf.slot >= 0 && now - typeBuf.at < 800 && combined >= 10 && combined < NCOL) {
        state.draft.code[typeBuf.slot] = combined;
        typeBuf = { slot: -1, value: 0, at: 0 };
      } else {
        state.draft.code[state.sel] = digit;
        typeBuf = { slot: state.sel, value: digit, at: now };
        state.sel = Math.min(state.sel + 1, LEN - 1);
      }
      syncTyped(); renderRows();
    }
  });

  solve();
}

let typeBuf = { slot: -1, value: 0, at: 0 };

init();
