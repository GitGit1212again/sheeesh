// sHeeSh: words have relatives, and the game is spotting them. Three ways to play it, one to four people at one screen.
//   relatives: a word and its origin come up; on the clock, type every word that shares the root.
//   pair:      two words; say whether they are family. The file says why.
//   why:       a word and three origin stories; pick the true one.
// The app judges from its file. Nobody votes.
const FAMILIES = require('./families');
const DECOYS = require('./decoys');
const { plateArt, paletteFor } = require('./art');
const { judgeWord, norm } = require('./match');

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const up = (s) => String(s ?? '').toUpperCase();
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
// Random numbers come from here so a room code can make every device deal the same game.
let random = Math.random;
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = (n) => Math.floor(random() * n);
const pick = (a) => a[rnd(a.length)];
const today = () => new Date().toISOString().slice(0, 10);
const DIFF = {
  easy: { name: 'Easy', blurb: 'Origin shown, one relative given, letter counts on the slots. Words from the easier end of the file.' },
  hard: { name: 'Hard', blurb: 'Origin shown, nothing else. All words, easy ones first.' },
  expert: { name: 'Expert', blurb: 'Just the word. No origin until the reveal. Starts on the hard words.' },
};
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const PLAYER_COLORS = ['#ff3fa4', '#35e3ff', '#ffd166', '#4dff88'];
const colorOf = (i) => PLAYER_COLORS[i % PLAYER_COLORS.length];
const HIT = 1; // a relative found
const ONLY = 1; // extra when nobody else found it
const RIGHT = 2; // pair / why: a right answer
const WRONG = 1; // pair / why: taken away for a wrong one
// the decks, in the order they appear in the picker
const DECKS = ['general', 'pharmacopoeia', 'mind', 'neuro', 'body', 'money'];
const MODES = {
  relatives: { name: 'Relatives', glyph: '⌘', blurb: 'A word and where it came from. Type every word that grew from the same root before the clock runs out.', seconds: [30, 45, 60, 90] },
  pair: { name: 'Related or not', glyph: '⚭', blurb: 'Two words. Are they family? One button each, then the file tells you why.', seconds: [10, 15, 20, 30] },
  why: { name: 'Why it\'s called that', glyph: '?', blurb: 'A word and three origin stories. One is true. The other two are the kind of thing your uncle says.', seconds: [15, 20, 30, 45] },
};

// ---------- prefs ----------
let prefs = { names: ['', '', '', ''], decks: ['', '', '', ''], count: 2, words: 8, seconds: { relatives: 45, pair: 15, why: 20 }, mode: 'relatives', difficulty: 'hard', room: '' };
try { const p = JSON.parse(localStorage.getItem('sheeesh.v3.prefs') || '{}'); if (typeof p.seconds !== 'object') delete p.seconds; if (!Array.isArray(p.decks)) delete p.decks; Object.assign(prefs, p); } catch (_) { /* fresh */ }
const savePrefs = () => { try { localStorage.setItem('sheeesh.v3.prefs', JSON.stringify(prefs)); } catch (_) { /* ignore */ } };
const secsFor = () => prefs.seconds[prefs.mode] || MODES[prefs.mode].seconds[1];

// ---------- state ----------
// phase: 'lobby' | 'pass' | 'turn' | 'verdict' (pair/why, one player) | 'reveal' (relatives, whole table) | 'final'
let S = null;
let deadline = null;
let started = 0;
let toastTimer = null;
let overlay = null; // 'rules' | null

// One sound only: the chime when a relative lands (and a right answer). Nothing else makes noise.
const SND = { ctx: null };
function audio() {
  if (!SND.ctx) { try { SND.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* none */ } }
  if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume().catch(() => {});
  return SND.ctx;
}
function beep(freq, dur) {
  const ctx = audio();
  if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, ctx.currentTime);
  g.gain.setValueAtTime(0.1, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur + 0.05);
}
const sfx = { hit() { beep(880, 0.12); setTimeout(() => beep(1318, 0.25), 90); }, miss() {}, dupe() {}, reveal() {} };

function toast(text, bad) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); document.body.appendChild(t); }
  t.className = `toast${bad ? ' bad' : ''}`; t.textContent = text;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
}

