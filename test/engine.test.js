'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/engine');
const { parsePlay, normalizeWord } = require('../src/parse');
const { scorePlay, letterScore, LINKS } = require('../src/scoring');
const CARDS = require('../src/cards');

// Deterministic rng: mulberry32
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = 1_000_000;
const types = (events) => events.map((e) => e.type);

function threePlayerGame(settings = {}) {
  const g = new Game({ channelId: 'c', hostId: 'a', settings: { clueMode: 'never', ...settings }, rng: rng(7) });
  g.addPlayer('a', 'Ada');
  g.addPlayer('b', 'Bob');
  g.addPlayer('c', 'Cy');
  return g;
}

test('cards are well formed and unique', () => {
  const seen = new Set();
  for (const c of CARDS) {
    assert.ok(c.word && c.origin && c.clue, `card missing fields: ${JSON.stringify(c)}`);
    assert.ok(Array.isArray(c.cousins));
    assert.equal(c.word, c.word.toLowerCase());
    assert.ok(!seen.has(c.word), `duplicate card ${c.word}`);
    seen.add(c.word);
  }
  assert.ok(CARDS.length >= 100);
});

test('parsePlay accepts the documented forms and ignores chat', () => {
  assert.deepEqual(parsePlay('salary: paid in salt'), { ok: true, word: 'salary', link: 'meaning', why: 'paid in salt' });
  assert.deepEqual(parsePlay('salary - paid in salt'), { ok: true, word: 'salary', link: 'meaning', why: 'paid in salt' });
  assert.deepEqual(parsePlay('salary #root Latin sal'), { ok: true, word: 'salary', link: 'root', why: 'Latin sal' });
  assert.deepEqual(parsePlay('salary#root Latin sal'), { ok: true, word: 'salary', link: 'root', why: 'Latin sal' });
  assert.deepEqual(parsePlay('"ice cream": cold, sweet'), { ok: true, word: 'ice cream', link: 'meaning', why: 'cold, sweet' });
  assert.deepEqual(parsePlay('lastly: anagram #form of saltly'), { ok: true, word: 'lastly', link: 'form', why: 'anagram of saltly' });
  assert.equal(parsePlay('hold on a second').silent, true);
  assert.equal(parsePlay('lol').silent, true);
  assert.equal(parsePlay('salary:').ok, false);
  assert.equal(parsePlay('salary:').silent, undefined);
  assert.equal(parsePlay('123: numbers').ok, false);
});

test('normalizeWord folds case, accents and punctuation', () => {
  assert.equal(normalizeWord('Café'), 'cafe');
  assert.equal(normalizeWord("don't"), 'dont');
  assert.equal(normalizeWord('Ice Cream'), 'icecream');
});

test('scoring math', () => {
  assert.equal(letterScore('quiz'), 22);
  const b = scorePlay({ word: 'sarcophagus', link: 'root', tiles: ['s', 'x', 'q'], elapsedMs: 5000, fastMs: 15000 });
  assert.equal(b.letters, 19); // s1 a1 r1 c3 o1 p3 h4 a1 g2 u1 s1
  assert.equal(b.linkPoints, 38);
  assert.equal(b.tileUsed, 's');
  assert.equal(b.speedBonus, 3);
  assert.equal(b.lengthBonus, 5);
  assert.equal(b.total, 51);
  const f = scorePlay({ word: 'salad', link: 'form', tiles: [], elapsedMs: 30000, fastMs: 15000 });
  assert.equal(f.linkPoints, Math.round(6 * LINKS.form.mult));
  assert.equal(f.total, 9);
});

