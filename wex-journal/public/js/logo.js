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

function photoLogo(src, name, cls) {
  return h('span', { class: `co-logo photo ${cls}`.trim() }, h('img', { src, alt: `${name || 'Company'} logo` }));
}

// Order: the student's photo, then the logo found online, then the website's icon,
// then (if asked for) the school crest. Returns null when there's nothing to show.
export function companyLogo({ name, photo, site, logoUrl } = {}, cls = '', { school = true } = {}) {
  if (photo) return photoLogo(photo, name, cls);
  if (isOkLogoUrl(logoUrl)) return photoLogo(logoUrl, name, cls);
  const domain = siteDomain(site);
  if (domain && found.get(domain)) return photoLogo(siteIcon(domain), name, cls);
  const fallback = school
    ? h('span', { class: `co-logo photo school ${cls}`.trim() }, h('img', { src: 'img/school.webp?v=1', alt: 'School crest' }))
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
