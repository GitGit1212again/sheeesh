# sHeeSh

Words have relatives. Salary, salad and sausage all come from the Latin word for salt; solar doesn't. The game is telling which is which, faster than the others.

One to four people at one PC or phone. One HTML file; double-click it and pass the keyboard. Nothing leaves the machine. The playable file is `dist/sHeeSh.html`; a copy sits on the Desktop; the installable version is at https://gitgit1212again.github.io/sheeesh/ .

## Three ways to play

**Relatives.** A word comes up with where it came from (SALT: Latin *sal*). Each player in turn takes the clock and types every word they think shares the root, Enter after each; the others look away. The file judges on the spot: a relative chimes and pays +1, a miss costs nothing, the card word with an ending stuck on it (salty, saltiness) is not a relative. When everyone has had the word the file opens: the whole family, who found what, and the false friends that look related and aren't (solar). A relative nobody else found pays +1 more.

**Related or not.** Two words. Same family or not? One button each. Right +2, wrong −1, out of time 0, and then the file says why.

**Why it's called that.** A word and three origin stories. One is true; the other two are the kind of thing your uncle says. Right +2, wrong −1.

Most points after the last round wins. The file is a list someone typed and can be wrong. Nothing is filtered.

## The file

`src/families.js`: 58 words, each with its origin, a family of 3 to 30 real relatives (784 in all), and a few false friends with a one-line reason. `src/decoys.js`: two false origin stories per word. Roots lean towards philosophy, medicine, neuroscience, drugs and science.

## Look

Black, hot pink, violet and cyan neon. The clock is a lightsaber and hums. Cinzel for the words, Pirata One for headings, Share Tech Mono for labels, Cormorant Garamond for stories; all fall back to system fonts offline.

## Building

Portable Node lives at `C:	ools
ode` on this PC.

```bash
node build.js
```

writes `dist/sHeeSh.html` and `pwa/index.html`. `node --test test/` runs the tests. Deploy: copy `pwa/*` into `deploy/` (a clone of GitGit1212again/sheeesh) and push `main`.

## Layout

- `src/relatives.js` — the game: lobby, the three modes, hot-seat turns, verdicts, reveal, scores, sound.
- `src/match.js` — how a typed word is judged against a family (inflections, near forms, same-word rule).
- `src/families.js`, `src/decoys.js` — the file.
- `src/art.js` — engraved SVG plates and neon palettes per category.
- `src/style.css` + `src/theme.css` — layout, then the neon skin.
- `src/game.js`, `src/engine.js`, `src/cards*.js`, `src/scoring.js`, `src/parse.js` — the earlier chain-and-vote game, kept for reference; not built.
