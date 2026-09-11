'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/families');
const D = require('../src/decoys');
const { judgeWord, norm } = require('../src/match');
test('every card is well formed', () => {
  for (const c of F) {
    assert.ok([1, 2, 3].includes(c.level), c.word);
    assert.ok(['general', 'pharmacopoeia', 'mind', 'neuro', 'body', 'money'].includes(c.cat), c.word);
    assert.ok(c.origin.length > 20 && c.story.length > 80, c.word);
    assert.ok(c.family.length >= 2, `${c.word} has ${c.family.length} relatives`);
    for (const f of c.family) assert.equal(judgeWord(c, f, []).kind, 'hit', `${c.word}: ${f}`);
    for (const k of Object.keys(c.notes)) assert.ok(c.family.includes(k), `${c.word}: note for ${k} but not in family`);
    for (const [w] of c.friends) assert.notEqual(judgeWord(c, w, []).kind, 'hit', `${c.word}: false friend ${w} is judged a relative`);
  }
});
test('the hint on the card never names a relative', () => {
  const bad = [];
  for (const c of F) {
    const words = c.origin.toLowerCase().match(/[a-z]+/g) || [];
    for (const w of words) if (w.length > 3 && c.family.some((f) => norm(f) === w)) bad.push(`${c.word}: "${w}"`);
  }
  assert.deepEqual(bad, []);
});
test('every word has two decoy stories', () => {
  const missing = F.filter((c) => !D[c.word] || D[c.word].length < 2).map((c) => c.word);
  assert.deepEqual(missing, []);
});
