// A made-up logo for the student's placement, built from the company name, or the
// student's own photo of the real logo when they've added one.
import { h } from './firebase.js';

const COLOURS = [
  ['#0f766e', '#ccfbf1'], ['#1d4ed8', '#dbeafe'], ['#7c3aed', '#ede9fe'], ['#be123c', '#ffe4e6'],
  ['#b45309', '#fef3c7'], ['#15803d', '#dcfce7'], ['#0e7490', '#cffafe'], ['#a21caf', '#fae8ff'],
];

const BADGE = {
  'Healthcare': '🩺', 'Food & beverage / Hospitality': '🍽️', 'Retail': '🛍️', 'Education / Early childhood': '🎒',
  'Engineering / Manufacturing': '⚙️', 'IT / Tech': '💻', 'Media / Design': '🎨', 'Business / Finance': '📊',
  'Public service': '🏛️', 'Logistics / Transport': '🚚', 'Science / Lab': '🔬',
};

// Words that don't belong in initials: "Sunshine Family Clinic Pte Ltd" → "SF".
const SKIP = new Set(['pte', 'ltd', 'llp', 'inc', 'co', 'the', 'and', 'of', 'singapore', 'sg', '&', '@']);

export function initials(name) {
  const words = String(name ?? '').replace(/[()[\].,]/g, ' ').split(/\s+/).filter((w) => w && !SKIP.has(w.toLowerCase()));
  if (!words.length) return '';
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function colourFor(name) {
  let n = 0;
  for (const ch of String(name).toLowerCase()) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return COLOURS[n % COLOURS.length];
}

// photo: a data URL of the real logo, if the student added one.
export function companyLogo({ name, industry, photo } = {}, cls = '') {
  if (photo) return h('span', { class: `co-logo photo ${cls}`.trim() }, h('img', { src: photo, alt: `${name || 'Company'} logo` }));
  const letters = initials(name);
  if (!letters) return null;
  const [ink, soft] = colourFor(name);
  return h('span', { class: `co-logo ${cls}`.trim(), style: `--ink:${ink};--soft:${soft}`, role: 'img', 'aria-label': `${name} logo` },
    h('b', {}, letters),
    BADGE[industry] ? h('i', { 'aria-hidden': 'true' }, BADGE[industry]) : null);
}
