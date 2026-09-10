'use strict';
// One-off: merge the science deck into the card list, switch palettes to neon, add a neuron plate.
const fs = require('node:fs');
const path = require('node:path');
const src = (f) => path.join(__dirname, '..', 'src', f);

let c = fs.readFileSync(src('cards.js'), 'utf8');
if (!c.includes('cards-science')) {
  c = c.replace(/\];\s*$/, "].concat(require('./cards-science'));\n");
  fs.writeFileSync(src('cards.js'), c);
}

let a = fs.readFileSync(src('art.js'), 'utf8');
const palette = `const PALETTE = {
  pharmacopoeia: { name: 'Pharmacopoeia', ink: '#4dff88', band: '#1f7a45', paper: '#0b120e' },
  mind: { name: 'The mind, failing', ink: '#c77dff', band: '#5a2d8a', paper: '#100a16' },
  body: { name: 'The body, failing', ink: '#ff5c7a', band: '#8a1f36', paper: '#160a0f' },
  sex: { name: 'Sex, mostly by accident', ink: '#ff3fa4', band: '#8a1c5a', paper: '#160916' },
  insults: { name: 'Insults and reversals', ink: '#ffd166', band: '#8a6a1a', paper: '#14100a' },
  money: { name: 'Money, work, the state', ink: '#35e3ff', band: '#136a7a', paper: '#081114' },
  learning: { name: 'Learning', ink: '#8fb3ff', band: '#2b4a8a', paper: '#0a0e16' },
  letters: { name: 'A letter gained or lost', ink: '#f2e9ff', band: '#555566', paper: '#0e0d12' },
  nature: { name: 'Animals, plants, weather', ink: '#b8ff5b', band: '#4a7a1a', paper: '#0c120a' },
  gods: { name: 'Gods and heroes', ink: '#ffb347', band: '#8a4f1a', paper: '#140e08' },
  food: { name: 'Food, clothes, the house', ink: '#ff8c69', band: '#8a3a1f', paper: '#140c0a' },
  neuro: { name: 'Mind, medicine, science', ink: '#ff2e88', band: '#7a1247', paper: '#120812' },
  misc: { name: 'Miscellany', ink: '#f2e9ff', band: '#555566', paper: '#0e0d12' },
};`;
a = a.replace(/const PALETTE = \{[\s\S]*?\n\};/, palette);
if (!a.includes('neuro:')) {
  const neuron = [
    '  // a neuron: soma, dendrites, axon',
    '  neuro: `<g ${S} stroke-width="1.6">',
    '    <circle cx="58" cy="56" r="11" fill="url(#hatch)"/>',
    '    <path d="M50 48l-10-12M46 56l-16-2M50 64l-12 10M40 36l-6-4M40 36l2-8M30 54l-8-4M30 54l-6 6M38 74l-8 2M38 74l2 8"/>',
    '    <path d="M69 58c14 6 20 20 20 40"/><path d="M89 98l-6 8M89 98l6 8M89 98v10" opacity=".8"/>',
    '    <path d="M72 64c4 2 6 6 6 10M78 76c4 2 6 6 6 10" opacity=".5"/>',
    '    <path d="M66 46l8-10M74 36l-2-6M74 36l6 0" opacity=".8"/>',
    '  </g>`,',
    '  misc: `<g ${S} stroke-width="1.6"><circle',
  ].join('\n');
  a = a.replace('  misc: `<g ${S} stroke-width="1.6"><circle', neuron);
}
fs.writeFileSync(src('art.js'), a);

const cards = require(src('cards.js'));
const seen = new Set();
const dup = [];
for (const x of cards) { if (seen.has(x.word)) dup.push(x.word); seen.add(x.word); }
const art = require(src('art.js'));
console.log('cards', cards.length, 'dups', dup.join(',') || 'none', '| neuro icon', art.plateArt('neuro').includes('cx="58"'), '| palettes', Object.keys(art.PALETTE).length);
