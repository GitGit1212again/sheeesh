'use strict';

// Pure game state machine. No Discord here. Every mutation returns a list of events for the
// transport layer to render, and timerFor() tells the transport what deadline to enforce.

const {
  scorePlay, makeBag, CLUE_BONUS, REJECT_PENALTY, TIMEOUT_PENALTY,
} = require('./scoring');
const { parsePlay, normalizeWord } = require('./parse');
const CARDS = require('./cards');

const DEFAULTS = {
  turnSeconds: 45,
  voteSeconds: 15,
  clueSeconds: 30,
  rounds: 3,
  turnsPerPlayer: 2,
  clueMode: 'mixed', // 'mixed' | 'always' | 'never'
  handSize: 3,
  fastSeconds: 15,
  maxPlayers: 12,
};

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Game {
  constructor({ channelId, hostId, settings = {}, cards = CARDS, rng = Math.random } = {}) {
    this.channelId = channelId;
    this.hostId = hostId;
    this.settings = { ...DEFAULTS, ...settings };
    this.rng = rng;
    this.allCards = cards;
    this.deck = shuffle(cards.slice(), rng);
    this.players = [];
    this.state = 'lobby'; // lobby | clue | turn | vote | ended
    this.phaseId = 0; // bumps on every state change; transport uses it to discard stale timers
    this.round = 0;
    this.card = null;
    this.mode = 'word';
    this.chain = [];
    this.turnNo = 0;
    this.currentIdx = 0;
    this.turnStartedAt = 0;
    this.pending = null;
    this.usedWords = new Set();
    this.bag = makeBag(rng);
    this.roundStartScores = {};
  }

  // ---- players ----
  player(id) {
    return this.players.find((p) => p.id === id);
  }

  addPlayer(id, name) {
    if (this.state !== 'lobby') return { ok: false, error: 'The examination is already under way. Wait for the next body.' };
    if (this.player(id)) return { ok: false, error: 'You are already on the table.' };
    if (this.players.length >= this.settings.maxPlayers) return { ok: false, error: 'The morgue is full.' };
    this.players.push({ id, name, score: 0, tiles: [], accepted: 0, rejected: 0, timeouts: 0, clues: 0, best: null });
    return { ok: true };
  }

  removePlayer(id, now = Date.now()) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx < 0) return { ok: false, error: 'You were never here.' };
    const [gone] = this.players.splice(idx, 1);
    const events = [{ type: 'left', player: gone }];
    if (this.state === 'lobby' || this.state === 'ended') return { ok: true, events };
    if (this.players.length === 0) return { ok: true, events: events.concat(this.abort('everyone left')) };
    if (this.state === 'vote' && this.pending) {
      this.pending.votes.delete(id);
      if (this.pending.playerId === id) {
        this.pending = null;
        this.currentIdx = ((idx - 1) + this.players.length) % this.players.length;
        return { ok: true, events: events.concat(this.advance(now)) };
      }
      if (this.pending.votes.size >= this.players.length - 1) return { ok: true, events: events.concat(this.resolveVote(now)) };
      return { ok: true, events };
    }
    if (idx < this.currentIdx) this.currentIdx -= 1;
    else if (idx === this.currentIdx && this.state === 'turn') {
      this.currentIdx = ((idx - 1) + this.players.length) % this.players.length;
      return { ok: true, events: events.concat(this.advance(now)) };
    }
    this.currentIdx %= this.players.length;
    return { ok: true, events };
  }

  // ---- lifecycle ----
  setState(s) {
    this.state = s;
    this.phaseId += 1;
  }

  start(now = Date.now()) {
    if (this.state !== 'lobby') return { ok: false, error: 'Already started.' };
    if (this.players.length < 1) return { ok: false, error: 'No one to examine.' };
    for (const p of this.players) p.tiles = this.drawTiles(this.settings.handSize);
    const events = [{ type: 'gameStart', players: this.players.slice(), settings: { ...this.settings } }];
    return { ok: true, events: events.concat(this.beginRound(now)) };
  }

  drawTiles(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (this.bag.length === 0) this.bag = makeBag(this.rng);
      out.push(this.bag.pop());
    }
    return out;
  }

  drawCard() {
    if (this.deck.length === 0) this.deck = shuffle(this.allCards.slice(), this.rng);
    return this.deck.pop();
  }

  beginRound(now) {
    this.round += 1;
    this.chain = [];
    this.turnNo = 0;
    this.pending = null;
    this.card = this.drawCard();
    const cm = this.settings.clueMode;
    this.mode = cm === 'always' ? 'clue' : cm === 'never' ? 'word' : (this.round % 2 === 0 ? 'clue' : 'word');
    this.roundStartScores = Object.fromEntries(this.players.map((p) => [p.id, p.score]));
    this.currentIdx = (this.round - 1) % this.players.length;
    this.usedWords.add(normalizeWord(this.card.word));
    const events = [{ type: 'roundStart', round: this.round, rounds: this.settings.rounds, card: this.card, mode: this.mode }];
    if (this.mode === 'clue') {
      this.setState('clue');
      events.push({ type: 'clue', clue: this.card.clue, length: this.card.word.length, seconds: this.settings.clueSeconds, bonus: CLUE_BONUS });
      return events;
    }
    return events.concat(this.startTurn(now));
  }

  startTurn(now) {
    this.setState('turn');
    this.turnStartedAt = now;
    this.pending = null;
    const p = this.currentPlayer();
    return [{
      type: 'turn',
      player: p,
      prev: this.previousWord(),
      tiles: p.tiles.slice(),
      seconds: this.settings.turnSeconds,
      turnNo: this.turnNo + 1,
      totalTurns: this.totalTurns(),
      round: this.round,
    }];
  }

  currentPlayer() {
    return this.players[this.currentIdx];
  }

  previousWord() {
    return this.chain.length ? this.chain[this.chain.length - 1].word : this.card.word;
  }

  totalTurns() {
    return this.settings.turnsPerPlayer * this.players.length;
  }

  // ---- clue phase ----
  guess(playerId, text, now = Date.now()) {
    if (this.state !== 'clue') return [];
    const p = this.player(playerId);
    if (!p) return [];
    if (normalizeWord(text) !== normalizeWord(this.card.word)) return [{ type: 'wrongGuess', player: p, text }];
    p.score += CLUE_BONUS;
    p.clues += 1;
    const events = [{ type: 'clueSolved', player: p, card: this.card, bonus: CLUE_BONUS }];
    return events.concat(this.startTurn(now));
  }

  clueExpired(now = Date.now()) {
    if (this.state !== 'clue') return [];
    return [{ type: 'clueMissed', card: this.card }].concat(this.startTurn(now));
  }

  // ---- turn phase ----
  submit(playerId, raw, now = Date.now()) {
    if (this.state !== 'turn') return { ok: false, silent: true, error: 'Nothing is on the table right now.' };
    const p = this.currentPlayer();
    if (p.id !== playerId) return { ok: false, silent: true, error: `It is ${p.name}'s turn, not yours.` };
    const parsed = parsePlay(raw);
    if (!parsed.ok) return { ok: false, silent: !!parsed.silent, error: parsed.error };
    const { word, link, why } = parsed;
    const norm = normalizeWord(word);
    if (this.usedWords.has(norm)) return { ok: false, error: `${word.toUpperCase()} has already been dissected this game. Find another.` };
    const elapsedMs = now - this.turnStartedAt;
    const breakdown = scorePlay({ word, link, tiles: p.tiles, elapsedMs, fastMs: this.settings.fastSeconds * 1000 });
    this.pending = {
      playerId: p.id, playerName: p.name, word, link, why, prev: this.previousWord(),
      breakdown, votes: new Map(), submittedAt: now, elapsedMs,
    };
    this.setState('vote');
    const voters = this.players.filter((x) => x.id !== p.id);
    return { ok: true, events: [{ type: 'pending', player: p, play: this.pending, seconds: this.settings.voteSeconds, voters }] };
  }

  turnExpired(now = Date.now()) {
    if (this.state !== 'turn') return [];
    const p = this.currentPlayer();
    p.score += TIMEOUT_PENALTY;
    p.timeouts += 1;
    return [{ type: 'timeout', player: p, penalty: TIMEOUT_PENALTY, seconds: this.settings.turnSeconds }].concat(this.advance(now));
  }

  // ---- vote phase ----
  vote(playerId, accept, now = Date.now()) {
    if (this.state !== 'vote' || !this.pending) return { ok: false, error: 'Nothing to judge right now.' };
    const p = this.player(playerId);
    if (!p) return { ok: false, error: 'You are not in this game.' };
    if (playerId === this.pending.playerId) return { ok: false, error: 'You do not get to judge your own work.' };
    this.pending.votes.set(playerId, !!accept);
    const others = this.players.length - 1;
    if (this.pending.votes.size >= others) return { ok: true, resolved: true, events: this.resolveVote(now) };
    return { ok: true, resolved: false, events: [] };
  }

  voteExpired(now = Date.now()) {
    if (this.state !== 'vote') return [];
    return this.resolveVote(now);
  }

  tally() {
    let accepts = 0;
    let challenges = 0;
    for (const v of this.pending.votes.values()) (v ? accepts++ : challenges++);
    const others = this.players.length - 1;
    const rejected = others > 0 && challenges >= Math.ceil(others / 2) && challenges > accepts;
    return { accepts, challenges, others, rejected };
  }

  resolveVote(now) {
    const pend = this.pending;
    const p = this.player(pend.playerId);
    const { accepts, challenges, rejected } = this.tally();
    let events;
    if (rejected) {
      p.score += REJECT_PENALTY;
      p.rejected += 1;
      events = [{ type: 'rejected', player: p, play: pend, accepts, challenges, penalty: REJECT_PENALTY, prev: this.previousWord() }];
    } else {
      const b = pend.breakdown;
      p.score += b.total;
      p.accepted += 1;
      if (b.tileUsed) {
        const i = p.tiles.indexOf(b.tileUsed);
        if (i >= 0) p.tiles.splice(i, 1);
        p.tiles.push(...this.drawTiles(1));
      }
      this.chain.push({ word: pend.word, link: pend.link, why: pend.why, playerId: p.id, playerName: p.name, points: b.total });
      this.usedWords.add(normalizeWord(pend.word));
      if (!p.best || b.total > p.best.points) p.best = { word: pend.word, points: b.total, link: pend.link };
      events = [{ type: 'accepted', player: p, play: pend, breakdown: b, accepts, challenges, tiles: p.tiles.slice() }];
    }
    this.pending = null;
    return events.concat(this.advance(now));
  }

  // ---- progression ----
  advance(now) {
    this.turnNo += 1;
    if (this.turnNo >= this.totalTurns()) return this.endRound(now);
    this.currentIdx = (this.currentIdx + 1) % this.players.length;
    return this.startTurn(now);
  }

  endRound(now) {
    const deltas = this.players.map((p) => ({ player: p, delta: p.score - (this.roundStartScores[p.id] ?? 0) }));
    const events = [{
      type: 'roundEnd', round: this.round, rounds: this.settings.rounds, card: this.card,
      chain: this.chain.slice(), deltas, scoreboard: this.scoreboard(),
    }];
    if (this.round >= this.settings.rounds) return events.concat(this.finish());
    return events.concat(this.beginRound(now));
  }

  finish() {
    this.setState('ended');
    const board = this.scoreboard();
    const top = board.length ? board[0].score : 0;
    const winners = board.filter((p) => p.score === top);
    return [{ type: 'gameEnd', scoreboard: board, winners, rounds: this.round }];
  }

  abort(reason = 'the host called it') {
    if (this.state === 'ended') return [];
    this.setState('ended');
    return [{ type: 'gameEnd', scoreboard: this.scoreboard(), winners: [], rounds: this.round, aborted: true, reason }];
  }

  skip(now = Date.now()) {
    switch (this.state) {
      case 'clue': return this.clueExpired(now);
      case 'turn': return this.turnExpired(now);
      case 'vote': return this.resolveVote(now);
      default: return [];
    }
  }

  scoreboard() {
    return this.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  timerFor() {
    switch (this.state) {
      case 'clue': return this.settings.clueSeconds * 1000;
      case 'turn': return this.settings.turnSeconds * 1000;
      case 'vote': return this.settings.voteSeconds * 1000;
      default: return null;
    }
  }
}

module.exports = { Game, DEFAULTS };
