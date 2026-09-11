'use strict';
// The file: every word the game knows, with its origin, its story, its relatives and its false friends.
// Split across three files for editing; this joins them and checks the shape.
const all = [].concat(require('./words-a'), require('./words-b'), require('./words-c'));
const seen = new Set();
const out = [];
for (const c of all) {
  if (seen.has(c.word)) continue; // the first copy wins
  seen.add(c.word);
  c.notes = c.notes || {};
  c.friends = c.friends || [];
  out.push(c);
}
module.exports = out;
