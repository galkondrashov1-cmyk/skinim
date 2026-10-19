// Renders every raster brand asset (PWA icons, Apple touch icon, iOS launch
// images, shortcut icons, social card) from the vector mark and wordmark.
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const G = JSON.parse(readFileSync(new URL('../src/brand/geometry.json', import.meta.url)));
const src = readFileSync(new URL('../src/brand/wordmark-paths.ts', import.meta.url), 'utf8');
const WORD = JSON.parse(src.match(/WORDMARK = (\{.*?\}) as const/s)[1]);
const SLOGAN = JSON.parse(src.match(/SLOGAN_PATH = (\{.*?\}) as const/s)[1]);
const C = G.colors;
const out = (p) => new URL(`../public/${p}`, import.meta.url).pathname;
mkdirSync(out('icons'), { recursive: true });
mkdirSync(out('splash'), { recursive: true });

const pts = (a) => a.map(([x, y]) => `${x},${y}`).join(' ');

/** The mark, drawn into a box of `size` at (x, y). */
function mark(x, y, size, color = C.paper) {
  const s = size / G.viewBox;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${G.stroke}" stroke-linejoin="miter" stroke-miterlimit="10">
    <line x1="${G.wick.x}" y1="${G.wick.y1}" x2="${G.wick.x}" y2="${G.wick.y2}"/>
    <polyline points="${pts(G.target)}"/>
    <polyline points="${pts(G.stop)}"/>
    <rect x="${G.body.x}" y="${G.body.y}" width="${G.body.w}" height="${G.body.h}" fill="${color}" stroke="none"/>
  </g>`;
}

function word(cx, top, height, color = C.paper) {
  const b = WORD.box;
  const s = height / (b.y2 - b.y1);
  const w = (b.x2 - b.x1) * s;
  return { svg: `<path transform="translate(${cx - w / 2 - b.x1 * s} ${top - b.y1 * s}) scale(${s})" d="${WORD.d}" fill="${color}"/>`, width: w };
}

function slogan(cx, top, height, color = C.muted) {
  const b = SLOGAN.box;
  const s = height / (b.y2 - b.y1);
  const w = (b.x2 - b.x1) * s;
  return `<path transform="translate(${cx - w / 2 - b.x1 * s} ${top - b.y1 * s}) scale(${s})" d="${SLOGAN.d}" fill="${color}"/>`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

async function png(file, w, h, body) {
  await sharp(Buffer.from(svg(w, h, body))).png({ compressionLevel: 9 }).toFile(out(file));
}

// App icons ──────────────────────────────────────────────────────────────
function appIcon(n, { rounded, scale }) {
  const r = rounded ? n * 0.22 : 0;
  const m = n * scale;
  return `<rect width="${n}" height="${n}" rx="${r}" fill="${C.ink}"/>
    ${rounded ? `<rect x="0.5" y="0.5" width="${n - 1}" height="${n - 1}" rx="${r}" fill="none" stroke="${C.line}"/>` : ''}
    ${mark((n - m) / 2, (n - m) / 2, m)}`;
}

for (const n of [192, 512]) {
  await png(`icons/icon-${n}.png`, n, n, appIcon(n, { rounded: true, scale: 0.6 }));
  await png(`icons/maskable-${n}.png`, n, n, appIcon(n, { rounded: false, scale: 0.5 }));
}
await png('icons/monochrome-512.png', 512, 512, mark(256 - 160, 256 - 160, 320, '#FFFFFF'));
await png('apple-touch-icon.png', 180, 180, appIcon(180, { rounded: false, scale: 0.58 }));
await png('icons/favicon-32.png', 32, 32, `<rect width="32" height="32" rx="7" fill="${C.ink}"/>${mark(3, 3, 26)}`);
writeFileSync(out('favicon.svg'), svg(64, 64, `<rect width="64" height="64" rx="14" fill="${C.ink}"/>${mark(8, 8, 48)}`));
writeFileSync(out('mask-icon.svg'), svg(48, 48, mark(0, 0, 48, '#000')));

// Shortcut icons ─────────────────────────────────────────────────────────
const glyphs = {
  trade: `<path d="M30 30v36M26 40h8v18h-8zM48 24v40M44 30h8v22h-8zM66 34v34M62 44h8v14h-8z" stroke="${C.paper}" stroke-width="3" fill="none"/>`,
  journal: `<path d="M30 24h30l8 8v40H30z M38 40h22M38 50h22M38 60h14" stroke="${C.paper}" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
  performance: `<path d="M26 68h44M28 60l12-14 10 8 16-20" stroke="${C.paper}" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
};
for (const [k, g] of Object.entries(glyphs)) await png(`icons/shortcut-${k}.png`, 96, 96, `<rect width="96" height="96" rx="20" fill="${C.ink}"/>${g}`);

// iOS launch images ──────────────────────────────────────────────────────
export const LAUNCH = [
  [1320, 2868], [1290, 2796], [1206, 2622], [1179, 2556], [1170, 2532], [1284, 2778], [1125, 2436], [1242, 2688], [828, 1792], [750, 1334], [640, 1136],
  [2048, 2732], [1668, 2388], [1640, 2360], [1668, 2224], [1620, 2160], [1488, 2266], [1536, 2048],
];
for (const [w, h] of LAUNCH) {
  for (const [orient, W, H] of [['portrait', w, h], ['landscape', h, w]]) {
    const u = Math.min(W, H);
    const m = u * 0.16;
    const cy = H * 0.46;
    const wm = word(W / 2, cy + m * 0.75, m * 0.26);
    const body = `<rect width="${W}" height="${H}" fill="${C.ink}"/>${mark(W / 2 - m / 2, cy - m / 2, m)}${wm.svg}${slogan(W / 2, H - u * 0.12, u * 0.018)}`;
    await png(`splash/launch-${W}x${H}.png`, W, H, body);
  }
}
writeFileSync(out('splash/manifest.json'), JSON.stringify(LAUNCH));

// Social card ────────────────────────────────────────────────────────────
{
  const W = 1200, H = 630;
  let grid = '';
  for (let y = 90; y < H; y += 90) grid += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`;
  const wm = word(W / 2, 360, 54);
  await png('og.png', W, H, `<rect width="${W}" height="${H}" fill="${C.ink}"/>${grid}${mark(W / 2 - 80, 150, 160)}${wm.svg}${slogan(W / 2, 452, 16)}`);
}
console.log('icons ok');
