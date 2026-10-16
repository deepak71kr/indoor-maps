/**
 * Functional icons as one inline SVG sprite (emoji are only for decoration — they render
 * differently per phone). 24×24, stroked with currentColor so they follow the theme.
 */
const PATHS = {
  straight: '<path d="M12 20V4M6 10l6-6 6 6"/>',
  walk: '<path d="M12 20V4M6 10l6-6 6 6"/>',
  left: '<path d="M18 20v-7a4 4 0 0 0-4-4H5M10 4 5 9l5 5"/>',
  right: '<path d="M6 20v-7a4 4 0 0 1 4-4h9M14 4l5 5-5 5"/>',
  'slight-left': '<path d="M16 20v-6L7 5M7 11V5h6"/>',
  'slight-right': '<path d="M8 20v-6l9-9M11 5h6v6"/>',
  'u-turn': '<path d="M8 20V9a4 4 0 0 1 8 0v8M12 13l4 4 4-4"/>',
  lift: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 9 3-3 3 3M9 15l3 3 3-3"/>',
  stairs: '<path d="M3 20h5v-4h4v-4h4V8h5"/>',
  arrive:
    '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 17h4v4h-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17v.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wheelchair: '<circle cx="11" cy="4" r="1.5"/><path d="M11 7v6h6l2 5M8 10a5 5 0 1 0 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  directions:
    '<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/><path d="M9 15v-3.5h5.5M12 8.5l2.5 3-2.5 3"/>',
  share:
    '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  swap: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4ZM17 9l5 6M22 9l-5 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
} as const;

export type IconName = keyof typeof PATHS;

const SVG = 'http://www.w3.org/2000/svg';

/** Adds the sprite to the page once. */
export function installIcons(): void {
  const symbols = Object.entries(PATHS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  const sprite = document.createElementNS(SVG, 'svg');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.style.display = 'none';
  sprite.innerHTML = symbols;
  document.body.prepend(sprite);
}

export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}
