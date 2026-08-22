/* Decoder — Mastermind solver by consistency sampling.
   Code length 8, pegs numbered 0–14. */

const LEN = 8;
const NCOL = 15;
const SPACE = Math.pow(NCOL, LEN);          // 2,562,890,625
const FIELD_MAX = 320;                       // candidate strips drawn
const STORE_KEY = 'decoder.v1';

const PALETTE = [
  '#E23B3B', '#F2712C', '#F3B41B', '#DCE84B', '#8FCB3F',
  '#35A85B', '#2FBFA0', '#35B7E8', '#3D6FE0', '#6C4BE0',
  '#A64BD6', '#E45BB8', '#F09090', '#9C6B45', '#C9CBD6'
];

/* ── scoring ─────────────────────────────────────────────── */
// A result is packed as exact*16 + close.
const cntA = new Int32Array(NCOL);
const cntB = new Int32Array(NCOL);

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
  return exact * 16 + close;
}

const packed = (exact, close) => exact * 16 + close;
const unpack = p => [p >> 4, p & 15];

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
    total += Math.abs((s >> 4) - (t >> 4)) + Math.abs((s & 15) - (t & 15));
  }
  return total;
}

/* ── random codes ────────────────────────────────────────── */
const randInt = n => (Math.random() * n) | 0;