// ---------- items for the pair and why modes ----------
// A pair: the card word and one other word, half the time from its family, half the time a false friend
// or a word from some other family. The verdict text says which and why.
function makePair(card) {
  if (random() < 0.5) {
    const other = pick(card.family);
    return { card, other, related: true, why: `${up(other)} is family. ${card.origin}` };
  }
  if (card.friends.length && random() < (prefs.difficulty === 'expert' ? 0.9 : 0.6)) {
    const [other, note] = pick(card.friends);
    return { card, other, related: false, why: `${up(other)} looks the part and isn't: ${note}. ${up(card.word)} is ${card.origin}` };
  }
  let stranger;
  let tries = 0;
  do {
    stranger = pick(FAMILIES);
    tries += 1;
  } while ((stranger === card || stranger.family.some((f) => card.family.includes(f))) && tries < 20);
  const other = pick(stranger.family.concat([stranger.word]));
  return { card, other, related: false, why: `${up(other)} belongs to ${up(stranger.word)}: ${stranger.origin} ${up(card.word)} is ${card.origin}` };
}
function makeWhy(card) {
  const fakes = DECOYS[card.word] || [];
  const options = shuffle([{ text: card.origin, right: true }].concat(fakes.map((t) => ({ text: t, right: false }))));
  return { card, options };
}

// ---------- game flow ----------
function newGame() {
  deadline = null;
  S = { phase: 'lobby', mode: prefs.mode, players: [], deck: [], word: 0, card: null, item: null, turn: 0, plays: [], history: [], verdict: null };
  render();
}
function startGame() {
  S.mode = prefs.mode;
  S.difficulty = prefs.difficulty;
  S.room = (prefs.room || '').trim().toLowerCase();
  random = S.room ? seeded(`${S.room}|${S.mode}|${S.difficulty}|${prefs.words}`) : Math.random;
  S.players = Array.from({ length: prefs.count }, (_, i) => ({ id: i, name: (prefs.names[i] || '').trim() || `Player ${i + 1}`, deck: prefs.decks[i] || '', score: 0, best: null, right: 0, wrong: 0, rounds: [] }));
  // Each player has a favourite deck (or any). The ladder: shuffle within each level, then climb.
  // Easy leaves out the expert words; expert skips the easy ones.
  const levels = S.difficulty === 'easy' ? [1, 2] : S.difficulty === 'expert' ? [2, 3] : [1, 2, 3];
  const ladder = (cat) => [].concat(...levels.map((l) => shuffle(FAMILIES.filter((c) => c.level === l && (!cat || c.cat === cat)))));
  const pools = S.players.map((p) => ladder(p.deck));
  const any = ladder('');
  const used = new Set();
  // the next unused word from a player's deck, falling back to the whole file
  const draw = (i) => { const c = pools[i].find((x) => !used.has(x)) || any.find((x) => !used.has(x)) || any[0]; used.add(c); return c; };
  if (S.mode === 'relatives') {
    // words alternate between the players' decks, then the whole run is sorted easy to hard
    const cards = Array.from({ length: prefs.words }, (_, i) => draw(i % S.players.length));
    S.deck = cards.map((c, i) => ({ c, i })).sort((a, b) => a.c.level - b.c.level || a.i - b.i).map((x) => x.c);
  } else {
    // one item per player per round, from that player's own deck
    const cards = [];
    for (let r = 0; r < prefs.words; r++) for (let t = 0; t < S.players.length; t++) cards.push(draw(t));
    S.deck = cards.map((c) => (S.mode === 'pair' ? makePair(c) : makeWhy(c)));
  }
  S.word = 0;
  nextWord();
}
function nextWord() {
  S.turn = 0;
  if (S.mode === 'relatives') { S.card = S.deck[S.word]; S.plays = S.players.map(() => []); S.phase = 'pass'; render(); return; }
  loadItem();
  beginTurn();
}
// easy mode hands you one relative to start from
function starter(card) { return S.difficulty === 'easy' ? card.family[0] : null; }
function loadItem() {
  S.item = S.deck[S.word * S.players.length + S.turn];
  S.card = S.item.card;
  S.verdict = null;
}
function beginTurn() {
  S.phase = 'turn';
  started = Date.now();
  deadline = started + secsFor() * 1000;
  render();
  const inp = document.getElementById('guess');
  if (inp) inp.focus();
}
function submitGuess(raw) {
  if (S.phase !== 'turn') return;
  const list = S.plays[S.turn];
  const j = judgeWord(S.card, raw, list);
  if (!j) return;
  if (j.kind === 'hit' && j.hit === starter(S.card)) { j.kind = 'dupe'; j.note = 'that one was given'; }
  list.push(j);
  if (j.kind === 'hit') sfx.hit(); else if (j.kind === 'dupe' || j.kind === 'same') sfx.dupe(); else sfx.miss();
  renderGuesses();
}
// pair / why: the player answers (or the clock does). choice: true/false for pair, option index for why, null on timeout.
function answer(choice) {
  if (S.phase !== 'turn' || S.mode === 'relatives') return;
  deadline = null;
  const p = S.players[S.turn];
  const it = S.item;
  let right = null;
  if (choice !== null) right = S.mode === 'pair' ? choice === it.related : !!it.options[choice].right;
  const pts = right === null ? 0 : right ? RIGHT : -WRONG;
  p.score += pts; p.rounds.push(pts);
  if (right === true) p.right += 1; else if (right === false) p.wrong += 1;
  S.verdict = { choice, right, pts };
  if (right === true) sfx.hit(); else if (right === false) sfx.miss();
  S.phase = 'verdict';
  render();
}
function afterVerdict() {
  S.turn += 1;
  if (S.turn < S.players.length) { loadItem(); beginTurn(); return; }
  S.word += 1;
  if (S.word >= prefs.words) { S.phase = 'final'; render(); return; }
  nextWord();
}
function endTurn(timedOut) {
  if (S.phase !== 'turn') return;
  if (S.mode !== 'relatives') { answer(null); return; }
  deadline = null;
  S.turn += 1;
  if (S.turn < S.players.length) { S.phase = 'pass'; render(); return; }
  reveal();
}
function reveal() {
  const card = S.card;
  const found = card.family.map((f) => ({ f, by: S.players.filter((p) => S.plays[p.id].some((g) => g.kind === 'hit' && g.hit === f)).map((p) => p.id) }));
  const deltas = S.players.map((p) => {
    const hits = found.filter((x) => x.by.includes(p.id));
    const only = hits.filter((x) => x.by.length === 1);
    const pts = hits.length * HIT + only.length * ONLY;
    p.score += pts; p.rounds.push(pts);
    const longest = only.map((x) => x.f).sort((a, b) => b.length - a.length)[0];
    if (longest && (!p.best || longest.length > p.best.word.length)) p.best = { word: longest, of: card.word };
    return { id: p.id, name: p.name, hits: hits.length, only: only.length, pts };
  });
  S.history.push({ card, found, deltas, plays: S.plays });
  S.phase = 'reveal';
  sfx.reveal();
  render();
}
function afterReveal() {
  S.word += 1;
  if (S.word >= S.deck.length) { S.phase = 'final'; render(); return; }
  nextWord();
}
const totalRounds = () => (S.mode === 'relatives' ? S.deck.length : prefs.words);