test('full game: turns rotate, votes resolve, tiles replace, rounds and game end', () => {
  const g = threePlayerGame({ rounds: 2, turnsPerPlayer: 1 });
  const start = g.start(T0);
  assert.ok(start.ok);
  assert.deepEqual(types(start.events), ['gameStart', 'roundStart', 'turn']);
  assert.equal(g.state, 'turn');
  for (const p of g.players) assert.equal(p.tiles.length, 3);
  assert.equal(g.currentPlayer().id, 'a');

  // Ada plays fast with a tile letter for the bonus.
  const ada = g.player('a');
  const tile = ada.tiles[0];
  const word = `${tile}xylophone`;
  const sub = g.submit('a', `${word}: shares nothing, vibes only`, T0 + 3000);
  assert.ok(sub.ok, sub.error);
  assert.equal(g.state, 'vote');
  assert.equal(sub.events[0].type, 'pending');
  assert.equal(sub.events[0].play.breakdown.tileUsed, tile);

  // Ada may not vote on her own play; a wrong voter is refused.
  assert.equal(g.vote('a', true, T0 + 4000).ok, false);
  assert.equal(g.vote('zz', true, T0 + 4000).ok, false);

  // Bob accepts, Cy accepts -> resolved.
  const v1 = g.vote('b', true, T0 + 5000);
  assert.equal(v1.resolved, false);
  const v2 = g.vote('c', true, T0 + 6000);
  assert.equal(v2.resolved, true);
  assert.deepEqual(types(v2.events), ['accepted', 'turn']);
  const acc = v2.events[0];
  assert.equal(acc.breakdown.total, ada.score);
  assert.equal(ada.tiles.length, 3);
  assert.ok(!ada.tiles.includes(tile) || ada.tiles.filter((t) => t === tile).length < 1 + (acc.tiles.filter((t) => t === tile).length - 0), 'tile replaced');
  assert.equal(g.currentPlayer().id, 'b');
  assert.equal(g.previousWord(), word);

  // Bob reuses the specimen word: refused. Then plays; Cy alone challenges -> 1 of 2 others, 1 > 0 accepts: rejected.
  assert.equal(g.submit('b', `${g.card.word}: same word`, T0 + 7000).ok, false);
  const bob = g.player('b');
  const sub2 = g.submit('b', 'nonsense #root made up', T0 + 8000);
  assert.ok(sub2.ok);
  const v3 = g.vote('c', false, T0 + 9000);
  assert.equal(v3.resolved, false);
  const exp = g.voteExpired(T0 + 30000);
  assert.deepEqual(types(exp), ['rejected', 'turn']);
  assert.equal(bob.score, -2);
  assert.equal(g.previousWord(), word, 'chain does not advance on rejection');
  assert.equal(g.currentPlayer().id, 'c');

  // Cy times out -> round 1 ends (3 turns), round 2 begins with Bob starting.
  const cy = g.player('c');
  const to = g.turnExpired(T0 + 60000);
  assert.deepEqual(types(to), ['timeout', 'roundEnd', 'roundStart', 'turn']);
  assert.equal(cy.score, -1);
  assert.equal(g.round, 2);
  assert.equal(g.currentPlayer().id, 'b');
  assert.equal(g.chain.length, 0);

  // Round 2: everyone times out; game ends with Ada winning.
  g.turnExpired(T0 + 70000);
  g.turnExpired(T0 + 80000);
  const fin = g.turnExpired(T0 + 90000);
  assert.deepEqual(types(fin), ['timeout', 'roundEnd', 'gameEnd']);
  assert.equal(g.state, 'ended');
  const end = fin[2];
  assert.equal(end.winners.length, 1);
  assert.equal(end.winners[0].id, 'a');
  assert.equal(end.scoreboard[0].id, 'a');
  assert.equal(g.timerFor(), null);
});

test('clue rounds: correct guess pays, wrong guess is silent, expiry reveals', () => {
  const g = threePlayerGame({ clueMode: 'always', rounds: 1, turnsPerPlayer: 1 });
  const st = g.start(T0);
  assert.deepEqual(types(st.events), ['gameStart', 'roundStart', 'clue']);
  assert.equal(g.state, 'clue');
  assert.equal(g.timerFor(), g.settings.clueSeconds * 1000);
  const wrong = g.guess('b', 'definitely not', T0 + 1000);
  assert.equal(wrong[0].type, 'wrongGuess');
  assert.equal(g.state, 'clue');
  const right = g.guess('c', ` ${g.card.word.toUpperCase()} `, T0 + 2000);
  assert.deepEqual(types(right), ['clueSolved', 'turn']);
  assert.equal(g.player('c').score, 5);
  assert.equal(g.state, 'turn');

  const g2 = threePlayerGame({ clueMode: 'always', rounds: 1, turnsPerPlayer: 1 });
  g2.start(T0);
  const ex = g2.clueExpired(T0 + 40000);
  assert.deepEqual(types(ex), ['clueMissed', 'turn']);
});

