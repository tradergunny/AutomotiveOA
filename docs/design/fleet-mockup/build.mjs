// PROTOTYPE. Inlines fonts and icons into one offline file: node docs/design/fleet-mockup/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const require = createRequire(join(root, 'package.json'));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lucide = require('lucide-react');

const b64 = (p) => readFileSync(join(root, p)).toString('base64');
const face = (family, weight, file) =>
  `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format("woff2")}`;

const fonts = [
  face('Geist', '100 900', 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'),
  face('Plex Thai', '400', 'app/fonts/ibm-plex-sans-thai-thai-400-normal.woff2'),
  face('Plex Thai', '500', 'app/fonts/ibm-plex-sans-thai-thai-500-normal.woff2'),
  face('Plex Thai', '600', 'app/fonts/ibm-plex-sans-thai-thai-600-normal.woff2'),
].join('\n');

const names = {
  counter: 'ClipboardList', car: 'Car', bill: 'FileText', search: 'Search', x: 'X', alert: 'TriangleAlert',
  check: 'Check', pencil: 'Pencil', printer: 'Printer', gauge: 'Gauge', calendar: 'Calendar', user: 'UserRound',
  wrench: 'Wrench', plus: 'Plus', eye: 'Eye', eyeoff: 'EyeOff', back: 'ArrowLeft', trash: 'Trash2', logout: 'LogOut',
  building: 'Building2', clock: 'Clock', droplet: 'Droplet', right: 'ChevronRight',
};
const icons = Object.fromEntries(
  Object.entries(names).map(([k, n]) => {
    if (!lucide[n]) throw new Error(`Missing icon ${n}`);
    return [k, renderToStaticMarkup(createElement(lucide[n], { size: 18, strokeWidth: 1.75, 'aria-hidden': true }))];
  }),
);

const html = readFileSync(join(here, 'mockup.src.html'), 'utf8')
  .replace('/*__FONTS__*/', () => fonts)
  .replace('/*__ICONS__*/{}', () => JSON.stringify(icons));
writeFileSync(join(here, 'index.html'), html);
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
