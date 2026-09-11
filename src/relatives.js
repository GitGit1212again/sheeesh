// sHeeSh: words have relatives, and the game is spotting them. Three ways to play it, one to four people at one screen.
//   relatives: a word and its origin come up; on the clock, type every word that shares the root.
//   pair:      two words; say whether they are family. The file says why.
//   why:       a word and three origin stories; pick the true one.
// The app judges from its file. Nobody votes.
const FAMILIES = require('./families');
const DECOYS = require('./decoys');
const { plateArt, paletteFor } = require('./art');
const { judgeWord, norm } = require('./match');
const { Peer } = require('peerjs');

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
let prefs = { names: ['', '', '', ''], decks: ['', '', '', ''], count: 2, words: 8, seconds: { relatives: 45, pair: 15, why: 20 }, mode: 'relatives', difficulty: 'hard' };
try { const p = JSON.parse(localStorage.getItem('sheeesh.v3.prefs') || '{}'); if (typeof p.seconds !== 'object') delete p.seconds; if (!Array.isArray(p.decks)) delete p.decks; Object.assign(prefs, p); } catch (_) { /* fresh */ }
const savePrefs = () => { try { localStorage.setItem('sheeesh.v3.prefs', JSON.stringify(prefs)); } catch (_) { /* ignore */ } };
let recent = [];
try { recent = JSON.parse(localStorage.getItem('sheeesh.recent') || '[]'); if (!Array.isArray(recent)) recent = []; } catch (_) { recent = []; }
function remember(words) { recent = words.concat(recent.filter((w) => !words.includes(w))).slice(0, 80); try { localStorage.setItem('sheeesh.recent', JSON.stringify(recent)); } catch (_) { /* ignore */ } }
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
    return { card, other, related: true, why: `${up(other)} is family${card.notes[other] ? `: ${card.notes[other]}` : ''}. ${card.story}` };
  }
  if (card.friends.length && random() < ((S.difficulty || prefs.difficulty) === 'expert' ? 0.9 : 0.6)) {
    const [other, note] = pick(card.friends);
    return { card, other, related: false, why: `${up(other)} looks the part and isn't: ${note}. ${card.story}` };
  }
  let stranger;
  let tries = 0;
  do {
    stranger = pick(FAMILIES);
    tries += 1;
  } while ((stranger === card || stranger.family.some((f) => card.family.includes(f))) && tries < 20);
  const other = pick(stranger.family.concat([stranger.word]));
  return { card, other, related: false, why: `${up(other)} belongs to ${up(stranger.word)}, ${stranger.origin} ${card.story}` };
}
function makeWhy(card) {
  const fakes = DECOYS[card.word] || [];
  const options = shuffle([{ text: card.origin, right: true }].concat(fakes.map((t) => ({ text: t, right: false }))));
  return { card, options };
}

