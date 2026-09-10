'use strict';
// ---------- matching ----------
const norm = (w) => String(w || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
// Simple inflections of a word: salaries -> salary, sauces -> sauce, inspired -> inspire.
function forms(w) {
  const out = new Set([w]);
  if (w.endsWith('ies')) out.add(`${w.slice(0, -3)}y`);
  for (const suf of ['s', 'es', 'ed', 'd', 'ing', 'ly']) if (w.endsWith(suf) && w.length - suf.length >= 3) out.add(w.slice(0, -suf.length));
  return out;
}
// A guess matches a family word if they are the same after normalising, the same up to an inflection,
// or one is the other plus up to three letters (hospitable / hospitality).
function matches(g, f) {
  if (g === f) return true;
  if (forms(g).has(f) || forms(f).has(g)) return true;
  if (g.length >= 5 && f.length >= 5 && Math.abs(g.length - f.length) <= 3 && (g.startsWith(f) || f.startsWith(g))) return true;
  return false;
}
// The card word with an ending stuck on it (salts, salty, stoicism, addiction) is not a relative.
const SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'ly', 'y', 'ness', 'iness', 'ism', 'ist', 'ic', 'ical', 'al', 'ity', 'ive', 'ion', 'able', 'er', 'ers', 'less', 'ful', 'ish', 'ment', 'ise', 'ize', 'ally'];
function sameWord(g, w) {
  if (g === w) return true;
  for (const base of [w, w.replace(/e$/, ''), w.replace(/y$/, 'i')]) for (const suf of SUFFIXES) if (g === base + suf) return true;
  return false;
}
function judgeWord(card, raw, already) {
  const g = norm(raw);
  if (!g) return null;
  const word = raw.trim();
  if (sameWord(g, norm(card.word))) return { word, kind: 'same', note: `that's just ${card.word} again` };
  const hit = card.family.find((f) => matches(g, norm(f)));
  if (hit) {
    if (already.some((a) => a.hit === hit)) return { word, kind: 'dupe', hit, note: 'already got that one' };
    return { word, kind: 'hit', hit };
  }
  const ff = card.friends.find(([f]) => matches(g, norm(f)));
  return { word, kind: 'miss', note: ff ? ff[1] : null };
}

module.exports = { norm, matches, sameWord, judgeWord };
