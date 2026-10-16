// Find a company's website and logo from its name, using Wikidata (the free database
// behind Wikipedia). No key or account needed; works for well-known companies and
// organisations. Small businesses usually aren't listed, so callers fall back gracefully.
const API = 'https://www.wikidata.org/w/api.php';

// Endings that make searches miss: "Sunshine Clinic Pte Ltd" → "Sunshine Clinic".
const tidy = (name) => String(name ?? '').replace(/\b(pte\.?|private|ltd\.?|limited|llp|inc\.?|\(s\)|s'pore|singapore)\b/gi, ' ').replace(/\s+/g, ' ').trim();

// A statement's value, preferring the "preferred" one and skipping ones with an end date (old logos).
function current(claims = []) {
  const live = claims.filter((c) => !c.qualifiers?.P582 && c.mainsnak?.datavalue);
  const pick = live.find((c) => c.rank === 'preferred') ?? live.at(-1);
  return pick?.mainsnak.datavalue.value;
}

export const commonsImage = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, '_'))}?width=256`;

// Only show logos from places this app itself fills in.
export const isOkLogoUrl = (u) => /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^?#]+\?width=256$/.test(String(u ?? ''));

// → [{ name, about, website, logoUrl }], best match first; [] when nothing fits.
export async function findCompany(name, { signal } = {}) {
  const q = tidy(name);
  if (q.length < 2) return [];
  const get = async (params) => {
    const r = await fetch(`${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { signal });
    if (!r.ok) throw new Error(`Lookup failed (${r.status})`);
    return r.json();
  };
  const found = await get({ action: 'wbsearchentities', search: q, language: 'en', uselang: 'en', type: 'item', limit: '8' });
  const ids = (found.search ?? []).map((x) => x.id);
  if (!ids.length) return [];
  const data = await get({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|descriptions', languages: 'en' });
  return ids.map((id) => data.entities?.[id]).filter(Boolean).map((e) => {
    const website = current(e.claims?.P856);
    const logo = current(e.claims?.P154);
    return {
      name: e.labels?.en?.value ?? q,
      about: e.descriptions?.en?.value ?? '',
      website: typeof website === 'string' ? website : '',
      logoUrl: typeof logo === 'string' ? commonsImage(logo) : '',
    };
  }).filter((x) => x.website || x.logoUrl).slice(0, 4);
}