// ---------- game flow ----------
let lastGame = null; // the previous game's players and log, for the scoreboard after Play again
function newGame() {
  if (S && S.log && S.log.length) lastGame = { mode: S.mode, players: S.players, log: S.log, code: S.online ? S.online.code : '' };
  deadline = null;
  S = { phase: 'lobby', mode: prefs.mode, players: [], deck: [], word: 0, card: null, item: null, turn: 0, plays: [], history: [], verdict: null, log: [] };
  render();
}
function startGame() {
  S.mode = prefs.mode;
  S.difficulty = prefs.difficulty;
  random = S.room ? seeded(`${S.room}|${S.mode}|${S.difficulty}|${prefs.words}`) : Math.random;
  S.players = Array.from({ length: prefs.count }, (_, i) => newPlayer(i, prefs.names[i], prefs.decks[i]));
  S.deck = buildDeck(S.mode, S.difficulty, prefs.words, S.players);
  S.word = 0;
  nextWord();
}
const newPlayer = (i, name, deck) => ({ id: i, name: (name || '').trim() || `Player ${i + 1}`, deck: deck || '', score: 0, best: null, right: 0, wrong: 0, rounds: [], done: false, online: true });
// Each player has a favourite deck (or any). The ladder: shuffle within each level, then climb.
// Easy leaves out the expert words; expert skips the easy ones.
function buildDeck(mode, difficulty, words, players) {
  const levels = difficulty === 'easy' ? [1, 2] : difficulty === 'expert' ? [2, 3] : [1, 2, 3];
  // within each level the words you haven't seen lately come first, so a deck lasts many games before it repeats
  const unseen = (l, cat) => shuffle(FAMILIES.filter((c) => c.level === l && (!cat || c.cat === cat) && !recent.includes(c.word)));
  const seen = (l, cat) => shuffle(FAMILIES.filter((c) => c.level === l && (!cat || c.cat === cat) && recent.includes(c.word)));
  const ladder = (cat) => [].concat(...levels.map((l) => unseen(l, cat).concat(seen(l, cat))));
  const pools = players.map((p) => ladder(p.deck));
  const any = ladder('');
  const used = new Set();
  // the next unused word from a player's deck, falling back to the whole file
  const draw = (i) => { const c = pools[i].find((x) => !used.has(x)) || any.find((x) => !used.has(x)) || any[0]; used.add(c); return c; };
  if (mode === 'relatives') {
    // words alternate between the players' decks, then the whole run is sorted easy to hard
    const cards = Array.from({ length: words }, (_, i) => draw(i % players.length));
    remember(cards.map((c) => c.word));
    return cards.map((c, i) => ({ c, i })).sort((a, b) => a.c.level - b.c.level || a.i - b.i).map((x) => x.c);
  }
  // one item per player per round, from that player's own deck
  const cards = [];
  for (let r = 0; r < words; r++) for (let t = 0; t < players.length; t++) cards.push(draw(t));
  remember(cards.map((c) => c.word));
  return cards.map((c) => (mode === 'pair' ? makePair(c) : makeWhy(c)));
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
  S.verdict = { choice, right, pts };
  if (right === true) sfx.hit(); else if (right === false) sfx.miss();
  if (S.online) { S.phase = 'verdict'; S.done = true; sendResult({ round: S.online.round, choice, right, pts }); render(); return; }
  p.score += pts; p.rounds.push(pts);
  if (right === true) p.right += 1; else if (right === false) p.wrong += 1;
  S.log.push(logEntry(S.mode, S.word, p, it, choice, right, pts));
  S.phase = 'verdict';
  render();
}
// one line of the scoreboard page: what came up, what the player did, what it paid
function logEntry(mode, round, p, it, choice, right, pts) {
  return { round, id: p.id, name: p.name, word: it.card.word, other: mode === 'pair' ? it.other : (choice === null ? '' : `story ${'ABC'[choice]}`), truth: mode === 'pair' ? (it.related ? 'related' : 'not related') : `story ${'ABC'[it.options.findIndex((o) => o.right)]}`, right, pts };
}
function afterVerdict() {
  if (S.online) { if (net && net.role === 'host') hostNext(); return; }
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
  if (S.online) { S.phase = 'wait'; S.done = true; sendResult({ round: S.online.round, plays: S.plays[S.turn] }); render(); return; }
  S.turn += 1;
  if (S.turn < S.players.length) { S.phase = 'pass'; render(); return; }
  reveal();
}
// Who found what, and what it pays. Mutates the players' scores.
function tally(card, players, playsOf) {
  const found = card.family.map((f) => ({ f, by: players.filter((p) => (playsOf(p) || []).some((g) => g.kind === 'hit' && g.hit === f)).map((p) => p.id) }));
  const deltas = players.map((p) => {
    const hits = found.filter((x) => x.by.includes(p.id));
    const only = hits.filter((x) => x.by.length === 1);
    const pts = hits.length * HIT + only.length * ONLY;
    p.score += pts; p.rounds.push(pts);
    const longest = only.map((x) => x.f).sort((a, b) => b.length - a.length)[0];
    if (longest && (!p.best || longest.length > p.best.word.length)) p.best = { word: longest, of: card.word };
    return { id: p.id, name: p.name, hits: hits.length, only: only.length, pts };
  });
  return { found, deltas };
}
function reveal() {
  const card = S.card;
  const { found, deltas } = tally(card, S.players, (p) => S.plays[p.id]);
  S.history.push({ card, found, deltas, plays: S.plays });
  S.log.push({ round: S.word, word: card.word, found, deltas });
  S.phase = 'reveal';
  sfx.reveal();
  render();
}
function afterReveal() {
  if (S.online) { if (net && net.role === 'host') hostNext(); return; }
  S.word += 1;
  if (S.word >= S.deck.length) { S.phase = 'final'; render(); return; }
  nextWord();
}
const totalRounds = () => (S.online ? S.online.total : S.mode === 'relatives' ? S.deck.length : prefs.words);

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
        <button class="btn ghost" id="boardbtn" title="Scores and every word so far">Scoreboard</button>
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
    document.getElementById('restartbtn').addEventListener('click', () => { overlay = null; leaveRoom(); newGame(); });
    document.getElementById('boardbtn').addEventListener('click', () => { overlay = overlay === 'board' ? null : 'board'; renderOverlay(); });
    document.getElementById('rulesbtn').addEventListener('click', () => { overlay = overlay === 'rules' ? null : 'rules'; renderOverlay(); });
  }
  renderHeader(); renderTrack(); renderCard(); renderStage(); renderPlayers(); renderHowto(); renderOverlay();
}
function renderHeader() {
  const c = document.getElementById('case');
  c.textContent = S.phase === 'lobby' ? '' : S.phase === 'final' ? 'Game over' : S.phase === 'olobby' ? `Online · code ${S.online.code}` : `${S.online ? `Online ${S.online.code} · ` : ''}${MODES[S.mode].name} · ${S.mode === 'relatives' ? 'word' : 'round'} ${S.word + 1} of ${totalRounds()} · level ${S.card ? S.card.level : ''}${S.room && !S.online ? ` · ${S.room}` : ''}`;
}
function renderTrack() {
  const el = document.getElementById('track');
  if (S.phase === 'lobby' || S.phase === 'olobby' || S.phase === 'final') { el.innerHTML = ''; return; }
  const done = (i) => (S.online ? S.players[i].done || S.phase === 'reveal' : i < S.turn || S.phase === 'reveal');
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

const cardNo = (c) => String(1000 + FAMILIES.findIndex((x) => x.word === c.word)).padStart(4, '0');
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
  if (S.phase === 'lobby' || S.phase === 'olobby' || S.phase === 'final' || !c) {
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
  if (S.phase === 'olobby') { renderOnlineLobby(el); return; }
  const p = S.players[S.turn];
  const waiting = () => { const w = S.players.filter((q) => !q.done && q.online).map((q) => esc(q.name)); return w.length ? `Waiting for ${w.join(', ')}.` : (net && net.role === 'host' ? '' : `Waiting for ${esc(S.players[0].name)} to press Next.`); };
  if (S.phase === 'wait') {
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">Done, ${esc(p.name)}.</h3><div class="slots" id="slots"></div><div class="guesses" id="guesses"></div><p class="muted">${waiting()}</p>`;
    renderGuesses();
    return;
  }
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
    if (S.mode === 'why') detail = `<div class="story">${esc(S.card.story)}</div><div class="stories">${S.item.options.map((o, i) => `<div class="story ${o.right ? 'true' : ''} ${v.choice === i ? 'picked' : ''}"><b>${'ABC'[i]}</b>${esc(o.text)}${o.right ? '<i>true</i>' : v.choice === i ? '<i>your pick</i>' : ''}</div>`).join('')}</div>`;
    const allDone = S.online && S.online.phase === 'between';
    const btn = !S.online ? `<button class="btn blood big" id="nextbtn">${last ? 'Final scores' : S.turn + 1 < S.players.length ? `Pass to ${esc(S.players[S.turn + 1].name)}` : 'Next round'}</button>`
      : allDone && net && net.role === 'host' ? `<button class="btn blood big" id="nextbtn">${S.online.round + 1 >= S.online.total ? 'Final scores' : 'Next round'}</button>` : `<span class="muted">${waiting()}</span>`;
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">${v.right === null ? 'Out of time.' : v.right ? `Right, ${esc(p.name)}.` : `No, ${esc(p.name)}.`} ${v.pts > 0 ? `+${v.pts}` : v.pts < 0 ? `−${-v.pts}` : '0'}</h3>${detail}
      <div class="row">${btn}</div>`;
    const nb = document.getElementById('nextbtn'); if (nb) nb.addEventListener('click', afterVerdict);
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
    const notes = Object.entries(c.notes || {});
    el.innerHTML = `<h3>The file on ${esc(up(c.word))}</h3>
      <div class="story">${esc(c.story)}</div>
      <div class="famlist">${h.found.map(chip).join('')}</div>
      ${notes.length ? `<div class="cousins"><b>Why they belong.</b> ${notes.map(([w, n]) => `<span class="ff"><em>${esc(w)}</em>: ${esc(n)}</span>`).join(' · ')}</div>` : ''}
      ${c.friends.length ? `<div class="cousins"><b>False friends.</b> ${c.friends.map(([w, n]) => `<span class="ff"><em>${esc(w)}</em>: ${esc(n)}</span>`).join(' · ')}</div>` : ''}
      ${misses.length ? `<div class="cousins"><b>Thrown out.</b> ${shown.map(({ p: pl, g }) => `<span style="color:${colorOf(pl.id)}">${esc(g.word)}</span>${g.note ? ` (${esc(g.note)})` : ''}`).join(', ')}${misses.length > shown.length ? ` and ${misses.length - shown.length} more` : ''}. Not in the file. If one really is a relative, the file is wrong, not you.</div>` : ''}
      <div class="board">${h.deltas.slice().sort((a, b) => b.pts - a.pts).map((d) => `<div class="r"><span class="n"></span><span style="color:${colorOf(d.id)}">${esc(d.name)}<small>${d.hits} found${d.only ? ` · ${d.only} nobody else had` : ''}</small></span><span class="pts">+${d.pts}</span></div>`).join('')}</div>
      <div class="row">${!S.online || (net && net.role === 'host') ? `<button class="btn blood big" id="nextbtn">${S.word + 1 >= totalRounds() ? 'Final scores' : 'Next word'}</button>` : `<span class="muted">${waiting()}</span>`}</div>`;
    const nb = document.getElementById('nextbtn'); if (nb) nb.addEventListener('click', afterReveal);
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
    document.getElementById('againbtn').addEventListener('click', () => { leaveRoom(); newGame(); });
    document.getElementById('sharebtn').addEventListener('click', () => { const t = document.getElementById('sharetxt'); t.select(); const done = () => toast('Copied. Paste it in the channel.'); if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, () => { document.execCommand('copy'); done(); }); else { document.execCommand('copy'); done(); } });
    return;
  }
  el.innerHTML = '';
}
// One line per player for pasting into Discord: room, mode, level, score, and a square per round.
function shareText() {
  const sq = (n) => (n > 0 ? '🟩' : n < 0 ? '🟥' : '⬛');
  const where = S.online ? `online ${S.online.code}` : S.room ? (S.room.startsWith('daily-') ? `daily ${S.room.slice(6)}` : `room ${S.room}`) : 'at one screen';
  const head = `sHeeSh · ${where} · ${MODES[S.mode].name} · ${DIFF[S.difficulty].name}`;
  return [head].concat(S.players.map((p) => `${p.name}: ${p.score} ${p.rounds.map(sq).join('')}`)).concat([S.room ? 'https://gitgit1212again.github.io/sheeesh/' : '']).filter(Boolean).join('\n');
}
function renderLobby(el) {
  const m = MODES[prefs.mode];
  const deckSel = (i) => `<select class="fav" data-d="${i}" title="Favourite deck"><option value="">Any deck</option>${DECKS.map((d) => `<option value="${d}"${prefs.decks[i] === d ? ' selected' : ''}>${esc(paletteFor(d).name)}</option>`).join('')}</select>`;
  el.innerHTML = `<h3>You</h3>
    <div class="settings" id="names"><label class="pname"><span class="swatch" style="background:${colorOf(0)}"></span><input data-i="0" maxlength="18" placeholder="Your name" value="${esc(prefs.names[0] || '')}">${deckSel(0)}</label></div>
    <h3>How do you want it</h3>
    <div class="decks modes" id="modes">${Object.entries(MODES).map(([k, v]) => `<button type="button" class="deck${k === prefs.mode ? ' on' : ''}" data-mode="${k}"><span class="dart glyph">${v.glyph}</span><span class="dname">${esc(v.name)}</span></button>`).join('')}</div>
    <p class="muted" id="modeblurb">${esc(m.blurb)}</p>
    <div class="seg diff" id="diff">${Object.entries(DIFF).map(([k, v]) => `<button type="button" class="${k === prefs.difficulty ? 'on' : ''}" data-d="${k}">${v.name}</button>`).join('')}</div>
    <p class="muted">${esc(DIFF[prefs.difficulty].blurb)}</p>
    <div class="settings">
      <label>${prefs.mode === 'relatives' ? 'Words' : 'Rounds'} <select id="words">${[4, 6, 8, 10, 12].map((n) => `<option value="${n}"${prefs.words === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Seconds <select id="secs2">${m.seconds.map((n) => `<option value="${n}"${secsFor() === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="ways">
      <div class="way">
        <h3>With friends, each on their own phone</h3>
        <p class="muted">One of you hosts and gets a four-letter code. The others type it in. Everyone is numbered as they arrive, and plays each round on their own screen at the same time.</p>
        <div class="row"><button class="btn blood big" id="hostbtn">Host a game</button></div>
        <form class="row joinrow" id="joinform"><input id="joincode" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn big" type="submit">Join</button></form>
        <p class="muted" id="netmsg"></p>
      </div>
      <div class="way">
        <h3>At one screen, passing it round</h3>
        <div class="settings"><label>Players <select id="count">${[1, 2, 3, 4].map((n) => `<option value="${n}"${prefs.count === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="settings" id="names2">${[1, 2, 3].map((i) => `<label class="pname"${i >= prefs.count ? ' hidden' : ''}><span class="swatch" style="background:${colorOf(i)}"></span><input data-i="${i}" maxlength="18" placeholder="Player ${i + 1}" value="${esc(prefs.names[i] || '')}">${deckSel(i)}</label>`).join('')}</div>
        <div class="row"><button class="btn blood big" id="startbtn">Deal</button><button class="btn ghost big" id="dailybtn">Today's daily, solo</button></div>
      </div>
    </div>
    <p class="muted">${FAMILIES.length} words on file. Nothing is filtered.</p>`;
  const sync = () => { prefs.count = Number(document.getElementById('count').value); prefs.words = Number(document.getElementById('words').value) || 8; prefs.seconds[prefs.mode] = Number(document.getElementById('secs2').value); document.querySelectorAll('#names2 label').forEach((l, i) => { l.hidden = i + 1 >= prefs.count; }); savePrefs(); };
  ['count', 'words', 'secs2'].forEach((id) => document.getElementById(id).addEventListener('change', sync));
  document.getElementById('diff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; prefs.difficulty = b.dataset.d; savePrefs(); render(); });
  document.getElementById('dailybtn').addEventListener('click', () => { sync(); prefs.count = 1; S.room = `daily-${today()}`; prefs.words = 5; savePrefs(); audio(); startGame(); });
  document.getElementById('modes').addEventListener('click', (e) => { const b = e.target.closest('button.deck'); if (!b) return; prefs.mode = b.dataset.mode; savePrefs(); render(); });
  el.addEventListener('input', (e) => { if (e.target.dataset.i != null) { prefs.names[Number(e.target.dataset.i)] = e.target.value; savePrefs(); } });
  el.addEventListener('change', (e) => { if (e.target.dataset.d != null) { prefs.decks[Number(e.target.dataset.d)] = e.target.value; savePrefs(); } });
  document.getElementById('startbtn').addEventListener('click', () => { sync(); S.room = ''; audio(); startGame(); });
  document.getElementById('hostbtn').addEventListener('click', () => { sync(); audio(); hostRoom(); });
  document.getElementById('joinform').addEventListener('submit', (e) => { e.preventDefault(); sync(); audio(); joinRoom(document.getElementById('joincode').value); });
  document.getElementById('netmsg').textContent = lastNetMsg; lastNetMsg = '';
}
function renderOnlineLobby(el) {
  const v = S.online;
  const host = net && net.role === 'host';
  const slots = [0, 1, 2, 3].map((i) => { const q = S.players[i]; return `<div class="player${q ? '' : ' empty'}"><div class="av" style="color:${colorOf(i)};border-color:${colorOf(i)}">${q ? esc(initials(q.name)) : i + 1}</div><div class="nm">${q ? `${esc(q.name)}<small>${esc(q.deck ? paletteFor(q.deck).name : 'any deck')}</small>` : '<span class="muted">waiting…</span>'}</div>${q && !q.online ? '<span class="you off">gone</span>' : ''}</div>`; }).join('');
  el.innerHTML = `<h3>${host ? 'Your game code' : 'Joined'}</h3>
    <div class="bigcode">${esc(v.code)}</div>
    <p class="muted">${host ? 'Tell them: open the game, type this code, press Join. Players are numbered as they arrive.' : `Waiting for ${esc(S.players[0] ? S.players[0].name : 'the host')} to start.`}</p>
    <div class="players slots4">${slots}</div>
    <p class="muted">${esc(MODES[v.mode].name)} · ${esc(DIFF[v.difficulty].name)} · ${v.total} ${v.mode === 'relatives' ? 'words' : 'rounds'} · ${v.seconds} seconds each</p>
    <div class="row">${host ? `<button class="btn blood big" id="gobtn"${S.players.length < 2 ? ' disabled' : ''}>${S.players.length < 2 ? 'Start when someone joins' : 'Start'}</button>` : ''}<button class="btn ghost" id="leavebtn">Leave</button></div>`;
  const gb = document.getElementById('gobtn'); if (gb) gb.addEventListener('click', hostStart);
  document.getElementById('leavebtn').addEventListener('click', () => { leaveRoom(); newGame(); });
}

// ---------- online: one host, up to three guests, each on their own device ----------
// The host's page runs the room: it assigns player numbers in join order, deals, collects each
// player's result for the round, tallies, and sends every player their own view. Guests only
// render views and send results. Traffic goes straight between the phones (WebRTC via PeerJS);
// the public PeerJS server only introduces them, and the relay below carries it when phones
// can't reach each other directly.
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const peerId = (code) => `sheesh-${code}`;
let net = null; // { role: 'host'|'guest', code, peer, conn (guest), msg }
let R = null; // the room, on the host only

let lastNetMsg = '';
function netMsg(text, bad) { lastNetMsg = text; const el = document.getElementById('netmsg'); if (el) el.textContent = text; if (bad) toast(text, true); }
function leaveRoom() {
  if (net && net.peer) { try { net.peer.destroy(); } catch (_) { /* gone */ } }
  net = null; R = null;
  if (S) { S.online = null; S.done = false; }
}
function hostRoom() {
  leaveRoom();
  const code = makeCode();
  net = { role: 'host', code, peer: null };
  netMsg('Opening a room…');
  R = { code, mode: prefs.mode, difficulty: prefs.difficulty, words: prefs.words, seconds: secsFor(), players: [newPlayer(0, prefs.names[0], prefs.decks[0])], conns: [null], phase: 'lobby', round: 0, deck: [], reveal: null, log: [] };
  const peer = new Peer(peerId(code), { config: ICE });
  net.peer = peer;
  peer.on('open', () => { lastNetMsg = ''; broadcast(); });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { hostRoom(); return; }
    netMsg(e.type === 'network' || e.type === 'server-error' ? 'Can\'t reach the matchmaking server. Check the connection and try again.' : `Connection problem: ${e.type}`, true);
  });
  peer.on('connection', (conn) => {
    conn.on('data', (msg) => hostMessage(conn, msg));
    conn.on('close', () => { const i = R.conns.indexOf(conn); if (i > 0) { R.players[i].online = false; if (R.phase === 'play') { R.players[i].done = true; hostCheckDone(); } broadcast(); } });
  });
}
function joinRoom(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { netMsg('The code is four letters.', true); return; }
  leaveRoom();
  net = { role: 'guest', code, peer: null, conn: null };
  netMsg('Looking for the game…');
  const peer = new Peer({ config: ICE });
  net.peer = peer;
  peer.on('open', () => {
    const conn = peer.connect(peerId(code), { reliable: true });
    net.conn = conn;
    conn.on('open', () => { lastNetMsg = ''; conn.send({ type: 'join', name: (prefs.names[0] || '').trim(), deck: prefs.decks[0] || '' }); });
    conn.on('data', (msg) => guestMessage(msg));
    conn.on('close', () => { if (net && net.role === 'guest') { toast('Lost the host.', true); leaveRoom(); newGame(); } });
  });
  peer.on('error', (e) => {
    netMsg(e.type === 'peer-unavailable' ? `No game with the code ${code}.` : e.type === 'network' || e.type === 'server-error' ? 'Can\'t reach the matchmaking server. Check the connection and try again.' : `Connection problem: ${e.type}`, true);
    leaveRoom(); render();
  });
}
function sendResult(result) {
  if (!net) return;
  if (net.role === 'host') hostResult(0, result);
  else if (net.conn) net.conn.send(Object.assign({ type: 'result' }, result));
}
// ----- host side
function hostMessage(conn, msg) {
  if (!R || !msg || typeof msg !== 'object') return;
  if (msg.type === 'join') {
    if (R.phase !== 'lobby') { conn.send({ type: 'refused', text: 'That game has already started.' }); return; }
    if (R.players.length >= 4) { conn.send({ type: 'refused', text: 'That game is full.' }); return; }
    const i = R.players.length;
    R.players.push(newPlayer(i, String(msg.name || '').slice(0, 18), DECKS.includes(msg.deck) ? msg.deck : ''));
    R.conns.push(conn);
    broadcast();
    return;
  }
  if (msg.type === 'result') { const i = R.conns.indexOf(conn); if (i >= 0) hostResult(i, msg); }
}
function hostStart() {
  if (!R || R.players.length < 2) return;
  random = Math.random;
  S.difficulty = R.difficulty;
  R.deck = buildDeck(R.mode, R.difficulty, R.words, R.players);
  R.round = 0; R.phase = 'play'; R.reveal = null; R.log = [];
  R.players.forEach((p) => { p.done = false; p.result = null; });
  broadcast();
}
function hostResult(i, msg) {
  if (!R || R.phase !== 'play' || msg.round !== R.round) return;
  const p = R.players[i];
  if (p.done) return;
  p.done = true;
  if (R.mode === 'relatives') p.result = Array.isArray(msg.plays) ? msg.plays.filter((g) => g && typeof g.word === 'string').slice(0, 200) : [];
  else {
    const pts = msg.right === true ? RIGHT : msg.right === false ? -WRONG : 0;
    p.score += pts; p.rounds.push(pts);
    if (msg.right === true) p.right += 1; else if (msg.right === false) p.wrong += 1;
    const it = R.deck[R.round * R.players.length + i];
    R.log.push(logEntry(R.mode, R.round, p, it, msg.choice === undefined ? null : msg.choice, msg.right === true ? true : msg.right === false ? false : null, pts));
  }
  hostCheckDone();
  broadcast();
}
function hostCheckDone() {
  if (!R || R.phase !== 'play' || R.players.some((p) => !p.done)) return;
  if (R.mode === 'relatives') {
    const card = R.deck[R.round];
    const { found, deltas } = tally(card, R.players, (p) => p.result || []);
    const plays = R.players.map((p) => p.result || []);
    R.reveal = { card, found, deltas, plays };
    R.log.push({ round: R.round, word: card.word, found, deltas });
    R.phase = 'reveal';
  } else R.phase = 'between';
}
function hostNext() {
  if (!R || (R.phase !== 'reveal' && R.phase !== 'between')) return;
  R.round += 1;
  if (R.round >= R.words) R.phase = 'final';
  else { R.phase = 'play'; R.reveal = null; R.players.forEach((p) => { p.done = false; p.result = null; }); }
  broadcast();
}
function viewFor(i) {
  const n = R.players.length;
  const item = R.phase !== 'lobby' && R.mode !== 'relatives' ? R.deck[R.round * n + i] : null;
  return {
    type: 'view', code: R.code, phase: R.phase, mode: R.mode, difficulty: R.difficulty, seconds: R.seconds, total: R.words, round: R.round, me: i,
    players: R.players.map((p) => ({ id: p.id, name: p.name, deck: p.deck, score: p.score, best: p.best, right: p.right, wrong: p.wrong, rounds: p.rounds, done: p.done, online: p.online })),
    card: R.phase === 'lobby' ? null : R.mode === 'relatives' ? R.deck[Math.min(R.round, R.words - 1)] : item.card,
    item, reveal: R.reveal, log: R.log,
  };
}
function broadcast() {
  if (!R) return;
  R.players.forEach((p, i) => { const v = viewFor(i); if (i === 0) applyView(v); else if (R.conns[i] && R.conns[i].open) R.conns[i].send(v); });
}
// ----- guest side
function guestMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'refused') { netMsg(msg.text, true); leaveRoom(); render(); return; }
  if (msg.type === 'view') applyView(msg);
}
// Both sides render from a view. A new round resets the local guesses and starts the clock.
function applyView(v) {
  const fresh = !S.online || S.online.round !== v.round || S.online.phase === 'lobby';
  S.online = v; S.mode = v.mode; S.difficulty = v.difficulty; S.room = '';
  S.players = v.players; S.turn = v.me; S.word = v.round; S.card = v.card; S.item = v.item; S.log = v.log || [];
  const me = v.players[v.me];
  if (v.phase === 'lobby') { S.phase = 'olobby'; deadline = null; render(); return; }
  if (v.phase === 'play') {
    if (fresh) { S.plays = []; S.plays[v.me] = []; S.verdict = null; S.done = false; started = Date.now(); deadline = started + v.seconds * 1000; }
    if (me.done || S.done) { deadline = null; S.phase = v.mode === 'relatives' ? 'wait' : 'verdict'; if (!S.verdict) S.verdict = { choice: null, right: null, pts: 0 }; }
    else S.phase = 'turn';
    render();
    if (fresh && S.phase === 'turn') { const inp = document.getElementById('guess'); if (inp) inp.focus(); }
    return;
  }
  deadline = null;
  if (v.phase === 'reveal') { S.history = [v.reveal]; S.phase = 'reveal'; if (fresh) sfx.reveal(); render(); return; }
  if (v.phase === 'between') { S.phase = 'verdict'; if (!S.verdict) S.verdict = { choice: null, right: null, pts: 0 }; render(); return; }
  if (v.phase === 'final') { S.phase = 'final'; render(); }
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
  if (S.phase === 'lobby' || S.phase === 'olobby') { el.innerHTML = ''; return; }
  const cur = ['turn', 'pass', 'verdict', 'wait'].includes(S.phase) ? S.turn : -1;
  const tag = (p) => (S.online ? (p.id === S.turn ? '<span class="you">you</span>' : '') + (!p.online ? '<span class="you off">gone</span>' : p.done && S.phase !== 'reveal' && S.phase !== 'final' ? '<span class="you ok">done</span>' : '') : p.id === cur ? '<span class="you">up now</span>' : '');
  el.innerHTML = `<h3>Scores</h3>` + S.players.slice().sort((a, b) => b.score - a.score).map((p) => `
    <div class="player${p.id === cur ? ' current' : ''}">
      <div class="av" style="color:${colorOf(p.id)};border-color:${colorOf(p.id)}">${esc(initials(p.name))}</div>
      <div class="nm">${esc(p.name)}${tag(p)}</div>
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
  if (overlay === 'board') {
    const g = S.log && S.log.length ? { mode: S.mode, players: S.players, log: S.log, code: S.online ? S.online.code : '', live: S.phase !== 'final' } : lastGame ? Object.assign({ live: false, previous: true }, lastGame) : null;
    let body = '<p class="muted">Nothing played yet. The scoreboard fills in as the words go by.</p>';
    if (g) {
      const sorted = g.players.slice().sort((a, b) => b.score - a.score);
      const board = `<div class="board">${sorted.map((q, i) => `<div class="r"><span class="n">${i + 1}</span><span style="color:${colorOf(q.id)}">${esc(q.name)}</span><span class="pts">${q.score}</span></div>`).join('')}</div>`;
      let rows;
      if (g.mode === 'relatives') {
        rows = g.log.map((e) => `<div class="logrow"><div class="logword">${e.round + 1}. ${esc(up(e.word))}</div><div class="famlist">${e.found.map((x) => `<span class="fam ${x.by.length ? 'got' : 'none'}">${esc(x.f)}${x.by.map((id) => `<b style="background:${colorOf(id)}">${esc(initials((g.players[id] || {}).name || '?'))}</b>`).join('')}</span>`).join('')}</div><div class="muted">${e.deltas.map((d) => `<span style="color:${colorOf(d.id)}">${esc(d.name)} +${d.pts}</span>`).join(' · ')}</div></div>`).join('');
      } else {
        const byRound = {};
        g.log.forEach((e) => { (byRound[e.round] = byRound[e.round] || []).push(e); });
        rows = Object.keys(byRound).sort((a, b) => a - b).map((r) => `<div class="logrow"><div class="logword">Round ${Number(r) + 1}</div>${byRound[r].map((e) => `<div class="logline"><span style="color:${colorOf(e.id)}">${esc(e.name)}</span> · ${esc(up(e.word))}${e.other ? ` and ${esc(up(e.other))}` : ''} · <b>${e.right === null ? 'out of time' : e.right ? 'right' : 'wrong'}</b> (${esc(e.truth)}) · ${e.pts > 0 ? `+${e.pts}` : e.pts}</div>`).join('')}</div>`).join('');
      }
      body = `${g.previous ? '<p class="muted">The last game. A new one starts the board fresh.</p>' : ''}${board}<h3>${g.mode === 'relatives' ? 'Words found' : 'Every round'}</h3>${rows || '<p class="muted">No rounds finished yet.</p>'}`;
    }
    el.innerHTML = `<div class="overlay" id="ov"><div class="sheet wide">
      <h2>Scoreboard${g && g.code ? ` · ${esc(g.code)}` : ''}</h2>
      <div class="boardpage">${body}</div>
      <div class="row"><button class="btn blood" id="ovclose">Close</button></div>
    </div></div>`;
    document.getElementById('ovclose').addEventListener('click', () => { overlay = null; renderOverlay(); });
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