// ---------- render ----------
function render() {
  if (!document.querySelector('header.top')) {
    app.innerHTML = `
      <svg width="0" height="0" style="position:absolute"><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.5"/></filter></svg>
      <header class="top">
        <div class="wordmark">sHeeSh</div>
        <div class="case" id="case"></div>
        <div class="timer" id="timer"><i></i></div>
        <div class="secs" id="secs"></div>
        <button class="btn ghost" id="rulesbtn" title="How to play">How to play</button>
        <button class="btn ghost" id="restartbtn" title="Back to the start">Restart game</button>
      </header>
      <main class="table">
        <section class="center">
          <div class="track" id="track"></div>
          <div class="plate-wrap" id="card"></div>
          <div class="stage" id="stage"></div>
        </section>
        <aside class="side">
          <div class="players" id="players"></div>
          <div class="players" id="howto"></div>
        </aside>
      </main>
      <div id="overlay"></div>`;
    document.getElementById('restartbtn').addEventListener('click', () => { overlay = null; newGame(); });
    document.getElementById('rulesbtn').addEventListener('click', () => { overlay = overlay === 'rules' ? null : 'rules'; renderOverlay(); });
  }
  renderHeader(); renderTrack(); renderCard(); renderStage(); renderPlayers(); renderHowto(); renderOverlay();
}
function renderHeader() {
  const c = document.getElementById('case');
  c.textContent = S.phase === 'lobby' ? '' : S.phase === 'final' ? 'Game over' : `${MODES[S.mode].name} · ${S.mode === 'relatives' ? 'word' : 'round'} ${S.word + 1} of ${totalRounds()} · level ${S.card ? S.card.level : ''}${S.room ? ` · room ${S.room}` : ''}`;
}
function renderTrack() {
  const el = document.getElementById('track');
  if (S.phase === 'lobby' || S.phase === 'final') { el.innerHTML = ''; return; }
  const done = (i) => i < S.turn || S.phase === 'reveal';
  el.innerHTML = `<div class="turns">${S.players.map((p, i) => `<span class="turn ${done(i) ? 'done' : i === S.turn ? 'now' : ''}" style="--pc:${colorOf(p.id)}"><i>${i + 1}</i>${esc(p.name)}</span>`).join('')}${S.mode === 'relatives' ? `<span class="turn ${S.phase === 'reveal' ? 'now' : ''}" style="--pc:#fff"><i>★</i>the file</span>` : ''}</div>`;
}
function tick() {
  const t = document.getElementById('timer'); const s = document.getElementById('secs');
  if (!t) return;
  if (!deadline) { t.firstChild.style.transform = 'scaleX(0)'; s.textContent = ''; t.classList.remove('urgent'); return; }
  const total = deadline - started; const left = Math.max(0, deadline - Date.now());
  t.firstChild.style.transform = `scaleX(${left / total})`;
  s.textContent = Math.ceil(left / 1000);
  t.classList.toggle('urgent', left < 10000); s.classList.toggle('urgent', left < 10000);
  if (left <= 0) endTurn(true);
}
setInterval(tick, 200);