function randomInto(code, allowRepeats) {
  if (allowRepeats) {
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
const bag = new Uint8Array(NCOL);

/* Guided repair: hill-climb a random code until it satisfies every row.
   Used only when uniform sampling has starved. */
function hillClimb(code, cons, allowRepeats) {
  randomInto(code, allowRepeats);
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
  guesses: [],                                  // { code:[8], key:[8 of 0|1|2] }
  draft: { code: Array(LEN).fill(null), key: Array(LEN).fill(0) },
  sel: 0,
  poolSize: 1000,
  allowRepeats: true,
  optimise: true,
  pool: [],
  fieldCodes: [],
  stats: null,
  suggestion: null,
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

function relLum(hex) {
  const v = i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
}
const LIGHT_PEG = PALETTE.map(h => relLum(h) > 0.32);

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

function keyGrid(key, onCycle) {
  const box = el('div', 'keys');
  const grid = el('div', 'keygrid');
  key.forEach((k, i) => {
    const b = el('button', 'key' + (k === 1 ? ' exact' : k === 2 ? ' close' : ''));
    b.type = 'button';
    b.setAttribute('aria-label', 'Key peg ' + (i + 1) + ': ' + (k === 1 ? 'right peg, right slot' : k === 2 ? 'right peg, wrong slot' : 'empty'));
    b.addEventListener('click', () => onCycle(i));
    grid.appendChild(b);
  });
  const { exact, close } = keyCounts(key);
  const tally = el('div', 'tally');
  tally.innerHTML = '<b>' + exact + '</b> exact<br><b>' + close + '</b> close';
  box.appendChild(grid);
  box.appendChild(tally);
  return box;
}

function renderRows() {
  const rows = $('rows');
  rows.innerHTML = '';

  state.guesses.forEach((g, gi) => {
    const solved = keyCounts(g.key).exact === LEN;
    const row = el('div', 'row' + (solved ? ' solved' : ''));
    row.appendChild(el('div', 'idx', String(gi + 1)));
    row.appendChild(codeStrip(g.code));
    row.appendChild(keyGrid(g.key, i => {
      g.key[i] = (g.key[i] + 1) % 3;
      save(); renderRows(); solve();
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
  row.appendChild(keyGrid(d.key, i => { d.key[i] = (d.key[i] + 1) % 3; renderRows(); }));
  row.appendChild(el('div'));
  rows.appendChild(row);

  const n = state.guesses.length;
  $('rowCount').textContent = n === 0 ? 'no guesses yet' : n + (n === 1 ? ' guess' : ' guesses') + ' recorded';
}

function renderField(codes, animateIn) {
  const f = $('field');
  f.innerHTML = '';
  state.fieldCodes = codes.slice(0, FIELD_MAX);

  if (!codes.length) {
    const box = el('div', 'field-empty');
    box.appendChild(el('b', null, state.guesses.length ? 'Nothing fits.' : 'Every code is still possible.'));
    box.appendChild(el('div', null, state.guesses.length
      ? 'No code can produce all of those key pegs at once. Check the counts on each row — one of them is probably off by a peg.'
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
  if (last && keyCounts(last.key).exact === LEN) {
    const w = el('div', 'won');
    w.appendChild(el('h3', null, 'Cracked it.'));
    w.appendChild(el('p', null, 'Eight exact pegs on row ' + state.guesses.length + '. Clear the board to start another game.'));
    box.appendChild(w);
  }
}

/* ── the solver ──────────────────────────────────────────── */
function constraints() {
  return state.guesses.map(g => {
    const { exact, close } = keyCounts(g.key);
    return { code: g.code, target: packed(exact, close) };
  });
}

async function solve(animatedIn) {
  const run = ++state.run;
  const cons = constraints();
  const target = state.poolSize;
  const allowRepeats = state.allowRepeats;
  const bar = $('bar'), fill = bar.firstElementChild;
  bar.classList.add('on');
  state.solving = true;
  setBusy(true);

  const scratch = new Uint8Array(LEN);
  const seen = new Set();
  const pool = [];
  let attempts = 0, accepted = 0, repaired = 0, exhaustive = false;

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

  // Guided top-up when uniform sampling can no longer find survivors.
  if (pool.length < target && cons.length) {
    const t1 = performance.now();
    let stale = 0;
    while (pool.length < target && performance.now() - t1 < 1400 && stale < 600) {
      for (let b = 0; b < 12 && pool.length < target && performance.now() - t1 < 1400; b++) {
        if (hillClimb(scratch, cons, allowRepeats)) {
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
  state.stats = {
    pool: pool.length,
    attempts,
    accepted,
    acceptedDistinct,
    repaired,
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
  $('addGuess').disabled = on;
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

function syncTyped() {
  $('typed').value = state.draft.code.every(c => c != null) ? state.draft.code.join(' ') : '';
}

function clearDraft() {
  state.draft.code = Array(LEN).fill(null);
  state.draft.key = Array(LEN).fill(0);
  state.sel = 0;
  $('typed').value = '';
  $('err').textContent = '';
  renderRows();
}

async function addGuess() {
  const d = state.draft;
  const err = $('err');
  if (d.code.some(c => c == null)) {
    err.textContent = 'Fill all eight slots before adding the guess.';
    return;
  }
  const { exact, close } = keyCounts(d.key);
  if (exact === LEN - 1 && close === 1) {
    err.textContent = 'Seven exact and one close is impossible — one misplaced peg has nowhere else to go.';
    return;
  }
  err.textContent = '';

  const guess = { code: d.code.slice(), key: d.key.slice() };
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
  const c = keyCounts(guess.key);
  const target = packed(c.exact, c.close);
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

/* ── persistence ─────────────────────────────────────────── */
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      guesses: state.guesses,
      poolSize: state.poolSize,
      allowRepeats: state.allowRepeats,
      optimise: state.optimise
    }));
  } catch (e) { /* private mode — board just won't persist */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.guesses)) {
      state.guesses = d.guesses.filter(g =>
        Array.isArray(g.code) && g.code.length === LEN &&
        g.code.every(v => Number.isInteger(v) && v >= 0 && v < NCOL) &&
        Array.isArray(g.key) && g.key.length === LEN);
    }
    if (d.poolSize) state.poolSize = d.poolSize;
    if (typeof d.allowRepeats === 'boolean') state.allowRepeats = d.allowRepeats;
    if (typeof d.optimise === 'boolean') state.optimise = d.optimise;
  } catch (e) { /* ignore a corrupt board */ }
}

/* ── wiring ──────────────────────────────────────────────── */
function init() {
  load();

  $('chipSpace').textContent = fmt(SPACE);
  $('poolSize').value = state.poolSize;
  $('repeats').checked = state.allowRepeats;
  $('optimise').checked = state.optimise;

  renderRail();
  renderPalette();
  renderRows();
  renderWon();

  $('addGuess').addEventListener('click', addGuess);
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
