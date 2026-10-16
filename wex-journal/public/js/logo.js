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

// "https://www.Starbucks.com.sg/menu" → "starbucks.com.sg"; anything that isn't a web address → ''.
export function siteDomain(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : '';
}

// The website's own icon, which for most brands is their logo. Google returns a tiny
// globe when a site has none, so anything smaller than 48px counts as "not found".
const siteIcon = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
const found = new Map(); // domain -> true/false, so each site is only checked once per visit

function photoLogo(src, name, cls) {
  return h('span', { class: `co-logo photo ${cls}`.trim() }, h('img', { src, alt: `${name || 'Company'} logo` }));
}

// photo: a data URL of the real logo, if the student added one. site: the company website.
// Order: the student's photo, then the website's logo, then a logo made from the name.
export function companyLogo({ name, industry, photo, site } = {}, cls = '') {
  if (photo) return photoLogo(photo, name, cls);
  const letters = initials(name);
  const domain = siteDomain(site);
  if (domain && found.get(domain)) return photoLogo(siteIcon(domain), name, cls);
  if (!letters && !domain) return null;
  const [ink, soft] = colourFor(name || domain);
  const made = h('span', { class: `co-logo ${cls}`.trim(), style: `--ink:${ink};--soft:${soft}`, role: 'img', 'aria-label': `${name || domain} logo` },
    h('b', {}, letters || initials(domain.split('.')[0])),
    BADGE[industry] ? h('i', { 'aria-hidden': 'true' }, BADGE[industry]) : null);
  if (domain && !found.has(domain)) {
    const img = new Image();
    img.onload = () => {
      found.set(domain, img.naturalWidth >= 48);
      if (found.get(domain) && made.isConnected) made.replaceWith(photoLogo(img.src, name, cls));
    };
    img.onerror = () => found.set(domain, false);
    img.src = siteIcon(domain);
  }
  return made;
}
