// sHeeeSh: an etymology game of word play and association for 2 to 4 people at one screen.
const { Game } = require('./engine');
const CARDS = require('./cards');
const { normalizeWord } = require('./parse');
const { plateArt, paletteFor } = require('./art');

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const up = (s) => String(s ?? '').toUpperCase();
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const rnd = (n) => Math.floor(Math.random() * n);

// The three ways to connect a word, and what each is worth.
const LINKS = {
  root: { label: 'Same root', points: 3, blurb: 'It comes from the same ancient word.' },
  letters: { label: 'Same sound', points: 2, blurb: 'It rhymes, sounds the same, is an anagram, or is a pun on it. Looks alone don\'t count.' },
  idea: { label: 'Same idea', points: 1, blurb: 'It goes with it. Any link you can say out loud.' },
};
const COLORS = { root: '#ffd166', letters: '#4dff88', idea: '#c77dff' };
const LONG_BONUS = 1; // 8+ letters
const QUICK_BONUS = 1; // played within QUICK_MS of pressing ready
const QUICK_MS = 15000;
const ROOT_RUN_BONUS = 3; // three roots in a row in the chain, to whoever completes the run
const HOMECOMING_BONUS = 2; // a played word turns out to be a true relative of the starting word
const PLAYER_COLORS = ['#ff3fa4', '#35e3ff', '#ffd166', '#4dff88'];
const SOURCE_BONUS = 1; // connecting back to the starting word instead of the last one, once per round
const DOUBLE_PENALTY = 2; // a doubled play that gets voted out

// ---------- state ----------
let prefs = { names: ['', '', '', ''], count: 2, rounds: 3, turnSeconds: 60, timer: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('sheeesh.v2.prefs') || '{}')); } catch (_) { /* ignore */ }
const savePrefs = () => { try { localStorage.setItem('sheeesh.v2.prefs', JSON.stringify(prefs)); } catch (_) { /* ignore */ } };

let game = null;
let timer = null;
let deadline = null;
let phaseStartedAt = 0;
let armed = false; // the current player has pressed "ready"; the clock is running
let verdict = null; // { kind:'good'|'bad', text }
let pendingNote = null;
let contest = null; // { by, why, votes: {playerId: true=stands|false=out} } once someone objects
let overlay = null;
let lastRound = null;
let final = null;
let stageKey = '';
let playLink = 'idea';
let playTarget = 'last'; // 'last' | 'source'
let playDouble = false;
let used = {}; // playerId -> { source: bool, double: bool }, reset each round
let toastTimer = null;
const usedBy = (id) => (used[id] = used[id] || { source: false, double: false });

const colorOf = (id) => PLAYER_COLORS[Number(String(id).replace('p', '')) % PLAYER_COLORS.length];

// ---------- sound: a saber hum on the clock, a chime, a thud ----------
const SND = { ctx: null, hum: null, lastTick: null };
function audio() {
  if (!SND.ctx) { try { SND.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* no audio */ } }
  if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume().catch(() => {});
  return SND.ctx;
}
function beep(freq, dur, type = 'sine', vol = 0.12, slideTo = null) {
  const ctx = audio();
  if (!ctx || prefs.sound === false) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + dur + 0.05);
}
function humStart() {
  const ctx = audio();
  if (!ctx || prefs.sound === false || SND.hum) return;
  const o = ctx.createOscillator(); const o2 = ctx.createOscillator(); const lfo = ctx.createOscillator();
  const lg = ctx.createGain(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.value = 68;
  o2.type = 'sine'; o2.frequency.value = 136;
  lfo.frequency.value = 5.5; lg.gain.value = 3; lfo.connect(lg).connect(o.frequency);
  f.type = 'lowpass'; f.frequency.value = 520;
  g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.5);
  o.connect(f); o2.connect(f); f.connect(g).connect(ctx.destination);
  o.start(); o2.start(); lfo.start();
  SND.hum = { o, o2, lfo, g };
  beep(180, 0.35, 'sawtooth', 0.08, 900); // ignition
}
function humStop(hard) {
  const ctx = SND.ctx;
  const h = SND.hum;
  if (!ctx || !h) return;
  SND.hum = null;
  h.g.gain.cancelScheduledValues(ctx.currentTime);
  h.g.gain.setValueAtTime(h.g.gain.value, ctx.currentTime);
  h.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (hard ? 0.08 : 0.35));
  setTimeout(() => { try { h.o.stop(); h.o2.stop(); h.lfo.stop(); } catch (_) { /* done */ } }, 500);
}
const sfx = {
  stands() { beep(880, 0.12, 'sine', 0.1); setTimeout(() => beep(1318, 0.25, 'sine', 0.1), 90); },
  out() { beep(140, 0.35, 'sawtooth', 0.14, 45); },
  tick() { beep(1200, 0.03, 'square', 0.04); },
  reveal() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.5, 'triangle', 0.07), i * 110)); },
  timeout() { humStop(true); beep(110, 0.6, 'sawtooth', 0.12, 30); },
};

function toast(text, bad) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); document.body.appendChild(t); }
  t.className = `toast${bad ? ' bad' : ''}`;
  t.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