test('mixed clue mode alternates: word on odd cases, clue on even', () => {
  const g = threePlayerGame({ clueMode: 'mixed', rounds: 2, turnsPerPlayer: 1 });
  g.start(T0);
  assert.equal(g.mode, 'word');
  g.turnExpired(T0); g.turnExpired(T0); g.turnExpired(T0);
  assert.equal(g.round, 2);
  assert.equal(g.mode, 'clue');
});

test('rejection threshold: ceil(others/2) challenges that outnumber accepts', () => {
  const g = new Game({ channelId: 'c', hostId: 'a', settings: { clueMode: 'never' }, rng: rng(1) });
  ['a', 'b', 'c', 'd', 'e'].forEach((id) => g.addPlayer(id, id));
  g.start(T0);
  g.submit('a', 'thing: stuff', T0);
  g.vote('b', false, T0); g.vote('c', true, T0); g.vote('d', true, T0);
  // 1 challenge of 4 others: stands
  const r = g.voteExpired(T0);
  assert.equal(r[0].type, 'accepted');
  g.submit('b', 'other: stuff', T0);
  g.vote('a', false, T0); g.vote('c', false, T0); g.vote('d', true, T0);
  // 2 challenges >= ceil(4/2) and 2 > 1: rejected
  const r2 = g.voteExpired(T0);
  assert.equal(r2[0].type, 'rejected');
  g.submit('c', 'third: stuff', T0);
  g.vote('a', false, T0); g.vote('b', false, T0); g.vote('d', true, T0); g.vote('e', true, T0);
  // 2-2 tie: stands
  assert.equal(g.state, 'turn'); // resolved automatically when all 4 voted
  assert.equal(g.chain.length, 2);
});

test('solo game: plays resolve without voters, timer still enforced', () => {
  const g = new Game({ channelId: 'c', hostId: 'a', settings: { clueMode: 'never', rounds: 1, turnsPerPlayer: 2 }, rng: rng(3) });
  g.addPlayer('a', 'Solo');
  g.start(T0);
  const s = g.submit('a', 'alone: obviously', T0 + 1000);
  assert.equal(g.state, 'vote');
  assert.equal(s.events[0].voters.length, 0);
  const r = g.voteExpired(T0 + 2000);
  assert.equal(r[0].type, 'accepted');
  assert.equal(g.state, 'turn');
});

test('player leaving mid-turn advances the table; last player leaving ends it', () => {
  const g = threePlayerGame({ rounds: 1, turnsPerPlayer: 1 });
  g.start(T0);
  assert.equal(g.currentPlayer().id, 'a');
  const res = g.removePlayer('a', T0);
  assert.ok(res.ok);
  assert.equal(g.players.length, 2);
  assert.equal(g.currentPlayer().id, 'b');
  assert.equal(g.state, 'turn');
  // A non-current player leaving does not disturb the turn.
  g.removePlayer('c', T0);
  assert.equal(g.players.length, 1);
  assert.equal(g.currentPlayer().id, 'b');
  assert.equal(g.state, 'turn');
  // The last player leaving abandons the examination.
  const last = g.removePlayer('b', T0);
  assert.equal(last.events.at(-1).type, 'gameEnd');
  assert.equal(last.events.at(-1).aborted, true);
  assert.equal(g.state, 'ended');
});

test('lobby guards', () => {
  const g = new Game({ channelId: 'c', hostId: 'a', settings: { maxPlayers: 2 } });
  assert.equal(g.start(T0).ok, false);
  g.addPlayer('a', 'a');
  assert.equal(g.addPlayer('a', 'a').ok, false);
  g.addPlayer('b', 'b');
  assert.equal(g.addPlayer('c', 'c').ok, false);
  g.start(T0);
  assert.equal(g.addPlayer('d', 'd').ok, false);
  assert.equal(g.start(T0).ok, false);
});

test('phaseId changes on every state transition so stale timers can be discarded', () => {
  const g = threePlayerGame({ rounds: 1, turnsPerPlayer: 1 });
  g.start(T0);
  const p1 = g.phaseId;
  g.submit('a', 'word: reason', T0);
  const p2 = g.phaseId;
  assert.notEqual(p1, p2);
  g.voteExpired(T0);
  assert.notEqual(g.phaseId, p2);
});
