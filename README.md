# Decoder — a Mastermind solver

A single web page ([Link To Live Page](https://brookrichardson.github.io/mastermind-solver/)) that
cracks Mastermind codes. The board defaults to an 8-slot code drawn from 15 pegs (numbered 0–14),
but both the code length and the number of pegs are settings — anything from 2 to 16 slots over 2
to 24 pegs. Record the guesses you have already played and the key pegs you got back; the solver
keeps a pool of codes that are still possible and hands you the next guess.

Open `index.html` in a browser. No build, no server, no dependencies. The board is saved in
`localStorage`, so a game in progress survives a reload.

## Using it

Decoder does not know your code — you play the game elsewhere and record what happened here.

1. **Get a guess.** **Suggest a guess** picks one from the surviving codes and says how much of the
   field it expects to cut; **Use it** loads it into the entry row. Or enter your own: click a slot then
   a peg, or type the numbers into the text field (`3 7 12 0 5 5 9 14`). Keyboard also works — digits
   fill the selected slot, arrows move, backspace clears. Peg numbers are only labels; match them to
   whatever colours your set uses.
2. **Play it in your game**, and count the key pegs it earned.
3. **Record those counts** in the two boxes on the row: **black** is a right peg in the right slot,
   **white** is a right peg in the wrong slot. The two clamp against each other, so they can never add
   up to more than the code length.
4. **Add guess.** The candidate field culls every code the new row rules out, then resamples.

Got a count wrong? Retype it on the recorded row, or remove the row with `×`. Either way the pool is
rebuilt immediately. Until the first row is recorded the field shows those steps instead of candidates,
because nothing has been ruled out yet.

### Settings

- **Code length** — how many slots the code has, 2 to 16 (default 8).
- **Pegs** — how many colours to draw from, 2 to 24 (default 15). The range beside the field shows how
  they are numbered, always from 0. The palette is picked to keep them as far apart as possible: up to
  15 they are hand-chosen colours, beyond that a generated wheel.
- Changing either one starts a fresh board — recorded rows belong to the size they were played at. The
  masthead chip tracks the search space the new size implies.
- **Pool size** — how many candidate codes to keep (default 1000). Bigger means better guess selection
  and slower solves.
- **Code can repeat pegs** — turn off if your game's answer never repeats a colour. Sampling then draws
  from the orderings of distinct pegs instead of every code; at the default size that is 259,459,200
  orderings rather than all 15⁸. The option is unavailable when the code is longer than the peg set,
  since a code with more slots than pegs has to repeat one.
- **Pick the most informative guess** — off draws a survivor at random; on tries 80 survivors against
  400 others and keeps whichever splits the field smallest.
- **Text size** — the `−` / `+` buttons in the masthead scale the whole board between 80% and 160%
  (or press `-` and `+`). The setting sticks with the rest of the board.

## How it works

A guess is scored the standard way: **exact** = right peg in the right slot; **close** = right peg in the
wrong slot, counting each repeated colour only as many times as it actually appears in both codes. A
candidate is *consistent* if scoring it against every guess you played reproduces exactly the key pegs
you recorded.

**Uniform sampling.** The solver throws random codes at the constraints and keeps the ones that survive,
until the pool is full or it runs out of budget. This is the honest method: the survivors are a uniform
sample of what remains, so the acceptance rate estimates how many codes are still standing across the
whole space.

**Carry-over.** Codes from the previous pool that still fit every row — including the row you just added
— are kept rather than thrown away. They cost nothing to verify and they are the last thing to survive
once random sampling dries up.

**Guided repair.** Uniform sampling collapses fast. At the default size, by the third or fourth guess
fewer than one code in a million survives, and the pool would come back nearly empty. When that happens
the solver switches to a hill-climb: repeatedly change the single peg that most reduces the total
mismatch against your rows, until it reaches zero. Half of those climbs start from a random code and
half from a kicked copy of one that already fits — seeded restarts succeed far more often, random ones
keep the pool from collapsing into one corner of the space. Repaired codes are still genuinely
consistent, but they are no longer a uniform sample; the stats panel says so whenever repair contributed.

**Estimating what's left.** With survivors from uniform sampling, `accepted / attempted × search space`.
With none, the panel shows a range: the pool size as a floor, and the 95% rule-of-three ceiling
(`3 / attempted × search space`) as the roof. If guided search stops finding anything new for 600 tries,
the pool is reported as the exact remaining set.

Typical result at the default 8 slots over 15 pegs: 9–10 guesses to crack a code, with a 1000-code pool.

### Where it strains

Difficulty scales with the code length, not the peg count. Long codes eventually leave a remaining set
so small that neither random sampling nor guided repair finds it, and the pool comes back empty — the
page says so, and does not claim your rows are wrong, because they usually are not. In testing, codes up
to about 10 slots behave like the default; at 12 slots roughly half the games hit a dead end late on.
Removing a row or raising the pool size gives the search another go, and the solver keeps the last live
pool around to restart from rather than beginning again from nothing.

## Tests

```
node test-solver.js
```

Loads the solver core straight out of `decoder.js` (everything above the DOM section) and checks scoring
against known cases, then re-checks the general laws — symmetry, `exact + close ≤ code length`, unique
score packing, one distinct colour per peg — across eight board sizes from 2×2 to 16×24. It checks that
size limits clamp, that repaired codes really satisfy every constraint in both repeat modes and at
several sizes, and that a code longer than its peg set falls back to repeats. Then it plays full games
at six sizes through the same pipeline the page runs — asserting on every turn that each pooled code is
consistent with every row, and reporting how often the two longest boards starve.

## Files

- `index.html` — markup
- `decoder.css` — styles
- `decoder.js` — solver and UI
- `test-solver.js` — headless checks
