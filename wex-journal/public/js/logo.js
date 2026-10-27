// The logo for a student's placement: their own photo of it, the one found online,
// the website's icon, or the school crest.
import { h } from './firebase.js';
import { isOkLogoUrl } from './lookup.js';

// "https://www.Starbucks.com.sg/menu" → "starbucks.com.sg"; anything that isn't a web address → ''.
export function siteDomain(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : '';
}

// The website's own icon, which for most brands is their logo. Google returns a tiny
// globe when a site has none, so anything smaller than 48px counts as "not found".
const siteIcon = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
const found = new Map(); // domain -> true/false, so each site is only checked once per visit

const SCHOOL = 'img/school.webp?v=1';

// Logos the school supplied for this year's companies (files in img/logos).
const KNOWN = {
  'Anewtech Systems Pte Ltd': 'anewtech',
  'Bethesda Care Services': 'bethesda',
  'Filos (Eldercare)': 'filos',
  'Han & Lu Law Chambers LLP': 'han-lu',
  'Marymount Bakehouse': 'marymount',
};
export const knownLogo = (name) => (KNOWN[String(name ?? '').trim()] ? `img/logos/${KNOWN[String(name).trim()]}.webp?v=1` : '');

// If a logo from the internet fails to load (bad link, no signal), show the school crest instead.
function photoLogo(src, name, cls) {
  const img = h('img', { src, alt: `${name || 'Company'} logo` });
  img.addEventListener('error', () => { if (!img.src.endsWith(SCHOOL)) { img.src = SCHOOL; img.alt = 'School crest'; img.parentElement?.classList.add('school'); } }, { once: true });
  return h('span', { class: `co-logo photo ${cls}`.trim() }, img);
}

// Order: the student's photo, the school's logo for that company, the logo found online,
// the website's icon, then (if asked for) the school crest. Returns null when there's nothing to show.
export function companyLogo({ name, photo, site, logoUrl } = {}, cls = '', { school = true } = {}) {
  if (photo) return photoLogo(photo, name, cls);
  if (knownLogo(name)) return photoLogo(knownLogo(name), name, `${cls} brand`.trim());
  if (isOkLogoUrl(logoUrl)) return photoLogo(logoUrl, name, cls);
  const domain = siteDomain(site);
  if (domain && found.get(domain)) return photoLogo(siteIcon(domain), name, cls);
  const fallback = school
    ? h('span', { class: `co-logo photo school ${cls}`.trim() }, h('img', { src: SCHOOL, alt: 'School crest' }))
    : h('span', { class: `co-logo-slot ${cls}`.trim() });
  if (domain && !found.has(domain)) {
    const img = new Image();
    img.onload = () => {
      found.set(domain, img.naturalWidth >= 48);
      if (found.get(domain) && fallback.isConnected) fallback.replaceWith(photoLogo(img.src, name, cls));
    };
    img.onerror = () => found.set(domain, false);
    img.src = siteIcon(domain);
  }
  return school || domain ? fallback : null;
}
