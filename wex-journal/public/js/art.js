// Small colour illustrations for the home page. Fixed strings, never user input.
const ART = {
  // Hills, sun and a signpost: the student's journey.
  hero: `<svg viewBox="0 0 240 120" fill="none">
    <circle cx="190" cy="34" r="16" fill="#fde68a"/>
    <path d="M30 40a10 10 0 0 1 19-4 8 8 0 0 1 11 7H24a6 6 0 0 1 6-3z" fill="#fff"/>
    <path d="M120 22a9 9 0 0 1 17-3 7 7 0 0 1 9 6h-31a5 5 0 0 1 5-3z" fill="#fff"/>
    <path d="M0 120V88l38-30 30 22 40-38 44 40 30-20 58 34v24z" fill="#bfdbfe"/>
    <path d="M100 52l8-10 8 9-6-1z" fill="#fff"/>
    <path d="M0 120v-18c40-14 80-14 120-4s80 8 120-6v28z" fill="#86efac"/>
    <path d="M0 120v-8c50-10 110-4 160 0 30 2 55 0 80-6v14z" fill="#4ade80"/>
    <rect x="196" y="52" width="4" height="58" rx="1" fill="#92400e"/>
    <path d="M176 56h40l6 6-6 6h-40z" fill="#f59e0b"/><text x="180" y="65" font-size="8" font-weight="700" fill="#78350f" font-family="sans-serif">EXPLORE</text>
    <path d="M222 72h-42l-6 6 6 6h42z" fill="#fbbf24"/><text x="183" y="81" font-size="8" font-weight="700" fill="#78350f" font-family="sans-serif">REFLECT</text>
    <path d="M182 88h30l6 6-6 6h-30z" fill="#f59e0b"/><text x="186" y="97" font-size="8" font-weight="700" fill="#78350f" font-family="sans-serif">GROW</text>
  </svg>`,
  building: `<svg viewBox="0 0 120 70" fill="none">
    <ellipse cx="60" cy="66" rx="58" ry="4" fill="#bbf7d0"/>
    <circle cx="14" cy="44" r="12" fill="#22c55e"/><rect x="13" y="50" width="3" height="16" fill="#92400e"/>
    <circle cx="106" cy="42" r="13" fill="#16a34a"/><rect x="105" y="50" width="3" height="16" fill="#92400e"/>
    <rect x="30" y="22" width="60" height="44" rx="2" fill="#fed7aa"/><path d="M26 24l34-14 34 14z" fill="#ea580c"/>
    <g fill="#bae6fd"><rect x="36" y="30" width="10" height="9"/><rect x="55" y="30" width="10" height="9"/><rect x="74" y="30" width="10" height="9"/><rect x="36" y="45" width="10" height="9"/><rect x="74" y="45" width="10" height="9"/></g>
    <rect x="54" y="48" width="12" height="18" fill="#0f766e"/>
  </svg>`,
  clipboard: `<svg viewBox="0 0 48 48" fill="none"><rect x="10" y="8" width="28" height="36" rx="3" fill="#ccfbf1" stroke="#0f766e" stroke-width="2"/><rect x="17" y="4" width="14" height="8" rx="2" fill="#0f766e"/><path d="M16 22h16M16 29h16M16 36h10" stroke="#0f766e" stroke-width="2" stroke-linecap="round"/></svg>`,
  eyes: `<svg viewBox="0 0 48 48" fill="none"><ellipse cx="16" cy="26" rx="9" ry="11" fill="#fff" stroke="#1f2937" stroke-width="2"/><ellipse cx="33" cy="26" rx="9" ry="11" fill="#fff" stroke="#1f2937" stroke-width="2"/><circle cx="19" cy="28" r="4" fill="#1f2937"/><circle cx="36" cy="28" r="4" fill="#1f2937"/><path d="M40 8l3-3M44 14h3M36 6l1-4" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>`,
  bolt: `<svg viewBox="0 0 48 48" fill="none"><path d="M27 4L11 27h11l-3 17 17-24H25z" fill="#facc15" stroke="#ca8a04" stroke-width="2" stroke-linejoin="round"/><path d="M38 10l4-2M40 18h4" stroke="#ca8a04" stroke-width="2" stroke-linecap="round"/></svg>`,
  thought: `<svg viewBox="0 0 48 48" fill="none"><path d="M14 30a9 9 0 0 1 2-17 11 11 0 0 1 20 1 8 8 0 0 1 0 16z" fill="#fff" stroke="#334155" stroke-width="2"/><circle cx="13" cy="37" r="3" fill="#fff" stroke="#334155" stroke-width="2"/><circle cx="7" cy="43" r="2" fill="#fff" stroke="#334155" stroke-width="2"/></svg>`,
  summit: `<svg viewBox="0 0 48 48" fill="none"><path d="M2 44l16-24 7 9 7-13 14 28z" fill="#93c5fd" stroke="#1d4ed8" stroke-width="2" stroke-linejoin="round"/><path d="M32 16V4" stroke="#1d4ed8" stroke-width="2"/><path d="M32 4h9l-2 3 2 3h-9z" fill="#ef4444"/></svg>`,
  climb: `<svg viewBox="0 0 64 56" fill="none"><path d="M2 54l20-30 8 10 10-18 22 38z" fill="#c4b5fd" stroke="#6d28d9" stroke-width="2" stroke-linejoin="round"/><path d="M40 16l3 5-6 0z" fill="#fff"/><path d="M40 16V3" stroke="#6d28d9" stroke-width="2"/><path d="M40 3h11l-3 4 3 4H40z" fill="#ef4444"/></svg>`,
  team: `<svg viewBox="0 0 64 56" fill="none"><circle cx="23" cy="20" r="8" fill="#fcd34d"/><path d="M15 17a8 8 0 0 1 16-2c-5 0-10-1-16 2z" fill="#1f2937"/><path d="M9 54c0-12 6-20 14-20s14 8 14 20z" fill="#f472b6"/><circle cx="42" cy="18" r="8" fill="#fcd34d"/><path d="M34 16a8 8 0 0 1 16 0z" fill="#1f2937"/><path d="M28 54c0-13 6-21 14-21s14 8 14 21z" fill="#3b82f6"/><path d="M54 6l3-3M58 12h4" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>`,
  trophy: `<svg viewBox="0 0 64 56" fill="none"><path d="M20 6h24v14a12 12 0 0 1-24 0z" fill="#fbbf24" stroke="#b45309" stroke-width="2"/><path d="M20 10h-7a7 7 0 0 0 9 10M44 10h7a7 7 0 0 1-9 10" stroke="#b45309" stroke-width="2"/><rect x="29" y="31" width="6" height="10" fill="#f59e0b"/><rect x="21" y="41" width="22" height="8" rx="2" fill="#b45309"/><path d="M8 6l2 4 4 1-4 2-2 4-2-4-4-2 4-1zM56 30l1.5 3 3 1-3 1.5L56 39l-1.5-3.5-3-1.5 3-1z" fill="#facc15"/></svg>`,
  finish: `<svg viewBox="0 0 48 48" fill="none"><path d="M8 46V4" stroke="#78350f" stroke-width="3" stroke-linecap="round"/><path d="M9 6h30v20H9z" fill="#fff" stroke="#111827" stroke-width="1.5"/><g fill="#111827"><rect x="9" y="6" width="6" height="5"/><rect x="21" y="6" width="6" height="5"/><rect x="33" y="6" width="6" height="5"/><rect x="15" y="11" width="6" height="5"/><rect x="27" y="11" width="6" height="5"/><rect x="9" y="16" width="6" height="5"/><rect x="21" y="16" width="6" height="5"/><rect x="33" y="16" width="6" height="5"/><rect x="15" y="21" width="6" height="5"/><rect x="27" y="21" width="6" height="5"/></g></svg>`,
  folder: `<svg viewBox="0 0 80 64" fill="none"><rect x="20" y="4" width="40" height="44" rx="3" fill="#fff" transform="rotate(-8 40 26)"/><rect x="24" y="6" width="40" height="44" rx="3" fill="#e0f2fe" transform="rotate(6 44 28)"/><path d="M6 18h22l6 6h40v34a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="#fcd34d" stroke="#b45309" stroke-width="2"/><text x="26" y="46" font-size="8" font-weight="700" fill="#78350f" font-family="sans-serif">EAE</text><path d="M70 6l2 4 4 1-4 2-2 4-2-4-4-2 4-1z" fill="#fde68a"/></svg>`,
};

export function art(name, cls = '') {
  const span = document.createElement('span');
  span.className = `art ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ART[name] ?? '';
  return span;
}
