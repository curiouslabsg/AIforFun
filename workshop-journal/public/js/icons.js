// Line icons drawn on a 24×24 grid. They inherit colour from CSS (`color`).
const PATHS = {
  // journal stages
  empathise: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  define: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  ideate: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  design: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>',
  prototype: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  test: '<path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M19 9h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v2.5L16 18h-3"/>',
  reflect: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  log: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  // problem statements
  thermometer: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  bin: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  banana: '<path d="M5 6c0 8 5 13 14 12 1 0 1-1 0-1.5C12 16 8 12 7 6c0-1-2-1-2 0z"/><path d="M5.5 5.5L4.5 3"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  bottle: '<path d="M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3z"/><path d="M8 12h8"/>',
  posture: '<circle cx="8" cy="5" r="2"/><path d="M8 8c-1.2 3-.4 6 2.5 7H15l1.2 6"/><path d="M3 21h18M12 11.5h8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pill: '<path d="M10.5 20.5a4.9 4.9 0 0 1-7-7l6-6a4.9 4.9 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.5A4.5 4.5 0 0 1 17 18z"/><path d="M4 21h16"/>',
  tray: '<rect x="3" y="7" width="18" height="11" rx="2"/><circle cx="9" cy="12.5" r="2.5"/><path d="M14 11h4M14 14h3"/>',
  plate: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9M12 12l-6.4 6.4"/>',
  drink: '<path d="M6 7h12l-1.5 14h-9z"/><path d="M12 7l2-5h3M6.5 11h11"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  dumbbell: '<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>',
  sound: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
};

export function icon(name, size = 24, label = '') {
  const span = document.createElement('span');
  span.className = 'ico';
  if (label) { span.setAttribute('role', 'img'); span.setAttribute('aria-label', label); } else span.setAttribute('aria-hidden', 'true');
  // PATHS are fixed strings in this file, never user input.
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? PATHS.sparkle}</svg>`;
  return span;
}
