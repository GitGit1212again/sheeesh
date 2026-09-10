// Card art: one engraved-style illustration and one palette per card family.
// Everything is inline SVG so the game stays a single file.

const PALETTE = {
  pharmacopoeia: { name: 'Drink & drugs', ink: '#4dff88', band: '#1f7a45', paper: '#0b120e' },
  mind: { name: 'The mind', ink: '#c77dff', band: '#5a2d8a', paper: '#100a16' },
  body: { name: 'Body & medicine', ink: '#ff5c7a', band: '#8a1f36', paper: '#160a0f' },
  sex: { name: 'Sex', ink: '#ff3fa4', band: '#8a1c5a', paper: '#160916' },
  insults: { name: 'Insults', ink: '#ffd166', band: '#8a6a1a', paper: '#14100a' },
  money: { name: 'Money, gods & the street', ink: '#35e3ff', band: '#136a7a', paper: '#081114' },
  learning: { name: 'Learning', ink: '#8fb3ff', band: '#2b4a8a', paper: '#0a0e16' },
  letters: { name: 'Lost & gained letters', ink: '#f2e9ff', band: '#555566', paper: '#0e0d12' },
  nature: { name: 'Nature', ink: '#b8ff5b', band: '#4a7a1a', paper: '#0c120a' },
  gods: { name: 'Gods & heroes', ink: '#ffb347', band: '#8a4f1a', paper: '#140e08' },
  food: { name: 'Food & house', ink: '#ff8c69', band: '#8a3a1f', paper: '#140c0a' },
  neuro: { name: 'Science & philosophy', ink: '#ff2e88', band: '#7a1247', paper: '#120812' },
  street: { name: 'Streetwise', ink: '#ff8a3d', band: '#8a3a10', paper: '#140d08' },
  general: { name: 'Everyday', ink: '#f2e9ff', band: '#555566', paper: '#0e0d12' },
  misc: { name: 'Miscellany', ink: '#f2e9ff', band: '#555566', paper: '#0e0d12' },
};

// Hatching backdrop shared by every plate; the illustration draws on top.
const HATCH = `<defs>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width=".6" opacity=".35"/></pattern>
  <pattern id="cross" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" stroke-width=".5" opacity=".28"/></pattern>
  <radialGradient id="vig" cx="50%" cy="45%" r="60%"><stop offset="60%" stop-color="currentColor" stop-opacity="0"/><stop offset="100%" stop-color="currentColor" stop-opacity=".18"/></radialGradient>
</defs>
<rect x="0" y="0" width="120" height="150" fill="url(#vig)"/>
<circle cx="60" cy="72" r="50" fill="url(#hatch)" stroke="currentColor" stroke-width=".8"/>
<circle cx="60" cy="72" r="46" fill="none" stroke="currentColor" stroke-width=".4" stroke-dasharray="1 2"/>`;

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

