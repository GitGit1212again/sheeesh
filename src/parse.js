'use strict';

const LINK_TAGS = {
  root: 'root', etym: 'root', etymology: 'root', origin: 'root', cognate: 'root',
  form: 'form', sound: 'form', rhyme: 'form', anagram: 'form', letters: 'form', spelling: 'form',
  meaning: 'meaning', sense: 'meaning', vibe: 'meaning', vibes: 'meaning', assoc: 'meaning',
};

const MAX_WORD = 40;
const MAX_WHY = 240;

function normalizeWord(w) {
  const ascii = String(w)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return ascii || String(w).toLowerCase().replace(/\s+/g, '');
}

// A play is:   word: reason   |   word - reason   |   word #root reason   |   "two words": reason
// Anything without a separator or a link tag is treated as chat and ignored (silent: true).
function parsePlay(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, silent: true };

  let word;
  let rest;
  const quoted = s.match(/^["“]([^"”]+)["”]\s*(.*)$/s);
  if (quoted) {
    word = quoted[1].trim();
    rest = quoted[2];
  } else {
    const m = s.match(/^(\S+)\s*(.*)$/s);
    word = m[1];
    rest = m[2];
  }

  let sep = false;
  if (/[:：]$/.test(word)) {
    word = word.replace(/[:：]+$/, '');
    sep = true;
  }
  const sm = rest.match(/^([:\-–—>]+)\s*(.*)$/s);
  if (sm) {
    sep = true;
    rest = sm[2];
  }

  let link = null;
  const wm = word.match(/^(.*?)#(\w+)$/);
  if (wm && LINK_TAGS[wm[2].toLowerCase()]) {
    link = LINK_TAGS[wm[2].toLowerCase()];
    word = wm[1];
  }
  rest = rest.replace(/#(\w+)/g, (all, tag) => {
    const t = LINK_TAGS[tag.toLowerCase()];
    if (t && !link) {
      link = t;
      return '';
    }
    return t ? '' : all;
  });

  if (!sep && !link) return { ok: false, silent: true };

  word = word.replace(/^[*_`~]+|[*_`~]+$/g, '').trim();
  const why = rest.replace(/\s+/g, ' ').trim();

  if (!/\p{L}/u.test(word)) return { ok: false, error: 'That is not a word.' };
  if (word.length > MAX_WORD) return { ok: false, error: `Keep the word under ${MAX_WORD} characters.` };
  if (!why) return { ok: false, error: 'State the association. A word without a reason is noise.' };
  if (why.length > MAX_WHY) return { ok: false, error: `Keep the reason under ${MAX_WHY} characters. This is a game, not a thesis.` };

  return { ok: true, word, link: link || 'meaning', why };
}

module.exports = { parsePlay, normalizeWord, LINK_TAGS };