// ---------- the dictionary ----------
// Played words get looked up in Wiktionary: first English definition, and the English etymology section.
const dict = new Map(); // word -> { state:'loading'|'done', pos, def, ety }
const lookups = new Map();
const stripHtml = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent.replace(/\s+/g, ' ').trim(); };
const WIKI = 'https://en.wiktionary.org';
function lookup(raw) {
  const key = String(raw).trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  if (!lookups.has(key)) lookups.set(key, doLookup(key));
  return lookups.get(key);
}
async function doLookup(key) {
  const entry = { state: 'loading', pos: null, def: null, ety: null };
  dict.set(key, entry);
  const done = () => { entry.state = 'done'; renderCard(); };
  if (!navigator.onLine) { done(); return entry; }
  const title = encodeURIComponent(key.replace(/\s+/g, '_'));
  try {
    const d = await fetch(`${WIKI}/api/rest_v1/page/definition/${title}`).then((r) => (r.ok ? r.json() : null));
    const en = d && d.en;
    if (en && en.length) {
      const first = en.find((e) => e.definitions && e.definitions.some((x) => x.definition));
      if (first) {
        entry.pos = first.partOfSpeech ? first.partOfSpeech.toLowerCase() : null;
        entry.def = stripHtml(first.definitions.find((x) => x.definition).definition).slice(0, 220);
      }
    }
  } catch (_) { /* offline or not found */ }
  try {
    const s = await fetch(`${WIKI}/w/api.php?action=parse&page=${title}&prop=sections&format=json&origin=*`).then((r) => r.json());
    const secs = (s.parse && s.parse.sections) || [];
    const enIdx = secs.findIndex((x) => x.line === 'English' && x.toclevel === 1);
    let ety = null;
    if (enIdx >= 0) {
      for (let i = enIdx + 1; i < secs.length; i++) {
        if (secs[i].toclevel === 1) break;
        if (/^Etymology/.test(secs[i].line)) { ety = secs[i]; break; }
      }
    }
    if (ety) {
      const t = await fetch(`${WIKI}/w/api.php?action=parse&page=${title}&prop=text&section=${ety.index}&format=json&origin=*&disabletoc=1`).then((r) => r.json());
      const html = (t.parse && t.parse.text && t.parse.text['*']) || '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const bad of doc.querySelectorAll('.mw-editsection, .reference, style, script, table, ul, ol')) bad.remove();
      const ps = [...doc.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      // Keep it short: the first sentence, and if it is a long chain of "from X, from Y, from Z",
      // just where it starts and where it ends up.
      let text = ps.join(' ').replace(/\[\d+\]/g, '').replace(/\s*\([^()]*\)/g, (m) => (/[“"]/.test(m) ? m : ''));
      const firstSentence = text.match(/^.*?[.!?](?=\s|$)/);
      if (firstSentence) text = firstSentence[0];
      const parts = text.split(/,\s*(?=from\s)/i);
      if (parts.length > 3) text = `${parts[0]} … ${parts.slice(-2).join(', ')}`;
      if (text.length > 220) text = text.slice(0, 220).replace(/\s+\S*$/, '') + '…';
      entry.ety = text;
    }
  } catch (_) { /* offline or not found */ }
  done();
  return entry;
}
function dictHtml(word) {
  const e = dict.get(String(word).trim().toLowerCase());
  if (!e) return '';
  if (e.state === 'loading') return `<div class="plate-dict"><span class="lbl">dictionary</span> looking up ${esc(up(word))}…</div>`;
  if (!e.def && !e.ety) return `<div class="plate-dict"><span class="lbl">dictionary</span> ${esc(up(word))} isn't in Wiktionary. The table takes it or leaves it.</div>`;
  return `<div class="plate-dict">${e.def ? `<div><span class="lbl">${esc(e.pos || 'meaning')}</span> ${esc(e.def)}</div>` : ''}${e.ety ? `<div><span class="lbl">origin</span> ${esc(e.ety)}</div>` : ''}</div>`;
}

// ---------- scoring ----------
const pointsFor = (link, word, quick) => LINKS[link].points + (normalizeWord(word).length >= 8 ? LONG_BONUS : 0) + (quick ? QUICK_BONUS : 0);

// Bonuses that only show once the round is over and the file is open.
function roundBonuses(card, chain) {
  const out = []; // { playerId, name, points, why }
  const relatives = new Set(card.cousins.map(normalizeWord));
  let run = 0;
  for (const c of chain) {
    run = c.link === 'root' ? run + 1 : 0;
    if (run > 0 && run % 3 === 0) out.push({ playerId: c.playerId, name: c.playerName, points: ROOT_RUN_BONUS, why: `three roots in a row, finished with ${up(c.word)}` });
    if (relatives.has(normalizeWord(c.word))) out.push({ playerId: c.playerId, name: c.playerName, points: HOMECOMING_BONUS, why: `${up(c.word)} really is family of ${up(card.word)}` });
  }
  return out;
}

function applyEvents(events) {
  let intro = false;
  for (const ev of events) {
    if (ev.type === 'roundStart') { verdict = null; lastRound = null; used = {}; intro = true; }
    if (ev.type === 'turn') { armed = false; playLink = 'idea'; playTarget = 'last'; playDouble = false; overlay = 'pass'; }
    if (ev.type === 'timeout') { ev.player.score -= ev.penalty; verdict = { kind: 'bad', text: `${ev.player.name} ran out of time. No points.` }; sfx.timeout(); }
    if (ev.type === 'roundEnd') {
      sfx.reveal();
      const bonuses = roundBonuses(ev.card, ev.chain);
      const deltas = ev.deltas.map((d) => ({ id: d.player.id, name: d.player.name, delta: d.delta }));
      for (const b of bonuses) { game.player(b.playerId).score += b.points; const d = deltas.find((x) => x.id === b.playerId); if (d) d.delta += b.points; }
      lastRound = { round: ev.round, card: ev.card, chain: ev.chain, deltas, bonuses };
      overlay = 'round';
    }
    if (ev.type === 'gameEnd') {
      const board = game.scoreboard();
      const top = board[0].score;
      final = { winners: board.filter((p) => p.score === top).map((p) => p.name), scoreboard: board.map((p) => ({ id: p.id, name: p.name, score: p.score, best: p.best, rejected: p.rejected })) };
      if (!lastRound) overlay = 'final';
    }
  }
  if (intro && game.state === 'turn' && !lastRound) overlay = 'intro';
  schedule();
  render();
}

function schedule() {
  clearTimeout(timer);
  deadline = null;
  if (!prefs.timer || !armed || game.state !== 'turn') return;
  const ms = game.settings.turnSeconds * 1000;
  phaseStartedAt = Date.now();
  deadline = phaseStartedAt + ms;
  const phase = game.phaseId;
  timer = setTimeout(() => {
    if (game.phaseId !== phase || game.state !== 'turn') return;
    applyEvents(game.turnExpired(Date.now()));
  }, ms + 100);
}

function ready() {
  armed = true;
  overlay = null;
  game.turnStartedAt = Date.now();
  schedule();
  if (prefs.timer) humStart();
  render();
}

// The player who opens the round may pick the deck; the dealt card is swapped for one from that family.
function deckCounts() {
  const counts = {};
  for (const c of game.deck) counts[c.cat] = (counts[c.cat] || 0) + 1;
  if (game.card) counts[game.card.cat] = (counts[game.card.cat] || 0) + 1;
  return counts;
}
function chooseDeck(cat) {
  if (cat && game.card.cat !== cat) {
    const idx = game.deck.findIndex((c) => c.cat === cat);
    if (idx >= 0) {
      const old = game.card;
      const next = game.deck.splice(idx, 1)[0];
      game.usedWords.delete(normalizeWord(old.word));
      game.deck.unshift(old); // goes to the bottom of the pile
      game.card = next;
      game.usedWords.add(normalizeWord(next.word));
    }
  }
  overlay = 'pass';
  render();
}

// A play goes on the table. The table judges it.
function play(word, link, why, target, dbl) {
  const me = game.currentPlayer();
  const u = usedBy(me.id);
  if (target === 'source' && (u.source || !game.chain.length)) target = 'last';
  if (dbl && u.double) dbl = false;
  const prev = target === 'source' ? game.card.word : game.previousWord();
  const quick = Date.now() - game.turnStartedAt <= QUICK_MS;
  const res = game.submit(me.id, `"${word.replace(/"/g, '')}" #meaning ${why || '-'}`, Date.now());
  if (!res.ok) return res.error;
  const pend = game.pending;
  pend.link = link;
  pend.why = why;
  pend.prev = prev;
  pend.target = target;
  pend.doubled = !!dbl;
  const base = pointsFor(link, word, quick) + (target === 'source' ? SOURCE_BONUS : 0);
  pend.breakdown = { total: dbl ? base * 2 : base, base, long: normalizeWord(word).length >= 8, quick, source: target === 'source', doubled: !!dbl };
  if (target === 'source') u.source = true;
  if (dbl) u.double = true;
  lookup(word);
  clearTimeout(timer);
  deadline = null;
  humStop();
  pendingNote = `${pend.playerName} claims ${LINKS[link].label.toLowerCase()}${target === 'source' ? ' back to the starting word' : ''}${quick ? ', quickly' : ''}${dbl ? ', doubled' : ''}. The table decides.`;
  render();
  return null;
}

function judge(accept, text) {
  if (game.state !== 'vote') return;
  const pend = game.pending;
  const player = game.player(pend.playerId);
  const others = game.players.filter((p) => p.id !== pend.playerId);
  let events = [];
  for (const o of others) {
    const v = game.vote(o.id, accept, Date.now());
    if (v.resolved) { events = v.events; break; }
  }
  if (!events.length) events = game.voteExpired(Date.now());
  const rej = events.find((e) => e.type === 'rejected');
  if (rej) sfx.out(); else sfx.stands();
  if (rej) {
    // Engine charges −2 on a rejection; a plain play scores nothing, a doubled play keeps the loss.
    if (pend.doubled) { player.score += rej.penalty + (-DOUBLE_PENALTY); verdict = { kind: 'bad', text: `${text || `${up(pend.word)} thrown out.`} Doubled, so ${player.name} loses ${DOUBLE_PENALTY}.` }; }
    else { player.score -= rej.penalty; verdict = { kind: 'bad', text: text || `${up(pend.word)} thrown out. ${player.name} scores nothing.` }; }
  } else {
    const b = pend.breakdown;
    const bits = [`${LINKS[pend.link].points} ${LINKS[pend.link].label.toLowerCase()}`];
    if (b.long) bits.push('+1 long word');
    if (b.quick) bits.push('+1 quick');
    if (b.source) bits.push(`+${SOURCE_BONUS} back to the start`);
    if (b.doubled) bits.push('doubled');
    verdict = { kind: 'good', text: text || `${up(pend.word)} stands. ${player.name} +${b.total} (${bits.join(', ')}).` };
  }
  pendingNote = null;
  contest = null;
  // Mark a back-to-the-start play in the chain so it draws as a return arrow.
  const last = game.chain[game.chain.length - 1];
  if (last && !rej && pend.target === 'source' && normalizeWord(last.word) === normalizeWord(pend.word)) last.source = true;
  applyEvents(events);
}

// Someone objects: they say who they are and why, then everyone but the player votes.
function openContest(by, why) {
  contest = { by, why, votes: {} };
  const pend = game.pending;
  pendingNote = `${game.player(by).name} objects: “${why}”`;
  const voters = game.players.filter((p) => p.id !== pend.playerId);
  if (voters.length === 1) { judge(false, `${up(pend.word)} thrown out. ${game.player(by).name} objected: “${why}”. ${game.player(pend.playerId).name} scores nothing.`); return; }
  stageKey = '';
  render();
}
function castVote(playerId, stands) {
  if (!contest) return;
  contest.votes[playerId] = stands;
  const pend = game.pending;
  const voters = game.players.filter((p) => p.id !== pend.playerId);
  if (voters.some((v) => !(v.id in contest.votes))) { stageKey = ''; render(); return; }
  const outs = voters.filter((v) => contest.votes[v.id] === false).length;
  const stands_ = voters.length - outs;
  const by = game.player(contest.by).name;
  if (outs > stands_) judge(false, `${up(pend.word)} thrown out, ${outs} to ${stands_}. ${by} objected: “${contest.why}”. ${game.player(pend.playerId).name} scores nothing.`);
  else judge(true, `${up(pend.word)} stands, ${stands_} to ${outs}, over ${by}'s objection. ${game.player(pend.playerId).name} +${pend.breakdown.total}.`);
}

function newGame() {
  clearTimeout(timer);
  game = new Game({ channelId: 'table', hostId: 'p0', settings: { rounds: prefs.rounds, turnsPerPlayer: 2, turnSeconds: prefs.turnSeconds, voteSeconds: 600, clueMode: 'never', handSize: 0 } });
  verdict = null; pendingNote = null; contest = null; overlay = null; lastRound = null; final = null; stageKey = ''; armed = false; deadline = null; used = {};
  render();
}
function start() {
  for (let i = 0; i < prefs.count; i++) game.addPlayer(`p${i}`, prefs.names[i] || `Player ${i + 1}`);
  applyEvents(game.start(Date.now()).events);
}

// ---------- render ----------
function render() {
  if (!document.querySelector('header.top')) {
    app.innerHTML = `
      <svg width="0" height="0" style="position:absolute"><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.5"/></filter></svg>
      <header class="top">
        <div class="wordmark">sHeeeSh</div>
        <div class="case" id="case"></div>
        <div class="timer" id="timer"><i></i></div>
        <div class="secs" id="secs"></div>
        <button class="btn ghost" id="sndbtn" title="Sound">${prefs.sound === false ? '🔇' : '🔊'}</button>
        <button class="btn ghost" id="rulesbtn" title="How to play">How to play</button>
      </header>
      <main class="table">
        <section class="center">
          <div class="track" id="track"></div>
          <div class="plate-wrap" id="card"></div>
          <div class="chain" id="chain"></div>
          <div class="stage" id="stage"></div>
        </section>
        <aside class="side">
          <div class="players" id="players"></div>
          <div class="players" id="howto"></div>
        </aside>
      </main>
      <div id="overlay"></div>`;
    document.getElementById('rulesbtn').addEventListener('click', () => { overlay = overlay === 'rules' ? null : 'rules'; renderOverlay(); });
    document.getElementById('sndbtn').addEventListener('click', (e) => { prefs.sound = prefs.sound === false; savePrefs(); e.target.textContent = prefs.sound === false ? '🔇' : '🔊'; if (prefs.sound === false) humStop(true); else { audio(); sfx.stands(); } });
  }
  renderHeader();
  renderTrack();
  renderCard();
  renderChain();
  renderStage();
  renderPlayers();
  renderHowto();
  renderOverlay();
}

// The round's shape, always visible: every turn in order, who's done, who's up, and the step within the turn.
function turnOrder() {
  const n = game.players.length;
  const startIdx = (game.round - 1) % n;
  return Array.from({ length: game.totalTurns() }, (_, i) => game.players[(startIdx + i) % n]);
}
function renderTrack() {
  const el = document.getElementById('track');
  if (game.state === 'lobby' || game.state === 'ended') { el.innerHTML = ''; return; }
  const order = turnOrder();
  const cur = game.turnNo;
  const step = game.state === 'vote' ? (contest ? 3 : 2) : (armed ? 1 : 0);
  const steps = ['pass', 'play', 'table', 'verdict'];
  el.innerHTML = `<div class="turns">${order.map((p, i) => `<span class="turn ${i < cur ? 'done' : i === cur ? 'now' : ''}" style="--pc:${colorOf(p.id)}"><i>${i + 1}</i>${esc(p.name)}</span>`).join('')}</div>
    <div class="steps">${steps.map((s, i) => `<span class="step ${i < step ? 'done' : i === step ? 'now' : ''}">${s}</span>`).join('<span class="sep">›</span>')}</div>`;
}

function renderHeader() {
  const c = document.getElementById('case');
  if (game.state === 'lobby') c.textContent = '';
  else if (game.state === 'ended') c.textContent = 'Game over';
  else c.textContent = `Round ${game.round} of ${game.settings.rounds} · turn ${Math.min(game.turnNo + 1, game.totalTurns())} of ${game.totalTurns()}`;
}

function tick() {
  if (!game) return;
  const t = document.getElementById('timer');
  const s = document.getElementById('secs');
  if (!t) return;
  if (!deadline) { t.firstChild.style.transform = 'scaleX(0)'; s.textContent = ''; return; }
  const total = deadline - phaseStartedAt;
  const left = Math.max(0, deadline - Date.now());
  t.firstChild.style.transform = `scaleX(${left / total})`;
  s.textContent = Math.ceil(left / 1000);
  t.classList.toggle('urgent', left < 10000);
  s.classList.toggle('urgent', left < 10000);
  const sec = Math.ceil(left / 1000);
  if (left > 0 && left < 10000 && sec !== SND.lastTick && game.state === 'turn') { SND.lastTick = sec; sfx.tick(); }
}
setInterval(tick, 200);

const cardNo = (c) => String(1000 + CARDS.indexOf(c)).padStart(4, '0');
const barcode = () => `<span class="bar">${Array.from({ length: 22 }, () => `<i style="height:${6 + rnd(8)}px"></i>`).join('')}</span>`;

function plate({ cat, band, art, body, stamp, foot }) {
  const p = paletteFor(cat);
  return `<div class="plate" style="--ink:${p.ink};--band:${p.band};--paper:${p.paper}">
    <div class="plate-frame">
      <div class="plate-band"><span>${esc(p.name)} deck</span><span class="no">${esc(band)}</span></div>
      <div class="plate-left">${art}<div class="plate-fig">fig. ${cat === 'misc' ? 'i' : cat.slice(0, 1)}</div></div>
      <div class="plate-body">${body}<div class="plate-foot"><span>${esc(foot || '')}</span>${barcode()}</div></div>
    </div>
    ${stamp || ''}
  </div>`;
}

function renderCard() {
  const el = document.getElementById('card');
  const c = game.card;
  if (!c) {
    el.innerHTML = plate({ cat: 'misc', band: 'waiting', art: plateArt('misc'), body: `<div class="plate-word">sHeeeSh</div><div class="plate-rule"></div><div class="plate-origin">A word comes up with its origin sealed. Take turns adding a word that connects to the last one, and say how. The table accepts or objects. At the end of the round the file opens: where the word came from, its real relatives, and who got close.</div>`, foot: 'enter your names below' });
    return;
  }
  const prev = game.chain.length ? game.chain[game.chain.length - 1] : null;
  const pend = game.state === 'vote' ? game.pending : null;
  let body;
  let stamp = '';
  let band = `round ${game.round} · word no. ${cardNo(c)}`;
  const who = (id, name) => `<span class="who" style="color:${colorOf(id)}">${esc(name)}</span>`;
  if (pend) {
    body = `<div class="plate-word prev">${esc(up(pend.prev))} →</div><div class="plate-word">${esc(up(pend.word))}</div><div class="plate-rule"></div>
      <div class="plate-why">${who(pend.playerId, pend.playerName)} <span class="who" style="color:${COLORS[pend.link]}">${esc(LINKS[pend.link].label)} · ${pend.breakdown.total} pt${pend.breakdown.total === 1 ? '' : 's'}</span>${pend.why ? `“${esc(pend.why)}”` : ''}</div>
      <div class="plate-verdict">${esc(pendingNote || '')}</div>${dictHtml(pend.word)}`;
    band = `${esc(pend.playerName)} plays`;
    stamp = '<div class="stamp gold">On the table</div>';
  } else if (prev) {
    body = `<div class="plate-word prev">${esc(up(c.word))} → … →</div><div class="plate-word">${esc(up(prev.word))}</div><div class="plate-rule"></div>
      <div class="plate-why">${who(prev.playerId, prev.playerName)} <span class="who" style="color:${COLORS[prev.link]}">${esc(LINKS[prev.link].label)}</span>${prev.why ? `“${esc(prev.why)}”` : ''}</div>
      ${verdict ? `<div class="plate-verdict">${esc(verdict.text)}</div>` : ''}${dictHtml(prev.word)}`;
    if (verdict) stamp = `<div class="stamp ${verdict.kind === 'bad' ? 'bad' : 'good'}">${verdict.kind === 'bad' ? 'Out' : 'Stands'}</div>`;
  } else {
    body = `<div class="plate-word">${esc(up(c.word))}</div><div class="plate-rule"></div>
      <div class="plate-origin"><b>Sealed.</b> Where ${esc(up(c.word))} came from is revealed when the round ends. Clue on the file: <i>${esc(c.clue)}</i>.</div>${verdict ? `<div class="plate-verdict">${esc(verdict.text)}</div>` : ''}`;
    if (verdict) stamp = `<div class="stamp ${verdict.kind === 'bad' ? 'bad' : 'good'}">${verdict.kind === 'bad' ? 'Out' : 'Stands'}</div>`;
  }
  el.innerHTML = plate({ cat: c.cat, band, art: plateArt(c.cat), body, stamp, foot: prev ? `started from ${up(c.word)} · origin sealed` : 'origin sealed until the round ends' });
}

function renderChain() {
  const el = document.getElementById('chain');
  if (!game.card || game.state === 'lobby') { el.innerHTML = ''; return; }
  const parts = [`<span class="tag seed">${esc(up(game.card.word))}</span>`];
  for (const c of game.chain) parts.push(`<span class="arrow">${c.source ? '↩' : '→'}</span><span class="tag" style="border-color:${COLORS[c.link]}">${esc(up(c.word))}<small style="color:${colorOf(c.playerId)}">${esc(c.playerName)} +${c.points}</small></span>`);
  el.innerHTML = parts.join('');
}

function stageKeyOf() {
  return [game.state, game.round, game.turnNo, game.state === 'turn' ? game.currentPlayer().id : '', armed, game.pending ? game.pending.word : '', contest ? Object.keys(contest.votes).length + ':' + contest.by : ''].join('~');
}

function renderStage() {
  const key = stageKeyOf();
  if (key === stageKey) return;
  stageKey = key;
  const el = document.getElementById('stage');

  if (game.state === 'lobby') {
    el.innerHTML = `<h3>Who's playing?</h3>
      <div class="settings">
        <label>Players <select id="s-count">${[2, 3, 4].map((n) => `<option value="${n}"${prefs.count === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        ${[0, 1, 2, 3].map((i) => `<label class="pname" data-i="${i}" ${i >= prefs.count ? 'hidden' : ''} style="--pc:${PLAYER_COLORS[i]}"><span class="swatch"></span>Player ${i + 1} <input id="s-name${i}" maxlength="18" placeholder="name" value="${esc(prefs.names[i] || '')}"></label>`).join('')}
        <label>Rounds <select id="s-rounds">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${prefs.rounds === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Clock per turn <select id="s-timer"><option value="0"${!prefs.timer ? ' selected' : ''}>none</option>${[30, 45, 60, 90, 120].map((n) => `<option value="${n}"${prefs.timer && prefs.turnSeconds === n ? ' selected' : ''}>${n} seconds</option>`).join('')}</select></label>
        <label>Sound <select id="s-sound"><option value="1"${prefs.sound !== false ? ' selected' : ''}>on</option><option value="0"${prefs.sound === false ? ' selected' : ''}>off</option></select></label>
      </div>
      <div class="row"><button class="btn blood big" id="startbtn">Deal the first word</button><span class="hint">Everyone plays on this screen. Pass it on your turn.</span></div>`;
    const cnt = document.getElementById('s-count');
    cnt.addEventListener('change', () => { const n = +cnt.value; for (const l of el.querySelectorAll('.pname')) l.hidden = +l.dataset.i >= n; });
    document.getElementById('startbtn').addEventListener('click', () => {
      prefs.count = +cnt.value;
      prefs.names = [0, 1, 2, 3].map((i) => document.getElementById(`s-name${i}`).value.trim());
      prefs.rounds = +document.getElementById('s-rounds').value;
      const t = +document.getElementById('s-timer').value;
      prefs.timer = t > 0;
      if (t > 0) prefs.turnSeconds = t;
      prefs.sound = document.getElementById('s-sound').value === '1';
      savePrefs();
      audio(); // unlock audio on this user gesture
      document.getElementById('sndbtn').textContent = prefs.sound === false ? '🔇' : '🔊';
      newGame();
      start();
    });
    return;
  }

  if (game.state === 'turn') {
    const p = game.currentPlayer();
    const prev = game.previousWord();
    if (!armed) {
      el.innerHTML = `<h3>Next up: ${esc(p.name)}</h3><p class="muted">Waiting for ${esc(p.name)} to take the screen.</p>`;
      return;
    }
    const u = usedBy(p.id);
    const canSource = game.chain.length > 0 && !u.source;
    const canDouble = !u.double;
    el.innerHTML = `<h3 style="color:${colorOf(p.id)}">${esc(p.name)}: your play</h3>
      <form class="playform" id="playform">
        <div class="lbl">1 · Connect to</div>
        <div class="seg" id="tseg">
          <button type="button" data-t="last" class="on">the last word<b>${esc(up(prev))}</b></button>
          <button type="button" data-t="source" ${canSource ? '' : 'disabled'}>the starting word<b>${esc(up(game.card.word))} · +${SOURCE_BONUS}${u.source ? ' · used' : ''}</b></button>
        </div>
        <div class="lbl">2 · Your word</div>
        <input class="word" id="pword" placeholder="your word" maxlength="40" autocomplete="off" required>
        <div class="lbl">3 · How it connects</div>
        <div class="seg" id="seg">${Object.entries(LINKS).map(([k, v]) => `<button type="button" data-link="${k}" class="${k === playLink ? 'on' : ''}" style="--c:${COLORS[k]}">${v.label}<b>${v.points} pt${v.points === 1 ? '' : 's'}</b></button>`).join('')}</div>
        <div class="hint" id="linkblurb">${esc(LINKS[playLink].blurb)}</div>
        <input id="pwhy" placeholder="say how, in one line" maxlength="160" autocomplete="off">
        <div class="lbl">4 · Stake</div>
        <label class="dbl ${canDouble ? '' : 'off'}"><input type="checkbox" id="pdbl" ${canDouble ? '' : 'disabled'}> Double or nothing${u.double ? ' (used this round)' : ''}<small>×2 if it stands, −${DOUBLE_PENALTY} if it's voted out. Once per round.</small></label>
        <div class="row"><button class="btn blood big" type="submit">Play it</button><span class="hint" id="worth"></span></div>
        <div class="err" id="perr"></div>
      </form>`;
    const worth = () => {
      const word = document.getElementById('pword').value.trim();
      const base = LINKS[playLink].points + (normalizeWord(word).length >= 8 ? LONG_BONUS : 0) + (Date.now() - game.turnStartedAt <= QUICK_MS ? QUICK_BONUS : 0) + (playTarget === 'source' ? SOURCE_BONUS : 0);
      document.getElementById('worth').textContent = `Worth ${playDouble ? base * 2 : base} if it stands${playDouble ? `, −${DOUBLE_PENALTY} if not` : ''}.`;
    };
    const tseg = document.getElementById('tseg');
    tseg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; playTarget = b.dataset.t; for (const x of tseg.children) x.classList.toggle('on', x === b); worth(); });
    const seg = document.getElementById('seg');
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      playLink = b.dataset.link;
      for (const x of seg.children) x.classList.toggle('on', x === b);
      document.getElementById('linkblurb').textContent = LINKS[playLink].blurb;
      worth();
    });
    document.getElementById('pdbl').addEventListener('change', (e) => { playDouble = e.target.checked; worth(); });
    document.getElementById('pword').addEventListener('input', worth);
    worth();
    document.getElementById('playform').addEventListener('submit', (e) => {
      e.preventDefault();
      const word = document.getElementById('pword').value.trim();
      const why = document.getElementById('pwhy').value.trim();
      if (!word) { document.getElementById('perr').textContent = 'Type a word.'; return; }
      if (playLink === 'idea' && !why) { document.getElementById('perr').textContent = 'Say how it connects, so the table can judge.'; return; }
      const err = play(word, playLink, why, playTarget, playDouble);
      if (err) document.getElementById('perr').textContent = err;
    });
    document.getElementById('pword').focus();
    return;
  }

  if (game.state === 'vote') {
    const pend = game.pending;
    const others = game.players.filter((p) => p.id !== pend.playerId);
    if (contest) {
      const by = game.player(contest.by);
      el.innerHTML = `<h3>Objection: does ${esc(up(pend.word))} stand?</h3>
        <p><b style="color:${colorOf(by.id)}">${esc(by.name)}</b> objects: “${esc(contest.why)}”. ${esc(pend.playerName)} claimed <b>${esc(LINKS[pend.link].label).toLowerCase()}</b>${pend.why ? `: “${esc(pend.why)}”` : ''}.</p>
        <div class="votes">${others.map((p) => `<div class="voter${p.id in contest.votes ? ' done' : ''}" style="border-left:3px solid ${colorOf(p.id)}"><span class="nm">${esc(p.name)}</span>${p.id in contest.votes ? `<span class="cast">${contest.votes[p.id] ? 'stands' : 'out'}</span>` : `<button class="btn formal" data-v="1" data-p="${p.id}">Stands</button><button class="btn blood" data-v="0" data-p="${p.id}">Out</button>`}</div>`).join('')}</div>
        <div class="hint">Everyone but ${esc(pend.playerName)} votes. A tie means it stands.</div>`;
      el.querySelector('.votes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) castVote(b.dataset.p, b.dataset.v === '1'); });
      return;
    }
    el.innerHTML = `<h3>Everyone else: does it hold?</h3>
      <p><b style="color:${colorOf(pend.playerId)}">${esc(pend.playerName)}</b> says <b>${esc(up(pend.word))}</b> connects to <b>${esc(up(pend.prev))}</b> by <b>${esc(LINKS[pend.link].label).toLowerCase()}</b>${pend.why ? `: “${esc(pend.why)}”` : ''}.</p>
      <div class="row" id="voterow"><button class="btn formal big" id="acc">Accept · +${pend.breakdown.total}</button><button class="btn blood big" id="chal">Object</button><span class="hint">Read the card. If nobody objects, accept and move on.</span></div>
      <form class="playform" id="objform" hidden>
        <div class="row"><label class="hint">Who objects? <select id="objby">${others.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div>
        <input id="objwhy" placeholder="why it doesn't hold (one line)" maxlength="160" autocomplete="off" required>
        <div class="row"><button class="btn blood" type="submit">Put it to a vote</button><button class="btn ghost" type="button" id="objcancel">Never mind</button></div>
      </form>`;
    document.getElementById('acc').addEventListener('click', () => judge(true));
    document.getElementById('chal').addEventListener('click', () => { document.getElementById('objform').hidden = false; document.getElementById('voterow').hidden = true; document.getElementById('objwhy').focus(); });
    document.getElementById('objcancel').addEventListener('click', () => { document.getElementById('objform').hidden = true; document.getElementById('voterow').hidden = false; });
    document.getElementById('objform').addEventListener('submit', (e) => { e.preventDefault(); const why = document.getElementById('objwhy').value.trim(); if (!why) return; openContest(document.getElementById('objby').value, why); });
    return;
  }

  if (game.state === 'ended') {
    el.innerHTML = `<h3>Game over</h3><div class="row"><button class="btn blood big" id="againbtn">Play again</button><button class="btn ghost" id="finalbtn">Scores</button></div>`;
    document.getElementById('againbtn').addEventListener('click', () => { newGame(); });
    document.getElementById('finalbtn').addEventListener('click', () => { overlay = 'final'; renderOverlay(); });
  }
}

function renderPlayers() {
  const el = document.getElementById('players');
  if (game.state === 'lobby') { el.innerHTML = ''; return; }
  const cur = game.state === 'turn' || game.state === 'vote' ? game.currentPlayer().id : null;
  const sorted = game.players.slice().sort((a, b) => b.score - a.score);
  el.innerHTML = `<h3>Scores</h3>` + sorted.map((p) => `
    <div class="player${p.id === cur ? ' current' : ''}">
      <div class="av" style="color:${colorOf(p.id)};border-color:${colorOf(p.id)}">${esc(initials(p.name))}</div>
      <div class="nm">${esc(p.name)}${p.id === cur ? '<span class="you">up now</span>' : ''}</div>
      <div class="sc">${p.score}</div>
    </div>`).join('');
}

function renderHowto() {
  const el = document.getElementById('howto');
  el.innerHTML = `<h3>How to score</h3>
    <div class="how">${Object.entries(LINKS).map(([k, v]) => `<div class="howrow"><span class="dot" style="background:${COLORS[k]}"></span><b>${esc(v.label)}</b><span class="pts">${v.points}</span><small>${esc(v.blurb)}</small></div>`).join('')}
    <div class="howrow"><span class="dot" style="background:#777"></span><b>Long word</b><span class="pts">+1</span><small>Eight letters or more.</small></div>
    <div class="howrow"><span class="dot" style="background:#777"></span><b>Quick</b><span class="pts">+1</span><small>Played within 15 seconds.</small></div>
    <div class="howrow"><span class="dot" style="background:#777"></span><b>Root run</b><span class="pts">+${ROOT_RUN_BONUS}</span><small>Three roots in a row. Paid at the end of the round to whoever completes it.</small></div>
    <div class="howrow"><span class="dot" style="background:#777"></span><b>Homecoming</b><span class="pts">+${HOMECOMING_BONUS}</span><small>Your word turns out to be a real relative of the starting word. Revealed at the end.</small></div></div>`;
}

// The round's family tree: the starting word, its real relatives, and where the played words landed.
function treeSvg(card, chain) {
  const W = 600;
  const rel = card.cousins.slice(0, 8);
  const played = chain.slice(0, 12);
  const relSet = new Set(rel.map(normalizeWord));
  const rowY = (i) => 120 + i * 34;
  const H = Math.max(rowY(Math.max(rel.length, played.length)) + 10, 200);
  const p = paletteFor(card.cat);
  let s = `<svg class="tree" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Share Tech Mono, monospace" font-size="13">`;
  s += `<defs><filter id="g"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  s += `<text x="${W / 2}" y="44" text-anchor="middle" fill="${p.ink}" font-size="26" font-family="Cinzel, serif" font-weight="700" letter-spacing="4" filter="url(#g)">${esc(up(card.word))}</text>`;
  s += `<line x1="${W / 2}" y1="54" x2="${W / 2}" y2="84" stroke="${p.ink}" stroke-width="1.5"/>`;
  s += `<line x1="150" y1="84" x2="${W - 150}" y2="84" stroke="${p.ink}" stroke-width="1.5"/>`;
  s += `<line x1="150" y1="84" x2="150" y2="100" stroke="${p.ink}" stroke-width="1.5"/><line x1="${W - 150}" y1="84" x2="${W - 150}" y2="100" stroke="${p.ink}" stroke-width="1.5"/>`;
  s += `<text x="150" y="112" text-anchor="middle" fill="${p.ink}" opacity=".8" letter-spacing="2">REAL FAMILY</text>`;
  s += `<text x="${W - 150}" y="112" text-anchor="middle" fill="#c9b8d0" opacity=".9" letter-spacing="2">PLAYED</text>`;
  rel.forEach((r, i) => { s += `<text x="150" y="${rowY(i) + 12}" text-anchor="middle" fill="${p.ink}" font-size="15">${esc(up(r))}</text>`; });
  if (!rel.length) s += `<text x="150" y="${rowY(0) + 12}" text-anchor="middle" fill="${p.ink}" opacity=".6">none on file</text>`;
  played.forEach((c, i) => {
    const home = relSet.has(normalizeWord(c.word));
    const col = COLORS[c.link];
    s += `<line x1="${W - 150}" y1="${rowY(i) + 8}" x2="${W - 150 - 20}" y2="${rowY(i) + 8}" stroke="${col}" stroke-width="2"/>`;
    s += `<text x="${W - 150}" y="${rowY(i) + 12}" text-anchor="middle" fill="${home ? p.ink : '#e6dcf0'}" font-size="15" ${home ? `filter="url(#g)"` : ''}>${esc(up(c.word))}${home ? ' ★' : ''}</text>`;
    s += `<text x="${W - 40}" y="${rowY(i) + 12}" text-anchor="end" fill="${colorOf(c.playerId)}" font-size="11">${esc(c.playerName)}</text>`;
    if (home) s += `<line x1="${150 + 70}" y1="${rowY(rel.findIndex((r) => normalizeWord(r) === normalizeWord(c.word))) + 8}" x2="${W - 150 - 70}" y2="${rowY(i) + 8}" stroke="${p.ink}" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`;
  });
  return s + '</svg>';
}

function renderOverlay() {
  const el = document.getElementById('overlay');
  if (!el) return;
  if (!overlay) { el.innerHTML = ''; return; }
  if (overlay === 'intro' && game.state === 'turn') {
    const order = turnOrder();
    const opener = order[0];
    const counts = deckCounts();
    const decks = Object.entries(counts).filter(([cat, n]) => n > 0 && cat !== 'misc').sort((a, b) => b[1] - a[1]);
    el.innerHTML = `<div class="overlay" id="ov"><div class="sheet wide" style="border-color:${colorOf(opener.id)}">
      <div class="passlbl">Round ${game.round} of ${game.settings.rounds}</div>
      <h2 style="color:${colorOf(opener.id)};text-shadow:0 0 14px ${colorOf(opener.id)}">${esc(opener.name)} picks the deck</h2>
      <div class="sub">${game.totalTurns()} turns, two each. Order: ${order.map((q) => `<span style="color:${colorOf(q.id)}">${esc(q.name)}</span>`).join(' → ')}.</div>
      <div class="decks" id="decks">${decks.map(([cat, n]) => { const p = paletteFor(cat); return `<button type="button" class="deck" data-cat="${cat}" style="--dk:${p.ink};--db:${p.band}"><span class="dart">${plateArt(cat)}</span><span class="dname">${esc(p.name)}</span><span class="dn">${n} left</span></button>`; }).join('')}</div>
      <div class="rules"><p>Each turn: <b>pass</b> the screen, <b>play</b> a word, the <b>table</b> judges, the <b>verdict</b> is stamped. Once a round each player may connect back to the starting word (+${SOURCE_BONUS}) and may double one play.</p></div>
      <div class="row"><button class="btn blood big" id="dealbtn">Surprise me</button></div>
    </div></div>`;
    document.getElementById('decks').addEventListener('click', (e) => { const b = e.target.closest('button.deck'); if (b) chooseDeck(b.dataset.cat); });
    document.getElementById('dealbtn').addEventListener('click', () => chooseDeck(null));
    return;
  }
  if (overlay === 'pass' && game.state === 'turn') {
    const p = game.currentPlayer();
    const prev = game.previousWord();
    el.innerHTML = `<div class="overlay pass" id="ov"><div class="sheet passsheet" style="--pc:${colorOf(p.id)}">
      <div class="passlbl">Pass the screen to</div>
      <h2 style="color:${colorOf(p.id)};text-shadow:0 0 14px ${colorOf(p.id)}">${esc(p.name)}</h2>
      <div class="sub">Connect a word to <b>${esc(up(prev))}</b>.${prefs.timer ? ` The clock starts when you press the button.` : ''}</div>
      <div class="row"><button class="btn big pc" id="readybtn">I'm ${esc(p.name)}, go</button></div>
    </div></div>`;
    document.getElementById('readybtn').addEventListener('click', ready);
    return;
  }
  if (overlay === 'round' && lastRound) {
    const r = lastRound;
    const p = paletteFor(r.card.cat);
    el.innerHTML = `<div class="overlay" id="ov"><div class="sheet wide">
      <h2>Round ${r.round}: the file opens</h2>
      <div class="sub">${[up(r.card.word)].concat(r.chain.map((c) => up(c.word))).map(esc).join(' → ')}</div>
      <div class="cousins" style="border-left:3px solid ${p.band}"><b>${esc(up(r.card.word))}.</b> ${esc(r.card.origin)}</div>
      ${treeSvg(r.card, r.chain)}
      ${r.bonuses.length ? `<div class="cousins"><b>Bonuses.</b> ${r.bonuses.map((b) => `<span style="color:${colorOf(b.playerId)}">${esc(b.name)}</span> +${b.points}, ${esc(b.why)}`).join('. ')}.</div>` : ''}
      <div class="board">${r.deltas.slice().sort((a, b) => b.delta - a.delta).map((d) => `<div class="r"><span class="n"></span><span style="color:${colorOf(d.id)}">${esc(d.name)}</span><span class="pts">+${d.delta}</span></div>`).join('')}</div>
      <div class="row"><button class="btn blood" id="ovnext">${game.state === 'ended' ? 'Final scores' : 'Next word'}</button></div>
    </div></div>`;
    document.getElementById('ovnext').addEventListener('click', () => { lastRound = null; overlay = game.state === 'ended' ? 'final' : (game.state === 'turn' && !armed ? 'intro' : null); renderOverlay(); });
    return;
  }
  if (overlay === 'final' && final) {
    const f = final;
    el.innerHTML = `<div class="overlay" id="ov"><div class="sheet">
      <h2>${f.winners.length === 1 ? `${esc(f.winners[0])} wins` : `Tie: ${f.winners.map(esc).join(' and ')}`}</h2>
      <div class="board">${f.scoreboard.map((p, i) => `<div class="r${f.winners.includes(p.name) ? ' win' : ''}"><span class="n">${i + 1}</span><span style="color:${colorOf(p.id)}">${esc(p.name)}<small>${[p.best ? `best word ${up(p.best.word)}` : '', p.rejected ? `${p.rejected} thrown out` : ''].filter(Boolean).join(' · ')}</small></span><span class="pts">${p.score}</span></div>`).join('')}</div>
      <div class="row"><button class="btn blood" id="ovagain">Play again</button><button class="btn ghost" id="ovclose">Close</button></div>
    </div></div>`;
    document.getElementById('ovagain').addEventListener('click', () => { overlay = null; newGame(); });
  } else if (overlay === 'rules') {
    el.innerHTML = `<div class="overlay" id="ov"><div class="sheet">
      <h2>How to play</h2>
      <div class="rules">
        <p><b>1.</b> The player who opens the round picks a deck, or takes a surprise. A word comes up on a card. Where it came from stays sealed until the round ends; you get its crossword clue as a hint.</p>
        <p><b>2.</b> On your turn, type a word that connects to the last word in the chain, and pick how:</p>
        <p><span class="dot" style="background:${COLORS.root}"></span> <b>Same root</b> (3 points): it grew from the same ancient word.<br>
        <span class="dot" style="background:${COLORS.letters}"></span> <b>Same sound</b> (2 points): rhyme, homophone, anagram, or a pun. Sharing a few letters is not enough; if the resemblance comes from a shared history, that's a root claim.<br>
        <span class="dot" style="background:${COLORS.idea}"></span> <b>Same idea</b> (1 point): it goes with the word. Say how in one line.</p>
        <p><b>3.</b> Everyone else looks at the play. The card shows the new word's definition and origin from the dictionary to help. If nobody objects, press Accept. If someone does, they say who they are and why, and everyone but the player votes: stands or out. A tie stands. A word voted out scores nothing.</p>
        <p><b>4.</b> +1 for a word of eight letters or more. +1 for playing within 15 seconds. No word twice in a game. Running out the clock scores nothing.</p>
        <p><b>Choices.</b> Each turn you connect to the <b>last word</b> or, once per round, back to the <b>starting word</b> for +${SOURCE_BONUS}. Once per round you may <b>double</b> a play: twice the points if it stands, −${DOUBLE_PENALTY} if it's voted out.</p>
        <p><b>5.</b> When the round ends the file opens: the word's true origin, its real relatives, and a family tree of what was played. Three roots in a row in the chain pay +${ROOT_RUN_BONUS} to whoever completed the run. A played word that turns out to be a real relative of the starting word pays +${HOMECOMING_BONUS}.</p>
        <p><b>6.</b> Two turns each per word. After all rounds, most points wins. Nothing is filtered.</p>
      </div>
      <div class="row"><button class="btn" id="ovclose">Close</button></div>
    </div></div>`;
  } else { el.innerHTML = ''; return; }
  const close = document.getElementById('ovclose');
  if (close) close.addEventListener('click', () => { overlay = null; renderOverlay(); });
  document.getElementById('ov').addEventListener('click', (e) => { if (e.target.id === 'ov' && overlay !== 'round' && overlay !== 'pass' && overlay !== 'intro') { overlay = null; renderOverlay(); } });
}

newGame();
