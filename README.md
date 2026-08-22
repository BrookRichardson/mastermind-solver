# Decoder — a Mastermind solver

A single web page that cracks 8-peg Mastermind codes drawn from 15 colours (pegs numbered 0–14).
Record the guesses you have already played and the key pegs you got back; the solver keeps a pool of
codes that are still possible and hands you the next guess.

Open `index.html` in a browser. No build, no server, no dependencies. The board is saved in
`localStorage`, so a game in progress survives a reload.

## Using it

1. **Enter a guess.** Click a slot then a peg, or type the numbers into the text field
   (`3 7 12 0 5 5 9 14`). Keyboard also works: digits fill the selected slot, arrows move, backspace clears.
2. **Enter the key pegs.** Click a key peg to cycle it: empty → filled (right peg, right slot) → hollow
   (right peg, wrong slot). Only the counts matter, not which key slot you use.
3. **Add guess.** The candidate field culls every code the new row rules out, then resamples.
4. **Suggest a guess** picks from the survivors and tells you how much of the field it expects to cut.
   **Use it** loads it into the entry row.

Got a key peg wrong? Click it on the recorded row to fix it, or remove the row with `×`. Either way the
pool is rebuilt immediately.

### Settings

- **Pool size** — how many candidate codes to keep (default 1000). Bigger means better guess selection
  and slower solves.
- **Code can repeat pegs** — turn off if your game's answer never repeats a colour. Sampling then draws
  from the 259,459,200 orderings of 8 distinct pegs instead of all 15⁸.
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
whole 2,562,890,625-code space.

**Guided repair.** Uniform sampling collapses fast. By the third or fourth guess fewer than one code in
a million survives, and the pool would come back nearly empty. When that happens the solver switches to
a hill-climb: start from a random code, and repeatedly change the single peg that most reduces the total
mismatch against your rows until it reaches zero. Those codes are still genuinely consistent, but they
are no longer a uniform sample — the stats panel says so whenever repair contributed.

**Estimating what's left.** With survivors from uniform sampling, `accepted / attempted × 15⁸`. With
none, the panel shows a range: the pool size as a floor, and the 95% rule-of-three ceiling
(`3 / attempted × 15⁸`) as the roof. If guided search stops finding anything new for 600 tries, the pool
is reported as the exact remaining set.

Typical result: 9–10 guesses to crack a code, with a 1000-code pool.

## Tests

```
node test-solver.js
```

Loads the solver core straight out of `decoder.js` (everything above the DOM section) and checks scoring
against known cases and for symmetry, checks that repaired codes really satisfy every constraint in both
repeat modes, then plays 20 full games — asserting on every turn that each pooled code is consistent
with every row, and that the game is solved inside 14 turns.

## Files

- `index.html` — markup
- `decoder.css` — styles
- `decoder.js` — solver and UI
- `test-solver.js` — headless checks