const cardNo = (c) => String(1000 + FAMILIES.indexOf(c)).padStart(4, '0');
const barcode = () => `<span class="bar">${Array.from({ length: 22 }, () => `<i style="height:${6 + rnd(8)}px"></i>`).join('')}</span>`;
function plate({ cat, band, body, stamp, foot }) {
  const p = paletteFor(cat);
  return `<div class="plate" style="--ink:${p.ink};--band:${p.band};--paper:${p.paper}">
    <div class="plate-frame">
      <div class="plate-band"><span>${esc(p.name)}</span><span class="no">${esc(band)}</span></div>
      <div class="plate-left">${plateArt(cat)}<div class="plate-fig">fig. ${cat === 'misc' ? 'i' : cat.slice(0, 1)}</div></div>
      <div class="plate-body">${body}<div class="plate-foot"><span>${esc(foot || '')}</span>${barcode()}</div></div>
    </div>${stamp || ''}
  </div>`;
}
function renderCard() {
  const el = document.getElementById('card');
  const c = S.card;
  if (S.phase === 'lobby' || S.phase === 'final' || !c) {
    el.innerHTML = plate({ cat: 'misc', band: 'the file', body: `<div class="plate-word">sHeeSh</div><div class="plate-rule"></div><div class="plate-origin">Words have relatives. Salary, salad and sausage all come from the Latin word for salt; solar doesn't. The game is telling which is which. ${esc(MODES[prefs.mode].blurb)}</div>`, foot: S.phase === 'final' ? 'game over' : 'pick a way to play' });
    return;
  }
  const hidden = S.phase === 'pass';
  const who = S.players[S.turn];
  let body; let foot; let stamp = '';
  if (hidden) {
    body = `<div class="plate-word">· · ·</div><div class="plate-rule"></div><div class="plate-origin">Level ${c.level}. Sealed until ${esc(who.name)} presses go.</div>`;
    foot = 'pass the screen';
  } else if (S.mode === 'relatives') {
    const showOrigin = S.difficulty !== 'expert' || S.phase === 'reveal';
    body = `<div class="plate-word">${esc(up(c.word))}</div><div class="plate-rule"></div><div class="plate-origin">${showOrigin ? esc(c.origin) : 'Expert: the origin stays sealed until the reveal. Work from the word alone.'}</div>`;
    foot = `find the relatives of ${up(c.word)}`;
  } else if (S.mode === 'pair') {
    const v = S.verdict;
    body = `<div class="plate-word">${esc(up(c.word))}</div><div class="plate-word prev">${esc(up(S.item.other))}</div><div class="plate-rule"></div>
      <div class="plate-origin">${v ? esc(S.item.why) : 'Same family, or not? The file knows.'}</div>`;
    foot = v ? (S.item.related ? 'related' : 'not related') : 'related or not';
    if (v) stamp = `<div class="stamp ${v.right ? 'good' : 'bad'}">${v.right === null ? 'Clock' : v.right ? 'Right' : 'Wrong'}</div>`;
  } else {
    const v = S.verdict;
    body = `<div class="plate-word">${esc(up(c.word))}</div><div class="plate-rule"></div><div class="plate-origin">${v ? esc(c.origin) : 'Three stories on the table. One of them is the truth.'}</div>`;
    foot = v ? 'the true story' : 'why is it called that';
    if (v) stamp = `<div class="stamp ${v.right ? 'good' : 'bad'}">${v.right === null ? 'Clock' : v.right ? 'Right' : 'Wrong'}</div>`;
  }
  el.innerHTML = plate({ cat: c.cat, band: `word no. ${cardNo(c)}${S.mode === 'relatives' ? ` · ${c.family.length} relatives on file` : ''}`, body, foot, stamp });
}
function renderStage() {
  const el = document.getElementById('stage');
  if (S.phase === 'lobby') { renderLobby(el); return; }
  const p = S.players[S.turn];
  if (S.phase === 'turn' && S.mode === 'relatives') {
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">${esc(p.name)}, type the relatives of ${esc(up(S.card.word))}</h3>
      <form class="playform" id="gform"><input class="word" id="guess" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="a word, then Enter"><button class="btn blood" type="submit">Add</button><button class="btn ghost" type="button" id="donebtn">Done</button></form>
      <div class="slots" id="slots"></div>
      <div class="guesses" id="guesses"></div>`;
    document.getElementById('gform').addEventListener('submit', (e) => { e.preventDefault(); const i = document.getElementById('guess'); submitGuess(i.value); i.value = ''; i.focus(); });
    document.getElementById('donebtn').addEventListener('click', () => endTurn(false));
    renderGuesses();
    return;
  }
  if (S.phase === 'turn' && S.mode === 'pair') {
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">${esc(p.name)}: ${esc(up(S.card.word))} and ${esc(up(S.item.other))}</h3>
      <div class="choices"><button class="btn big choice yes" data-a="1">Same family</button><button class="btn big choice no" data-a="0">Not related</button></div>`;
    el.querySelector('.choices').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) answer(b.dataset.a === '1'); });
    return;
  }
  if (S.phase === 'turn' && S.mode === 'why') {
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">${esc(p.name)}: why is it called ${esc(up(S.card.word))}?</h3>
      <div class="stories">${S.item.options.map((o, i) => `<button class="story" data-a="${i}"><b>${'ABC'[i]}</b>${esc(o.text)}</button>`).join('')}</div>`;
    el.querySelector('.stories').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) answer(Number(b.dataset.a)); });
    return;
  }
  if (S.phase === 'verdict') {
    const v = S.verdict;
    const last = S.turn + 1 >= S.players.length && S.word + 1 >= prefs.words;
    let detail = '';
    if (S.mode === 'why') detail = `<div class="stories">${S.item.options.map((o, i) => `<div class="story ${o.right ? 'true' : ''} ${v.choice === i ? 'picked' : ''}"><b>${'ABC'[i]}</b>${esc(o.text)}${o.right ? '<i>true</i>' : v.choice === i ? '<i>your pick</i>' : ''}</div>`).join('')}</div>`;
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">${v.right === null ? 'Out of time.' : v.right ? `Right, ${esc(p.name)}.` : `No, ${esc(p.name)}.`} ${v.pts > 0 ? `+${v.pts}` : v.pts < 0 ? `−${-v.pts}` : '0'}</h3>${detail}
      <div class="row"><button class="btn blood big" id="nextbtn">${last ? 'Final scores' : S.turn + 1 < S.players.length ? `Pass to ${esc(S.players[S.turn + 1].name)}` : 'Next round'}</button></div>`;
    document.getElementById('nextbtn').addEventListener('click', afterVerdict);
    return;
  }
  if (S.phase === 'reveal') {
    const h = S.history[S.history.length - 1];
    const c = h.card;
    const chip = (x) => `<span class="fam ${x.by.length ? 'got' : 'none'}">${esc(x.f)}${x.by.map((id) => `<b style="background:${colorOf(id)}">${esc(initials(S.players[id].name))}</b>`).join('')}${x.by.length === 1 && S.players.length > 1 ? '<i>only</i>' : ''}</span>`;
    const misses = [];
    const seen = new Set();
    S.players.forEach((pl) => h.plays[pl.id].forEach((g) => { const k = `${pl.id}:${norm(g.word)}`; if (g.kind === 'miss' && !seen.has(k)) { seen.add(k); misses.push({ p: pl, g }); } }));
    const shown = misses.slice(0, 14);
    el.innerHTML = `<h3>The file on ${esc(up(c.word))}</h3>
      <div class="famlist">${h.found.map(chip).join('')}</div>
      ${c.friends.length ? `<div class="cousins"><b>False friends.</b> ${c.friends.map(([w, n]) => `<span class="ff"><em>${esc(w)}</em>: ${esc(n)}</span>`).join(' · ')}</div>` : ''}
      ${misses.length ? `<div class="cousins"><b>Thrown out.</b> ${shown.map(({ p: pl, g }) => `<span style="color:${colorOf(pl.id)}">${esc(g.word)}</span>${g.note ? ` (${esc(g.note)})` : ''}`).join(', ')}${misses.length > shown.length ? ` and ${misses.length - shown.length} more` : ''}. Not in the file. If one really is a relative, the file is wrong, not you.</div>` : ''}
      <div class="board">${h.deltas.slice().sort((a, b) => b.pts - a.pts).map((d) => `<div class="r"><span class="n"></span><span style="color:${colorOf(d.id)}">${esc(d.name)}<small>${d.hits} found${d.only ? ` · ${d.only} nobody else had` : ''}</small></span><span class="pts">+${d.pts}</span></div>`).join('')}</div>
      <div class="row"><button class="btn blood big" id="nextbtn">${S.word + 1 >= S.deck.length ? 'Final scores' : 'Next word'}</button></div>`;
    document.getElementById('nextbtn').addEventListener('click', afterReveal);
    return;
  }
  if (S.phase === 'final') {
    const sorted = S.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted[0].score;
    const winners = sorted.filter((q) => q.score === top);
    const line = (q) => (S.mode === 'relatives' ? (q.best ? `best find: ${esc(q.best.word)} from ${esc(q.best.of)}` : '') : `${q.right} right · ${q.wrong} wrong`);
    el.innerHTML = `<h3>${winners.length === 1 ? `${esc(winners[0].name)} wins` : `Tie: ${winners.map((w) => esc(w.name)).join(' and ')}`}</h3>
      <div class="board">${sorted.map((q, i) => `<div class="r${q.score === top ? ' win' : ''}"><span class="n">${i + 1}</span><span style="color:${colorOf(q.id)}">${esc(q.name)}<small>${line(q)}</small></span><span class="pts">${q.score}</span></div>`).join('')}</div>
      <div class="row"><button class="btn blood big" id="againbtn">Play again</button><button class="btn ghost" id="sharebtn">Copy result</button></div>
      <textarea class="share" id="sharetxt" readonly>${esc(shareText())}</textarea>`;
    document.getElementById('againbtn').addEventListener('click', newGame);
    document.getElementById('sharebtn').addEventListener('click', () => { const t = document.getElementById('sharetxt'); t.select(); const done = () => toast('Copied. Paste it in the channel.'); if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, () => { document.execCommand('copy'); done(); }); else { document.execCommand('copy'); done(); } });
    return;
  }
  el.innerHTML = '';
}
// One line per player for pasting into Discord: room, mode, level, score, and a square per round.
function shareText() {
  const sq = (n) => (n > 0 ? '🟩' : n < 0 ? '🟥' : '⬛');
  const where = S.room ? (S.room.startsWith('daily-') ? `daily ${S.room.slice(6)}` : `room ${S.room}`) : 'random deal';
  const head = `sHeeSh · ${where} · ${MODES[S.mode].name} · ${DIFF[S.difficulty].name}`;
  return [head].concat(S.players.map((p) => `${p.name}: ${p.score} ${p.rounds.map(sq).join('')}`)).concat([S.room ? 'https://gitgit1212again.github.io/sheeesh/' : '']).filter(Boolean).join('\n');
}
function renderLobby(el) {
  const m = MODES[prefs.mode];
  el.innerHTML = `<h3>How do you want it</h3>
    <div class="decks modes" id="modes">${Object.entries(MODES).map(([k, v]) => `<button type="button" class="deck${k === prefs.mode ? ' on' : ''}" data-mode="${k}"><span class="dart glyph">${v.glyph}</span><span class="dname">${esc(v.name)}</span></button>`).join('')}</div>
    <p class="muted" id="modeblurb">${esc(m.blurb)}</p>
    <div class="seg diff" id="diff">${Object.entries(DIFF).map(([k, v]) => `<button type="button" class="${k === prefs.difficulty ? 'on' : ''}" data-d="${k}">${v.name}</button>`).join('')}</div>
    <p class="muted">${esc(DIFF[prefs.difficulty].blurb)}</p>
    <div class="settings">
      <label>Players <select id="count">${[1, 2, 3, 4].map((n) => `<option value="${n}"${prefs.count === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>${prefs.mode === 'relatives' ? 'Words' : 'Rounds'} <select id="words">${[4, 6, 8, 10, 12].map((n) => `<option value="${n}"${prefs.words === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Seconds <select id="secs2">${m.seconds.map((n) => `<option value="${n}"${secsFor() === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="settings" id="names">${[0, 1, 2, 3].map((i) => `<label class="pname"${i >= prefs.count ? ' hidden' : ''}><span class="swatch" style="background:${colorOf(i)}"></span><input data-i="${i}" maxlength="18" placeholder="Player ${i + 1}" value="${esc(prefs.names[i] || '')}"><select class="fav" data-d="${i}" title="Favourite deck"><option value="">Any deck</option>${DECKS.map((d) => `<option value="${d}"${prefs.decks[i] === d ? ' selected' : ''}>${esc(paletteFor(d).name)}</option>`).join('')}</select></label>`).join('')}</div>
    <div class="settings room"><label>Room code <input id="room" maxlength="24" placeholder="none: random deal" value="${esc(prefs.room || '')}"></label><span class="muted">Friends who enter the same code get the same game on their own devices. Compare scores after.</span></div>
    <div class="row"><button class="btn blood big" id="startbtn">Deal</button><button class="btn ghost big" id="dailybtn">Today's daily</button></div>
    <p class="muted">${FAMILIES.length} words on file. Nothing is filtered, nothing leaves this machine.</p>`;
  const sync = () => { prefs.count = Number(document.getElementById('count').value); prefs.words = Number(document.getElementById('words').value); prefs.seconds[prefs.mode] = Number(document.getElementById('secs2').value); document.querySelectorAll('#names label').forEach((l, i) => { l.hidden = i >= prefs.count; }); savePrefs(); };
  ['count', 'words', 'secs2'].forEach((id) => document.getElementById(id).addEventListener('change', sync));
  document.getElementById('diff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; prefs.difficulty = b.dataset.d; savePrefs(); render(); });
  document.getElementById('room').addEventListener('input', (e) => { prefs.room = e.target.value; savePrefs(); });
  document.getElementById('dailybtn').addEventListener('click', () => { sync(); prefs.room = `daily-${today()}`; prefs.words = 5; savePrefs(); audio(); startGame(); });
  document.getElementById('modes').addEventListener('click', (e) => { const b = e.target.closest('button.deck'); if (!b) return; prefs.mode = b.dataset.mode; savePrefs(); render(); });
  document.getElementById('names').addEventListener('input', (e) => { if (e.target.dataset.i != null) { prefs.names[Number(e.target.dataset.i)] = e.target.value; savePrefs(); } });
  document.getElementById('names').addEventListener('change', (e) => { if (e.target.dataset.d != null) { prefs.decks[Number(e.target.dataset.d)] = e.target.value; savePrefs(); } });
  document.getElementById('startbtn').addEventListener('click', () => { sync(); audio(); startGame(); });
}
// The family as slots that fill in. Easy shows letter counts in file order; otherwise the slots are blank
// and fill in the order you find them.
function renderGuesses() {
  const el = document.getElementById('guesses');
  const sl = document.getElementById('slots');
  if (!el || !sl) return;
  const list = S.plays[S.turn];
  const hits = list.filter((g) => g.kind === 'hit');
  const fam = S.card.family;
  const given = starter(S.card);
  let slots;
  if (S.difficulty === 'easy') {
    slots = fam.map((f) => { const h = hits.find((g) => g.hit === f); return h ? `<span class="slot got">${esc(f)}</span>` : f === given ? `<span class="slot given">${esc(f)}</span>` : `<span class="slot"><i>${f.length}</i></span>`; });
  } else {
    slots = hits.map((g) => `<span class="slot got">${esc(g.hit)}</span>`).concat(Array.from({ length: Math.max(0, fam.length - hits.length) }, () => '<span class="slot"></span>'));
  }
  sl.innerHTML = `<div class="gcount">${hits.length} of ${fam.length - (given ? 1 : 0)} found${given ? ` · ${esc(given)} is given` : ''}</div>${slots.join('')}`;
  const rest = list.filter((g) => g.kind !== 'hit').slice(-8).reverse();
  el.innerHTML = rest.map((g) => `<span class="g ${g.kind}">${esc(g.word)}${g.note ? `<small>${esc(g.note)}</small>` : ''}</span>`).join('');
}
function renderPlayers() {
  const el = document.getElementById('players');
  if (S.phase === 'lobby') { el.innerHTML = ''; return; }
  const cur = ['turn', 'pass', 'verdict'].includes(S.phase) ? S.turn : -1;
  el.innerHTML = `<h3>Scores</h3>` + S.players.slice().sort((a, b) => b.score - a.score).map((p) => `
    <div class="player${p.id === cur ? ' current' : ''}">
      <div class="av" style="color:${colorOf(p.id)};border-color:${colorOf(p.id)}">${esc(initials(p.name))}</div>
      <div class="nm">${esc(p.name)}${p.id === cur ? '<span class="you">up now</span>' : ''}</div>
      <div class="sc">${p.score}</div>
    </div>`).join('');
}
function renderHowto() {
  const mode = S.phase === 'lobby' ? prefs.mode : S.mode;
  const rows = mode === 'relatives' ? [
    ['#4dff88', 'Relative', `+${HIT}`, 'A word on the file that shares the root.'],
    ['#ffd166', 'Only you', `+${ONLY}`, 'Nobody else found it. Paid at the reveal.'],
    ['#777', 'Miss', '0', 'No penalty. Guess freely.'],
    ['#777', 'Same word', '0', 'The card word with an ending on it doesn\'t count.'],
  ] : [
    ['#4dff88', 'Right', `+${RIGHT}`, mode === 'pair' ? 'You called the pair correctly.' : 'You picked the true story.'],
    ['#ff3fa4', 'Wrong', `−${WRONG}`, 'Guessing costs. Random guessing breaks even.'],
    ['#777', 'Clock', '0', 'Ran out of time. Nothing gained, nothing lost.'],
  ];
  document.getElementById('howto').innerHTML = `<h3>How to score</h3><div class="how">${rows.map(([c, t, pts, s]) => `<div class="howrow"><span class="dot" style="background:${c}"></span><b>${t}</b><span class="pts">${pts}</span><small>${s}</small></div>`).join('')}</div>`;
}
function renderOverlay() {
  const el = document.getElementById('overlay');
  if (S.phase === 'pass') {
    const p = S.players[S.turn];
    el.innerHTML = `<div class="overlay pass" id="ov"><div class="sheet passsheet" style="--pc:${colorOf(p.id)}">
      <div class="passlbl">${S.turn === 0 ? `${S.mode === 'relatives' ? 'Word' : 'Round'} ${S.word + 1} of ${totalRounds()}. ` : ''}Pass the screen to</div>
      <h2 style="color:${colorOf(p.id)};text-shadow:0 0 14px ${colorOf(p.id)}">${esc(p.name)}</h2>
      <div class="sub">${S.players.length > 1 ? 'Everyone else, look away. ' : ''}You get ${secsFor()} seconds from the moment you press go.</div>
      <div class="row"><button class="btn big pc" id="readybtn">I'm ${esc(p.name)}, go</button></div>
    </div></div>`;
    document.getElementById('readybtn').addEventListener('click', () => { audio(); beginTurn(); });
    return;
  }
  if (overlay === 'rules') {
    el.innerHTML = `<div class="overlay" id="ov"><div class="sheet">
      <h2>How to play</h2>
      <div class="rules">
        <p><b>Words have relatives.</b> Salary, salad, sauce, sausage and salsa all come from <i>sal</i>, the Latin word for salt. Solar doesn't; it only looks like it does. The game is telling which words are real relatives and which just look the part.</p>
        <p><b>Relatives.</b> A word comes up with where it came from. Each player in turn takes the clock and types every word they think shares the root, Enter after each; the others look away. The file judges on the spot: a relative chimes and pays +${HIT}, a miss costs nothing, the card word with an ending stuck on it is not a relative. When everyone has had the word, the file opens: the whole family, who found what, the false friends. A relative nobody else found pays +${ONLY} more.</p>
        <p><b>Related or not.</b> Two words. Same family or not? Right +${RIGHT}, wrong −${WRONG}, and then the file says why.</p>
        <p><b>Why it's called that.</b> A word and three origin stories. One is true. Right +${RIGHT}, wrong −${WRONG}.</p>
        <p><b>Easy, hard, expert.</b> Easy shows the origin, gives you one relative and letter counts, and leaves out the nastiest words. Hard shows the origin only. Expert shows just the word. Every game climbs from easier words to harder ones.</p>
        <p><b>With friends elsewhere.</b> Enter the same room code on each device and you all get the same game. Or press Today's daily. Copy the result at the end and paste it in the channel.</p>
        <p><b>Most points after the last round wins.</b> The file is a list someone typed. It can be wrong. Argue with it over a drink, not in the game.</p>
      </div>
      <div class="row"><button class="btn blood" id="ovclose">Close</button></div>
    </div></div>`;
    document.getElementById('ovclose').addEventListener('click', () => { overlay = null; renderOverlay(); });
    return;
  }
  el.innerHTML = '';
}

newGame();
