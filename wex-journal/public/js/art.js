// Colour illustrations for the home page and section headings (files in /img).
const FILES = new Set(['hero', 'building', 'clipboard', 'observe', 'bolt', 'thought', 'summit', 'climb', 'team', 'trophy', 'finish', 'folder', 'camera']);

export function art(name, cls = '') {
  const span = document.createElement('span');
  span.className = `art ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  if (FILES.has(name)) {
    const img = document.createElement('img');
    img.src = `img/${name}.webp`;
    img.alt = '';
    img.decoding = 'async';
    span.append(img);
  }
  return span;
}
