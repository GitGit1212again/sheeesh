'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { judgeWord } = require('../src/match');
const FAMILIES = require('../src/families');
const card = FAMILIES.find((f) => f.word === 'salary');
const hosp = FAMILIES.find((f) => f.word === 'hospital');
const kind = (c, w, prev = []) => judgeWord(c, w, prev).kind;
test('hits, plurals and suffixes', () => {
  assert.equal(kind(card, 'salt'), 'hit');
  assert.equal(kind(card, 'Salads'), 'hit');
  assert.equal(kind(card, 'sauces'), 'hit');
  assert.equal(kind(hosp, 'hospitable'), 'hit');
  assert.equal(kind(hosp, 'hotels'), 'hit');
});
test('the card word itself and its inflections score nothing', () => {
  assert.equal(kind(card, 'salary'), 'same');
  assert.equal(kind(card, 'salaries'), 'same');
  assert.equal(kind(card, 'salaried'), 'same');
  assert.equal(kind(hosp, 'hospitals'), 'same');
  assert.equal(kind(hosp, 'hospitality'), 'same');
});
test('misses and false friends', () => {
  const j = judgeWord(card, 'solar', []);
  assert.equal(j.kind, 'miss'); assert.match(j.note, /sun/);
  assert.equal(kind(card, 'xyzzy'), 'miss');
  assert.equal(kind(card, 'sultan'), 'miss');
});
test('duplicates map to the same relative', () => {
  const first = judgeWord(card, 'sauce', []);
  assert.equal(judgeWord(card, 'sauces', [first]).kind, 'dupe');
});
test('every family entry is judged a hit for its own card', () => {
  const bad = [];
  for (const c of FAMILIES) for (const f of c.family) { const k = judgeWord(c, f, []).kind; if (k !== 'hit') bad.push(`${c.word}: ${f} -> ${k}`); }
  assert.deepEqual(bad, []);
});