const ILLUS = {
  // poppy seed-head, stem and a small stoppered bottle
  pharmacopoeia: `<g ${S} stroke-width="1.6">
    <path d="M62 118V80"/><path d="M62 80c-12-2-16-14-12-24 3-8 12-12 20-8 9 4 11 16 5 24-3 5-8 7-13 8z"/>
    <path d="M52 62c8-3 14-3 22 0M50 70c8 3 16 3 24 0"/><path d="M56 48l6-6 6 6"/>
    <path d="M62 84c8 2 14 8 16 16M62 90c-8 2-12 6-14 12"/>
    <path d="M30 96h14v6c4 2 6 6 6 10v6H24v-6c0-4 2-8 6-10z"/><path d="M32 90h10v6H32z"/><path d="M28 108h18" opacity=".6"/>
    <path d="M88 76c0-6 4-8 8-8s8 2 8 8-3 10-8 14c-5-4-8-8-8-14z" fill="url(#cross)"/>
  </g>`,
  // head in profile with the old phrenological divisions
  mind: `<g ${S} stroke-width="1.6">
    <path d="M44 118c-4-10-8-18-6-30 2-14 8-30 26-34 16-4 30 6 32 22 2 12-4 20-8 24-2 3-1 8 2 12l-16 4c-2-4-6-6-10-6-8 0-14 3-20 8z"/>
    <path d="M48 60c10-4 18-6 28-4M42 74c12-8 24-10 38-8M40 86c12-6 22-8 34-8" opacity=".7"/>
    <path d="M70 46v18M86 54l-8 16M58 50l6 22" opacity=".5"/>
    <path d="M56 92c4 0 6 2 6 6" opacity=".7"/><circle cx="76" cy="86" r="1.5" fill="currentColor"/>
    <path d="M92 60c8-4 14 0 14 6" opacity=".5"/>
  </g>`,
  // a skull, front on, jaw and all
  body: `<g ${S} stroke-width="1.6">
    <path d="M60 30c-20 0-32 14-32 32 0 12 6 18 10 22v10h44V84c4-4 10-10 10-22 0-18-12-32-32-32z"/>
    <path d="M42 66a8 8 0 1 0 16 0 8 8 0 1 0-16 0zM62 66a8 8 0 1 0 16 0 8 8 0 1 0-16 0z" fill="url(#cross)"/>
    <path d="M56 78l4-6 4 6z"/><path d="M46 94h28M50 94v8M56 94v8M62 94v8M68 94v8"/>
    <path d="M38 82c6 4 10 6 12 12M82 82c-6 4-10 6-12 12" opacity=".6"/>
    <path d="M40 106h40v10H40z"/><path d="M48 106v10M56 106v10M64 106v10M72 106v10" opacity=".7"/>
  </g>`,
  // an orchid
  sex: `<g ${S} stroke-width="1.5">
    <path d="M60 124c0-20-2-36-8-52"/>
    <path d="M60 70c-14-10-30-8-34 6 10 8 24 6 34-6z" fill="url(#hatch)"/>
    <path d="M60 70c14-10 30-8 34 6-10 8-24 6-34-6z" fill="url(#hatch)"/>
    <path d="M60 70c-12-10-14-30 0-38 14 8 12 28 0 38z" fill="url(#hatch)"/>
    <path d="M60 70c-10 6-16 18-8 26 8-2 12-14 8-26zM60 70c10 6 16 18 8 26-8-2-12-14-8-26z"/>
    <path d="M60 68c-4 4-4 10 0 14 4-4 4-10 0-14z" fill="currentColor" opacity=".7"/>
    <path d="M52 100c-10 2-18 10-18 20M68 100c10 2 18 10 18 20" opacity=".5"/>
  </g>`,
  // a mask with its tongue out
  insults: `<g ${S} stroke-width="1.6">
    <path d="M32 40c10 6 46 6 56 0v30c0 18-10 32-28 40-18-8-28-22-28-40z"/>
    <path d="M42 62c4-4 10-4 14 0M64 62c4-4 10-4 14 0"/>
    <path d="M46 66c2 3 6 3 8 0M66 66c2 3 6 3 8 0" opacity=".7"/>
    <path d="M44 84c6 8 26 8 32 0" /><path d="M54 88c0 8 2 14 6 16 4-2 6-8 6-16" fill="url(#cross)"/>
    <path d="M28 44c-6 6-8 16-4 24M92 44c6 6 8 16 4 24" opacity=".6"/>
    <path d="M36 32l6 8M84 32l-6 8M60 26v10" opacity=".7"/>
  </g>`,
  // coin with a skull, on a broken bench
  money: `<g ${S} stroke-width="1.6">
    <circle cx="60" cy="62" r="28"/><circle cx="60" cy="62" r="22" stroke-dasharray="2 2" opacity=".7"/>
    <path d="M60 46c-8 0-13 6-13 13 0 5 3 8 5 10v5h16v-5c2-2 5-5 5-10 0-7-5-13-13-13z"/>
    <path d="M53 60a3 3 0 1 0 6 0 3 3 0 1 0-6 0zM61 60a3 3 0 1 0 6 0 3 3 0 1 0-6 0z" fill="currentColor" opacity=".8"/>
    <path d="M56 74h8M56 78h8" opacity=".7"/>
    <path d="M22 104h30l6-6 6 6h34" /><path d="M26 104v12M94 104v12M52 98l-6 12M64 98l6 12" opacity=".7"/>
  </g>`,
  // open book, guttering candle
  learning: `<g ${S} stroke-width="1.6">
    <path d="M22 96c12-6 26-6 38 2 12-8 26-8 38-2V56c-12-6-26-6-38 2-12-8-26-8-38-2z"/>
    <path d="M60 58v40"/><path d="M30 66c8-2 16-2 24 2M30 76c8-2 16-2 24 2M30 86c8-2 16-2 24 2M66 68c8-4 16-4 24-2M66 78c8-4 16-4 24-2M66 88c8-4 16-4 24-2" opacity=".6"/>
    <path d="M86 26v22M80 48h12"/><path d="M86 26c-4-6-4-10 0-14 4 4 4 8 0 14z" fill="currentColor" opacity=".8"/>
    <path d="M22 104h76" opacity=".5"/>
  </g>`,
  // a great N, an article, and the letter walking across
  letters: `<g ${S} stroke-width="1.8">
    <path d="M36 100V40l36 60V40"/><path d="M30 106h48" opacity=".6"/>
    <path d="M78 58h18m-4-4 4 4-4 4" opacity=".8"/><path d="M42 44l-4-8M72 96l4 8" opacity=".5"/>
    <path d="M30 34h22M84 34h10" opacity=".4"/><path d="M32 40c-2-6 0-10 4-10" opacity=".4"/>
  </g>`,
  // dandelion, half blown
  nature: `<g ${S} stroke-width="1.4">
    <path d="M60 122V70"/><path d="M60 70c-6-2-12-8-12-16" opacity=".7"/>
    <circle cx="60" cy="52" r="4" fill="currentColor" opacity=".8"/>
    <g opacity=".85"><path d="M60 52l-22-8M60 52l-20 6M60 52l-14 18M60 52l-4 22M60 52l12-22M60 52l-6-22M60 52l20-14M60 52l-22-20"/>
    <circle cx="38" cy="44" r="2.5"/><circle cx="40" cy="58" r="2.5"/><circle cx="46" cy="70" r="2.5"/><circle cx="56" cy="74" r="2.5"/><circle cx="72" cy="30" r="2.5"/><circle cx="54" cy="30" r="2.5"/><circle cx="80" cy="38" r="2.5"/><circle cx="38" cy="32" r="2.5"/></g>
    <path d="M84 60l8-6M90 74l10-2M86 88l8 4" opacity=".6"/><circle cx="94" cy="52" r="2"/><circle cx="102" cy="72" r="2"/><circle cx="96" cy="94" r="2"/>
    <path d="M60 122c-10-4-16-12-18-22M60 122c10-4 16-12 18-22" opacity=".5"/>
  </g>`,
  // a bolt over a temple front
  gods: `<g ${S} stroke-width="1.6">
    <path d="M66 24L48 60h12l-6 30 22-40H64z" fill="url(#hatch)"/>
    <path d="M30 96l30-14 30 14z"/><path d="M28 98h64M32 104h56"/>
    <path d="M38 104v18M50 104v18M62 104v18M74 104v18M86 104v18"/><path d="M28 122h68"/>
  </g>`,
  // a goblet, tipped, spilling
  food: `<g ${S} stroke-width="1.6">
    <path d="M46 34h36c0 18-6 30-18 34-12-4-18-16-18-34z" fill="url(#hatch)"/>
    <path d="M64 68v22M52 96c4-6 20-6 24 0z"/><path d="M48 40c8 2 24 2 32 0" opacity=".6"/>
    <path d="M78 70c6 4 10 10 12 18M84 66c4 2 6 6 8 10" opacity=".7"/>
    <path d="M26 112c10-4 20-4 30 0s20 4 30 0 12-2 12-2" opacity=".6"/>
  </g>`,
  // a neuron: soma, dendrites, axon
  neuro: `<g ${S} stroke-width="1.6">
    <circle cx="58" cy="56" r="11" fill="url(#hatch)"/>
    <path d="M50 48l-10-12M46 56l-16-2M50 64l-12 10M40 36l-6-4M40 36l2-8M30 54l-8-4M30 54l-6 6M38 74l-8 2M38 74l2 8"/>
    <path d="M69 58c14 6 20 20 20 40"/><path d="M89 98l-6 8M89 98l6 8M89 98v10" opacity=".8"/>
    <path d="M72 64c4 2 6 6 6 10M78 76c4 2 6 6 6 10" opacity=".5"/>
    <path d="M66 46l8-10M74 36l-2-6M74 36l6 0" opacity=".8"/>
  </g>`,
  // a spray can, cap off, mid-spray
  street: `<g ${S} stroke-width="1.6">
    <rect x="44" y="56" width="30" height="62" rx="5" fill="url(#hatch)"/>
    <path d="M48 56v-8h22v8M55 48v-8h8v8"/><path d="M59 40v-6"/>
    <path d="M48 70h22M48 104h22" opacity=".6"/>
    <path d="M66 34c6-6 14-8 22-6M68 40c8 0 16 4 22 10M64 30c4-8 10-12 18-14" opacity=".8"/>
    <circle cx="92" cy="26" r="2"/><circle cx="96" cy="46" r="1.6"/><circle cx="86" cy="14" r="1.6"/>
  </g>`,
  misc: `<g ${S} stroke-width="1.6"><circle cx="60" cy="72" r="30"/><path d="M60 50v22l14 8"/></g>`,
};

function plateArt(cat) {
  const art = ILLUS[cat] || ILLUS.misc;
  return `<svg class="plate-art" viewBox="0 0 120 150" xmlns="http://www.w3.org/2000/svg">${HATCH}${art}</svg>`;
}

function paletteFor(cat) { return PALETTE[cat] || PALETTE.misc; }

module.exports = { plateArt, paletteFor, PALETTE };
