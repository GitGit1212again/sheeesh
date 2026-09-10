'use strict';

// Scrabble letter values. Letters outside a-z score 1.
const LETTER_VALUES = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};

// Scrabble tile distribution, minus blanks.
const BAG_DISTRIBUTION = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2,
  n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1,
};

const LINKS = {
  meaning: { mult: 1, label: 'meaning', blurb: 'sense, usage, culture, vibes' },
  form: { mult: 1.5, label: 'form', blurb: 'letters, rhyme, anagram, contains' },
  root: { mult: 2, label: 'root', blurb: 'shared etymology, root named' },
};

const TILE_BONUS = 5;
const SPEED_BONUS = 3;
const LENGTH_BONUS = 5;
const LENGTH_THRESHOLD = 8;
const CLUE_BONUS = 5;
const REJECT_PENALTY = -2;
const TIMEOUT_PENALTY = -1;

function lettersOf(word) {
  return word
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split('')
    .filter((c) => /\p{L}/u.test(c));
}

function letterScore(word) {
  return lettersOf(word).reduce((sum, c) => sum + (LETTER_VALUES[c] || 1), 0);
}

function firstLetter(word) {
  const l = lettersOf(word);
  return l.length ? l[0] : null;
}

function scorePlay({ word, link, tiles, elapsedMs, fastMs }) {
  const letters = letterScore(word);
  const count = lettersOf(word).length;
  const mult = (LINKS[link] || LINKS.meaning).mult;
  const linkPoints = Math.round(letters * mult);
  const first = firstLetter(word);
  const tileUsed = first && tiles.includes(first) ? first : null;
  const tileBonus = tileUsed ? TILE_BONUS : 0;
  const speedBonus = elapsedMs <= fastMs ? SPEED_BONUS : 0;
  const lengthBonus = count >= LENGTH_THRESHOLD ? LENGTH_BONUS : 0;
  const total = linkPoints + tileBonus + speedBonus + lengthBonus;
  return { letters, count, mult, linkPoints, tileUsed, tileBonus, speedBonus, lengthBonus, total };
}

function makeBag(rng = Math.random) {
  const bag = [];
  for (const [c, n] of Object.entries(BAG_DISTRIBUTION)) for (let i = 0; i < n; i++) bag.push(c);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

module.exports = {
  LETTER_VALUES, LINKS, TILE_BONUS, SPEED_BONUS, LENGTH_BONUS, LENGTH_THRESHOLD,
  CLUE_BONUS, REJECT_PENALTY, TIMEOUT_PENALTY,
  lettersOf, letterScore, firstLetter, scorePlay, makeBag,
};
